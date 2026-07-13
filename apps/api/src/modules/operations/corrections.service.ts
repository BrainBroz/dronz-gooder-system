import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "./operations.persistence";
import type { CorrectionInput } from "./corrections.schemas";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function correct(lojaId: string, userId: string, input: CorrectionInput, idempotencyKey?: string) {
  return idempotentMutation({
    lojaId, operation: "CORRECT_CHECKPOINT", entityId: `${input.entity}:${input.originalEventId}`, key: idempotencyKey, payload: input,
    execute: async (tx, correlationId) => {
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
        if (after.tipoDivergencia !== "EXCESSO" && after.quantidadeRecebida + after.quantidadeRejeitada > original.quantidadeEsperada)
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
  });
}
