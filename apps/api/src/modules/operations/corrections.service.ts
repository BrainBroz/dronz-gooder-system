import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "./operations.persistence";

type CorrectionInput = {
  entity: "CheckpointParaguai" | "CheckpointBrasil" | "RecebimentoMiami" | "RecebimentoItem";
  originalEventId: string;
  correctionType: string;
  reason: string;
  after: Record<string, unknown>;
  adjustments?: { productId: string; quantityDelta: number; originalMovementId: string }[];
};

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

      const adjustments = input.adjustments ?? [];
      for (const adjustment of adjustments) {
        if (!Number.isInteger(adjustment.quantityDelta) || adjustment.quantityDelta === 0)
          throw new AppError(400, "bad_request");
        const originalMovement = await tx.movimentacaoEstoque.findFirst({
          where: { id: adjustment.originalMovementId, lojaId, produtoId: adjustment.productId }
        });
        if (!originalMovement) throw new AppError(404, "not_found");
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
      await audit(tx, {
        usuarioId: userId, lojaId, permissionCode: "CHECKPOINT_CORRIGIR", action: "CORRECT_CHECKPOINT",
        entity: input.entity, entityId: input.originalEventId, correlationId, idempotencyKey,
        reason: input.reason, before: original, after: { correction, adjustments }
      });
      return correction;
    }
  });
}
