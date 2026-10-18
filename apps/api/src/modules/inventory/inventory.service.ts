import {
  Prisma,
  MovimentacaoEstoqueMotivo,
  MovimentacaoEstoqueTipo
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";

// Tipos que alteram o saldo físico fora da entrada definitiva exigem capacidade própria.
export const ADJUSTMENT_TYPES: MovimentacaoEstoqueTipo[] = [
  "ADJUSTMENT_POSITIVE",
  "ADJUSTMENT_NEGATIVE",
  "RETURN_ENTRY",
  "RETURN_EXIT"
];
export const list = (lojaId: string) =>
  prisma.estoque.findMany({
    where: { lojaId },
    include: { produto: true },
    orderBy: { produto: { nome: "asc" } }
  });
export const movements = (lojaId: string) =>
  prisma.movimentacaoEstoque.findMany({
    where: { lojaId },
    orderBy: { createdAt: "desc" }
  });
export type MoveInput = {
  produtoId: string;
  tipo: MovimentacaoEstoqueTipo;
  motivo: MovimentacaoEstoqueMotivo;
  quantidade: number;
  observacoes?: string;
};

// PD-12 (E-5): perda e ajuste negativo acima do limite configurado pelo PO exigem proposta e aval de
// outro usuário (CORRECAO_PATRIMONIAL_APROVAR). Sem limite configurado, nada muda.
export function lossApprovalThreshold() {
  const raw = process.env.ESTOQUE_PERDA_LIMITE_UNIDADES;
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
export function lossNeedsApproval(d: MoveInput) {
  const limit = lossApprovalThreshold();
  const isLoss =
    d.tipo === "ADJUSTMENT_NEGATIVE" ||
    (d.tipo === "EXIT" && (d.motivo === "LOSS" || d.motivo === "DAMAGE"));
  return limit !== null && isLoss && d.quantidade > limit;
}

export async function move(
  lojaId: string,
  userId: string,
  d: MoveInput,
  key?: string
) {
  if (d.quantidade < 1) throw new AppError(400, "bad_request");
  // Venda baixa estoque só pelo módulo Vendas (B17), junto com lote, custo e auditoria.
  if (d.motivo === "SALE")
    throw new AppError(409, "sale_requires_sales_module");
  if (lossNeedsApproval(d)) throw new AppError(409, "loss_requires_approval");
  if (
    ["ADJUSTMENT_POSITIVE", "ADJUSTMENT_NEGATIVE"].includes(d.tipo) &&
    !d.observacoes
  )
    throw new AppError(400, "bad_request");
  return idempotentMutation({
    lojaId,
    operation: "MOVE_STOCK",
    entityId: d.produtoId,
    key,
    payload: d,
    execute: (tx, correlationId) =>
      applyMove(tx, lojaId, userId, d, correlationId, key)
  });
}

// PD-12: o mesmo movimento, aplicado dentro de uma transação existente (ex.: aprovação de perda).
export async function applyMove(
  tx: Prisma.TransactionClient,
  lojaId: string,
  userId: string,
  d: MoveInput,
  correlationId: string,
  key?: string
) {
  // Bloqueia o saldo: leitura e gravação absolutas só são seguras com a linha travada.
  await tx.$queryRaw`SELECT id FROM "Estoque" WHERE "lojaId" = ${lojaId} AND "produtoId" = ${d.produtoId} FOR UPDATE`;
  const stock = await tx.estoque.findUnique({
    where: { lojaId_produtoId: { lojaId, produtoId: d.produtoId } }
  });
  if (!stock) throw new AppError(404, "not_found");
  let physical = stock.quantidadeFisica,
    reserved = stock.quantidadeReservada;
  switch (d.tipo) {
    case "RESERVE":
      reserved += d.quantidade;
      break;
    case "RELEASE_RESERVATION":
      reserved -= d.quantidade;
      break;
    case "EXIT":
    case "RETURN_EXIT":
      physical -= d.quantidade;
      break;
    case "ADJUSTMENT_POSITIVE":
    case "RETURN_ENTRY":
      physical += d.quantidade;
      break;
    case "ADJUSTMENT_NEGATIVE":
      physical -= d.quantidade;
      break;
    default:
      throw new AppError(409, "conflict");
  }
  if (physical < 0 || reserved < 0 || physical - reserved < 0)
    throw new AppError(409, "insufficient_stock");
  await tx.estoque.update({
    where: { id: stock.id },
    data: { quantidadeFisica: physical, quantidadeReservada: reserved }
  });
  const movement = await tx.movimentacaoEstoque.create({
    data: {
      lojaId,
      produtoId: d.produtoId,
      estoqueId: stock.id,
      tipo: d.tipo,
      motivo: d.motivo,
      quantidade: d.quantidade,
      quantidadeAnterior: stock.quantidadeFisica,
      quantidadePosterior: physical,
      responsavelId: userId,
      observacoes: d.observacoes
    }
  });
  await audit(tx, {
    usuarioId: userId,
    lojaId,
    permissionCode: ADJUSTMENT_TYPES.includes(d.tipo)
      ? "ESTOQUE_AJUSTAR"
      : "ESTOQUE_MOVIMENTAR",
    action: "MOVE_STOCK",
    entity: "MovimentacaoEstoque",
    entityId: movement.id,
    correlationId,
    idempotencyKey: key,
    reason: d.observacoes,
    before: stock,
    after: movement,
    origin: "API_INVENTORY"
  });
  return movement;
}
// Proposta de perda acima do limite: só registra a solicitação; o estoque muda na aprovação.
export function proposeLoss(
  lojaId: string,
  userId: string,
  d: MoveInput,
  key?: string
) {
  if (!lossNeedsApproval(d)) throw new AppError(409, "loss_within_limit");
  if (!d.observacoes?.trim()) throw new AppError(400, "reason_required");
  return idempotentMutation({
    lojaId,
    operation: "PROPOSE_STOCK_LOSS",
    entityId: d.produtoId,
    key,
    payload: d,
    execute: async (tx, correlationId) => {
      const request = await tx.solicitacaoCorrecao.create({
        data: {
          lojaId,
          payload: {
            kind: "STOCK_LOSS",
            move: d
          } as unknown as Prisma.InputJsonValue,
          propostoPorId: userId
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "ESTOQUE_AJUSTAR",
        action: "PROPOSE_STOCK_LOSS",
        entity: "SolicitacaoCorrecao",
        entityId: request.id,
        correlationId,
        idempotencyKey: key,
        reason: d.observacoes,
        after: request,
        origin: "API_INVENTORY"
      });
      return request;
    }
  });
}
