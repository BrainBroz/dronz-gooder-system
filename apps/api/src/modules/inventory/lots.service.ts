import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";
import { lotBalances, lotsFor } from "../sales/sales.service";

// PD-03: reconciliação de lotes legados. Lote sem custo segue vendável (sem lucro calculado); o vínculo
// com o item de compra e a atribuição de saídas antigas aos lotes são comandos explícitos com motivo.
const ORIGIN = "API_INVENTORY";
const OUTFLOW_TYPES = ["EXIT", "ADJUSTMENT_NEGATIVE", "RETURN_EXIT"] as const;

type Db = Parameters<typeof lotsFor>[0];

async function unlottedOutflows(db: Db, lojaId: string, produtoId: string) {
  const outflows = await db.movimentacaoEstoque.findMany({
    where: { lojaId, produtoId, tipo: { in: [...OUTFLOW_TYPES] } },
    include: {
      baixasComoSaida: { select: { quantidade: true } },
      reconciliacoesSaida: { select: { quantidade: true } }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  return outflows
    .map((movement) => ({
      id: movement.id,
      tipo: movement.tipo,
      motivo: movement.motivo,
      createdAt: movement.createdAt,
      // Saída de venda do B17 já tem baixa por lote; o que sobra é saída sem lote identificado.
      pendente:
        movement.quantidade -
        movement.baixasComoSaida.reduce((sum, b) => sum + b.quantidade, 0) -
        movement.reconciliacoesSaida.reduce((sum, r) => sum + r.quantidade, 0)
    }))
    .filter((movement) => movement.pendente > 0);
}

export async function lotDiagnosis(lojaId: string, produtoId: string) {
  const lots = await lotsFor(prisma, lojaId, [produtoId]);
  const balance = (await lotBalances(prisma, lojaId, [produtoId], lots)).get(
    produtoId
  );
  return {
    produtoId,
    estoqueFisico: balance?.stock.quantidadeFisica ?? 0,
    saldoLotes: lots.reduce((sum, lot) => sum + lot.restante, 0),
    reconciliado:
      balance?.reconciled ?? lots.every((lot) => lot.restante === 0),
    lotes: lots.map((lot) => ({
      movimentoEntradaId: lot.id,
      tipo: lot.tipo,
      entradaEm: lot.createdAt,
      quantidade: lot.quantidade,
      restante: lot.restante,
      pedidoCompraItemId: lot.pedidoCompraItemId,
      // Lote de devolução vale pelo custo congelado da baixa original, que pode ser desconhecido.
      custoConhecido: lot.baixaOrigem
        ? lot.baixaOrigem.custoUnitario !== null
        : !!lot.pedidoCompraItemId
    })),
    saidasSemLote: await unlottedOutflows(prisma, lojaId, produtoId)
  };
}

// Atribui as saídas sem lote aos lotes mais antigos com saldo (FIFO por entrada e ID).
export function reconcileLots(
  lojaId: string,
  userId: string,
  produtoId: string,
  motivo: string,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "RECONCILE_LOTS",
    entityId: produtoId,
    key,
    payload: { motivo },
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "Estoque" WHERE "lojaId" = ${lojaId} AND "produtoId" = ${produtoId} FOR UPDATE`;
      const lots = await lotsFor(tx, lojaId, [produtoId]);
      const outflows = await unlottedOutflows(tx, lojaId, produtoId);
      if (!outflows.length) throw new AppError(409, "lots_already_reconciled");
      const created = [];
      for (const outflow of outflows) {
        let missing = outflow.pendente;
        for (const lot of lots) {
          if (!missing) break;
          if (lot.restante <= 0 || lot.createdAt > outflow.createdAt) continue;
          const take = Math.min(lot.restante, missing);
          lot.restante -= take;
          missing -= take;
          created.push(
            await tx.reconciliacaoLote.create({
              data: {
                lojaId,
                movimentoEntradaId: lot.id,
                movimentoSaidaId: outflow.id,
                quantidade: take,
                motivo,
                usuarioId: userId
              }
            })
          );
        }
        // Saída sem entrada anterior suficiente não é inventada: o operador precisa investigar.
        if (missing) throw new AppError(409, "outflow_without_prior_lot");
      }
      const stock = await tx.estoque.findUnique({
        where: { lojaId_produtoId: { lojaId, produtoId } }
      });
      const saldo = lots.reduce((sum, lot) => sum + lot.restante, 0);
      if (stock && saldo !== stock.quantidadeFisica)
        throw new AppError(409, "lots_still_unbalanced");
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "ESTOQUE_AJUSTAR",
        action: "RECONCILE_LOTS",
        entity: "Produto",
        entityId: produtoId,
        correlationId,
        idempotencyKey: key,
        reason: motivo,
        after: {
          reconciliacoes: created.map((r) => ({
            lote: r.movimentoEntradaId,
            saida: r.movimentoSaidaId,
            quantidade: r.quantidade
          }))
        },
        origin: ORIGIN
      });
      return { produtoId, reconciliacoes: created.length, saldoLotes: saldo };
    }
  });
}

// Liga um lote sem custo ao item de compra de origem; o custo passa a valer para vendas futuras.
export function linkLotPurchaseItem(
  lojaId: string,
  userId: string,
  movimentoEntradaId: string,
  data: { pedidoCompraItemId: string; motivo: string },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "LINK_LOT_PURCHASE_ITEM",
    entityId: movimentoEntradaId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "MovimentacaoEstoque" WHERE id = ${movimentoEntradaId} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const lot = await tx.movimentacaoEstoque.findFirst({
        where: {
          id: movimentoEntradaId,
          lojaId,
          tipo: { in: ["ENTRY", "ADJUSTMENT_POSITIVE", "RETURN_ENTRY"] }
        }
      });
      if (!lot) throw new AppError(404, "lot_not_found");
      if (lot.pedidoCompraItemId) throw new AppError(409, "lot_already_linked");
      // O custo do lote de devolução está congelado na baixa original; religar mudaria a história.
      if (lot.baixaOrigemId) throw new AppError(409, "lot_cost_frozen");
      await tx.$queryRaw`SELECT id FROM "PedidoCompraItem" WHERE id = ${data.pedidoCompraItemId} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const item = await tx.pedidoCompraItem.findFirst({
        where: { id: data.pedidoCompraItemId, lojaId },
        include: {
          lotesEstoque: {
            where: { tipo: { in: ["ENTRY", "ADJUSTMENT_POSITIVE"] } }
          }
        }
      });
      if (!item) throw new AppError(404, "purchase_item_not_found");
      if (item.produtoId !== lot.produtoId)
        throw new AppError(409, "product_mismatch");
      // Lotes ligados ao item não podem somar mais unidades do que foram compradas.
      const linked = item.lotesEstoque.reduce(
        (sum, l) => sum + l.quantidade,
        0
      );
      if (
        lot.tipo !== "RETURN_ENTRY" &&
        linked + lot.quantidade > item.quantidade
      )
        throw new AppError(409, "lot_exceeds_purchase_item");
      const updated = await tx.movimentacaoEstoque.update({
        where: { id: movimentoEntradaId },
        data: { pedidoCompraItemId: data.pedidoCompraItemId }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "ESTOQUE_AJUSTAR",
        action: "LINK_LOT_PURCHASE_ITEM",
        entity: "MovimentacaoEstoque",
        entityId: movimentoEntradaId,
        correlationId,
        idempotencyKey: key,
        reason: data.motivo,
        before: { pedidoCompraItemId: null },
        after: { pedidoCompraItemId: data.pedidoCompraItemId },
        origin: ORIGIN
      });
      return { id: updated.id, pedidoCompraItemId: updated.pedidoCompraItemId };
    }
  });
}
