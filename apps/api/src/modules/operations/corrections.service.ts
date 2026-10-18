import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "./operations.persistence";
import type { CorrectionInput } from "./corrections.schemas";
import { applyMove, type MoveInput } from "../inventory/inventory.service";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function correct(lojaId: string, userId: string, input: CorrectionInput, idempotencyKey?: string) {
  // D-17: compensação com efeito patrimonial vira solicitação; só se aplica com aval de outro usuário.
  if (input.correctionType === "STOCK_COMPENSATION") return proposeCompensation(lojaId, userId, input, idempotencyKey);
  return idempotentMutation({
    lojaId, operation: "CORRECT_CHECKPOINT", entityId: `${input.entity}:${input.originalEventId}`, key: idempotencyKey, payload: input,
    execute: (tx, correlationId) => applyCorrection(tx, lojaId, userId, input, correlationId, idempotencyKey)
  });
}

async function applyCorrection(
  tx: Prisma.TransactionClient,
  lojaId: string,
  userId: string,
  input: CorrectionInput,
  correlationId: string,
  idempotencyKey?: string
) {
      const original = input.entity === "CheckpointParaguai"
        ? await tx.checkpointParaguai.findFirst({ where: { id: input.originalEventId, lojaId } })
        : input.entity === "CheckpointBrasil"
          ? await tx.checkpointBrasil.findFirst({ where: { id: input.originalEventId, lojaId } })
          : input.entity === "RecebimentoMiami"
            ? await tx.recebimentoMiami.findFirst({ where: { id: input.originalEventId, lojaId } })
            : await tx.recebimentoItem.findFirst({ where: { id: input.originalEventId, lojaId } });
      if (!original) throw new AppError(404, "not_found");
      if (input.entity === "RecebimentoItem" && "quantidadeEsperada" in original) {
        const after = input.after;
        if (after.quantidadeRejeitada > after.quantidadeRecebida || (after.tipoDivergencia !== "EXCESSO" && after.quantidadeRecebida > original.quantidadeEsperada))
          throw new AppError(409, "correction_not_allowed");
        const accepted = Math.min(original.quantidadeEsperada, after.quantidadeRecebida - after.quantidadeRejeitada);
        if (accepted < 0 || (accepted < original.quantidadeJaIncorporada && input.correctionType !== "STOCK_COMPENSATION"))
          throw new AppError(409, "correction_not_allowed");
      }

      const adjustments = input.adjustments ?? [];
      for (const adjustment of adjustments) {
        if (!Number.isInteger(adjustment.quantityDelta) || adjustment.quantityDelta === 0)
          throw new AppError(400, "bad_request");
        const [originalMovement] = await tx.$queryRaw<Array<{
          id: string; lojaId: string; produtoId: string; estoqueId: string; quantidade: number;
          tipo: string; movimentoOriginalId: string | null;
        }>>(Prisma.sql`
          SELECT "id", "lojaId", "produtoId", "estoqueId", "quantidade", "tipo", "movimentoOriginalId"
          FROM "MovimentacaoEstoque"
          WHERE "id" = ${adjustment.originalMovementId} AND "lojaId" = ${lojaId} AND "produtoId" = ${adjustment.productId}
          FOR UPDATE
        `);
        if (!originalMovement) throw new AppError(404, "not_found");
        if (originalMovement.tipo !== "ENTRY" || originalMovement.movimentoOriginalId)
          throw new AppError(409, "correction_not_allowed");
        const compensations = await tx.movimentacaoEstoque.findMany({
          where: { movimentoOriginalId: originalMovement.id, lojaId },
          select: { tipo: true, quantidade: true }
        });
        const alreadyCompensated = compensations.reduce((total, movement) =>
          total + (movement.tipo === "ADJUSTMENT_NEGATIVE" ? movement.quantidade : -movement.quantidade), 0);
        const nextCompensated = alreadyCompensated - adjustment.quantityDelta;
        if (nextCompensated < 0 || nextCompensated > originalMovement.quantidade)
          throw new AppError(409, "correction_exceeds_original");
        const stock = await tx.estoque.findUnique({ where: { lojaId_produtoId: { lojaId, produtoId: adjustment.productId } } });
        if (!stock || stock.quantidadeFisica + adjustment.quantityDelta < stock.quantidadeReservada || stock.quantidadeFisica + adjustment.quantityDelta < 0)
          throw new AppError(409, "correction_not_allowed");
        const updated = await tx.estoque.update({
          where: { id: stock.id }, data: { quantidadeFisica: { increment: adjustment.quantityDelta } }
        });
        await tx.movimentacaoEstoque.create({
          data: {
            lojaId, produtoId: adjustment.productId, estoqueId: stock.id,
            tipo: adjustment.quantityDelta > 0 ? "ADJUSTMENT_POSITIVE" : "ADJUSTMENT_NEGATIVE",
            motivo: "MANUAL_CORRECTION", quantidade: Math.abs(adjustment.quantityDelta),
            quantidadeAnterior: stock.quantidadeFisica, quantidadePosterior: updated.quantidadeFisica,
            responsavelId: userId, observacoes: input.reason, movimentoOriginalId: originalMovement.id
          }
        });
      }

      const correction = await tx.eventoCorretivo.create({
        data: {
          lojaId, entity: input.entity, entityId: input.originalEventId, originalEventId: input.originalEventId,
          correctionType: input.correctionType, reason: input.reason, beforeData: json(original), afterData: json(input.after),
          correlationId, permissionCode: "CHECKPOINT_CORRIGIR", usuarioId: userId
        }
      });
      const previousProjection = await tx.projecaoOperacional.findUnique({
        where: { lojaId_entity_entityId: { lojaId, entity: input.entity, entityId: input.originalEventId } }
      });
      const effectiveState = { ...(original as unknown as Record<string, unknown>), ...(previousProjection?.state as Record<string, unknown> | undefined), ...input.after };
      await tx.projecaoOperacional.upsert({
        where: { lojaId_entity_entityId: { lojaId, entity: input.entity, entityId: input.originalEventId } },
        create: { lojaId, entity: input.entity, entityId: input.originalEventId, state: json(effectiveState) },
        update: { state: json(effectiveState), version: { increment: 1 } }
      });
      await audit(tx, {
        usuarioId: userId, lojaId, permissionCode: "CHECKPOINT_CORRIGIR", action: "CORRECT_CHECKPOINT",
        entity: input.entity, entityId: input.originalEventId, correlationId, idempotencyKey,
        reason: input.reason, before: original, after: { correction, adjustments }
      });
      return correction;
}

class DryRunCompleted extends Error {}
const serializationConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"));

async function proposeCompensation(lojaId: string, userId: string, input: CorrectionInput, idempotencyKey?: string) {
  // Valida na proposta com a mesma regra da aplicação, numa transação descartada; a aprovação revalida.
  try {
    await prisma.$transaction(async (tx) => {
      await applyCorrection(tx, lojaId, userId, input, randomUUID());
      throw new DryRunCompleted();
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (serializationConflict(error)) throw new AppError(409, "concurrent_modification");
    if (!(error instanceof DryRunCompleted)) throw error;
  }
  return idempotentMutation({
    lojaId, operation: "PROPOSE_STOCK_COMPENSATION", entityId: `${input.entity}:${input.originalEventId}`, key: idempotencyKey, payload: input,
    execute: async (tx, correlationId) => {
      const request = await tx.solicitacaoCorrecao.create({ data: { lojaId, payload: json(input), propostoPorId: userId } });
      await audit(tx, {
        usuarioId: userId, lojaId, permissionCode: "CHECKPOINT_CORRIGIR", action: "PROPOSE_STOCK_COMPENSATION",
        entity: "SolicitacaoCorrecao", entityId: request.id, correlationId, idempotencyKey, reason: input.reason, after: request
      });
      return request;
    }
  });
}

async function decide(lojaId: string, approverId: string, id: string, approve: boolean, motivo?: string) {
  return idempotentMutation({
    lojaId, operation: approve ? "APPROVE_STOCK_COMPENSATION" : "REJECT_STOCK_COMPENSATION", entityId: id, payload: { id, motivo },
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "SolicitacaoCorrecao" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const request = await tx.solicitacaoCorrecao.findFirst({ where: { id, lojaId } });
      if (!request) throw new AppError(404, "not_found");
      if (request.status !== "PENDENTE") throw new AppError(409, "request_already_decided");
      if (request.propostoPorId === approverId) throw new AppError(403, "approver_must_differ");
      // PD-12: a mesma fila decide perdas de estoque acima do limite; aprovar aplica o movimento proposto.
      const payload = request.payload as { kind?: string; move?: MoveInput };
      const correction = !approve
        ? null
        : payload.kind === "STOCK_LOSS"
          ? await applyMove(tx, lojaId, request.propostoPorId, payload.move!, correlationId)
          : await applyCorrection(tx, lojaId, request.propostoPorId, request.payload as unknown as CorrectionInput, correlationId);
      const updated = await tx.solicitacaoCorrecao.update({
        where: { id },
        data: {
          status: approve ? "APROVADA" : "REJEITADA", decididoPorId: approverId, decididoEm: new Date(),
          motivoDecisao: motivo, eventoCorretivoId: correction?.id
        }
      });
      await audit(tx, {
        usuarioId: approverId, lojaId, permissionCode: "CORRECAO_PATRIMONIAL_APROVAR",
        action: approve ? "APPROVE_STOCK_COMPENSATION" : "REJECT_STOCK_COMPENSATION",
        entity: "SolicitacaoCorrecao", entityId: id, correlationId, reason: motivo, before: request, after: updated
      });
      return updated;
    }
  });
}

export const approveCompensation = (lojaId: string, approverId: string, id: string) => decide(lojaId, approverId, id, true);
export function rejectCompensation(lojaId: string, approverId: string, id: string, motivo: string) {
  if (!motivo.trim()) throw new AppError(400, "reason_required");
  return decide(lojaId, approverId, id, false, motivo);
}
export const compensationRequests = (lojaId: string) =>
  prisma.solicitacaoCorrecao.findMany({
    where: { lojaId, status: "PENDENTE" },
    include: { propostoPor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" }
  });
