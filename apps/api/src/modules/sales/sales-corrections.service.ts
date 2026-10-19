import type { CondicaoComercial, Funcionamento } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";

// PD-01 e PD-02 (aprovadas em 2026-10-18). A venda confirmada nunca é editada: o estorno e a devolução
// são fatos próprios, ligados a ela. Invariante preservado: Σ saldo dos lotes = estoque físico.
const ORIGIN = "API_SALES";

async function lockedSale(
  tx: Parameters<Parameters<typeof idempotentMutation>[0]["execute"]>[0],
  lojaId: string,
  id: string
) {
  await tx.$queryRaw`SELECT id FROM "Venda" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  const sale = await tx.venda.findFirst({
    where: { id, lojaId },
    include: {
      itens: { include: { baixas: true, devolucoes: true } },
      recebivel: true
    }
  });
  if (!sale) throw new AppError(404, "not_found");
  return sale;
}

// PD-01: estorno quando o item comprovadamente não saiu. Reverte as baixas (o saldo volta ao lote
// original), cria RETURN_ENTRY/SALE ligada à saída e marca a venda ESTORNADA. Receita e custo da venda
// original ficam como estavam; relatórios mostram o estorno à parte.
export function reverseSale(
  lojaId: string,
  userId: string,
  id: string,
  data: { motivo: string; itemNaoSaiu: true },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "REVERSE_SALE",
    entityId: id,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const sale = await lockedSale(tx, lojaId, id);
      if (sale.estado !== "CONFIRMADA")
        throw new AppError(409, "sale_not_confirmed");
      if (
        sale.itens.some((item) =>
          item.devolucoes.some((d) => d.estado !== "REJEITADA")
        )
      )
        throw new AppError(409, "sale_has_returns");
      // Dinheiro já recebido exige lançamento financeiro próprio antes do estorno.
      if (sale.recebivel && !sale.recebivel.valorRecebido.isZero())
        throw new AppError(409, "receivable_has_receipts");
      const productIds = [
        ...new Set(sale.itens.map((item) => item.produtoId))
      ].sort();
      for (const produtoId of productIds)
        await tx.$queryRaw`SELECT id FROM "Estoque" WHERE "lojaId" = ${lojaId} AND "produtoId" = ${produtoId} FOR UPDATE`;
      const now = new Date();
      for (const item of sale.itens) {
        const baixas = item.baixas.filter((baixa) => !baixa.revertidaEm);
        const quantidade = baixas.reduce(
          (sum, baixa) => sum + baixa.quantidade,
          0
        );
        if (!quantidade) continue;
        const stock = await tx.estoque.findUniqueOrThrow({
          where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } }
        });
        await tx.estoque.update({
          where: { id: stock.id },
          data: { quantidadeFisica: { increment: quantidade } }
        });
        await tx.movimentacaoEstoque.create({
          data: {
            lojaId,
            produtoId: item.produtoId,
            estoqueId: stock.id,
            tipo: "RETURN_ENTRY",
            motivo: "SALE",
            quantidade,
            quantidadeAnterior: stock.quantidadeFisica,
            quantidadePosterior: stock.quantidadeFisica + quantidade,
            responsavelId: userId,
            movimentoOriginalId: baixas[0]!.movimentoSaidaId,
            observacoes: `Estorno da venda ${sale.referenciaExterna ?? sale.id}: ${data.motivo}`
          }
        });
        await tx.baixaVenda.updateMany({
          where: { id: { in: baixas.map((baixa) => baixa.id) } },
          data: { revertidaEm: now }
        });
      }
      if (sale.recebivel)
        await tx.recebivelVenda.update({
          where: { id: sale.recebivel.id },
          data: { status: "ESTORNADO" }
        });
      const updated = await tx.venda.update({
        where: { id },
        data: {
          estado: "ESTORNADA",
          estornadaEm: now,
          estornadaPorId: userId,
          motivoEstorno: data.motivo
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "VENDA_CORRIGIR",
        action: "REVERSE_SALE",
        entity: "Venda",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        reason: data.motivo,
        before: { estado: sale.estado },
        after: { estado: updated.estado },
        origin: ORIGIN
      });
      return { id: updated.id, estado: updated.estado };
    }
  });
}

// PD-02 etapa 1: devolução esperada. Não mexe em estoque nem em financeiro.
export function registerReturn(
  lojaId: string,
  userId: string,
  id: string,
  data: { vendaItemId: string; quantidade: number; motivo: string },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "REGISTER_SALE_RETURN",
    entityId: id,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const sale = await lockedSale(tx, lojaId, id);
      if (sale.estado !== "CONFIRMADA")
        throw new AppError(409, "sale_not_confirmed");
      const item = sale.itens.find((entry) => entry.id === data.vendaItemId);
      if (!item) throw new AppError(404, "sale_item_not_found");
      const open = item.devolucoes
        .filter((d) => d.estado !== "REJEITADA")
        .reduce((sum, d) => sum + d.quantidade, 0);
      if (open + data.quantidade > item.quantidade)
        throw new AppError(409, "return_exceeds_sold");
      const created = await tx.devolucaoVenda.create({
        data: {
          lojaId,
          vendaId: id,
          vendaItemId: item.id,
          quantidade: data.quantidade,
          motivo: data.motivo,
          registradoPorId: userId
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "VENDA_CRIAR",
        action: "REGISTER_SALE_RETURN",
        entity: "DevolucaoVenda",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        reason: data.motivo,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

// PD-02 etapa 2: conferência. Apta → RETURN_ENTRY como lote novo com o item de compra do lote
// vendido (custo original), um lote por lote de origem. Não apta → rejeitada, sem estoque.
export function checkReturn(
  lojaId: string,
  userId: string,
  devolucaoId: string,
  data: {
    apta: boolean;
    condicaoComercial: CondicaoComercial;
    funcionamento: Funcionamento;
    observacao?: string;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CHECK_SALE_RETURN",
    entityId: devolucaoId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "DevolucaoVenda" WHERE id = ${devolucaoId} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const devolution = await tx.devolucaoVenda.findFirst({
        where: { id: devolucaoId, lojaId },
        include: {
          item: {
            include: {
              baixas: {
                where: { revertidaEm: null },
                include: { lote: true },
                orderBy: { createdAt: "desc" }
              },
              devolucoes: { where: { estado: "CONFERIDA" } }
            }
          }
        }
      });
      if (!devolution) throw new AppError(404, "not_found");
      if (devolution.estado !== "PENDENTE")
        throw new AppError(409, "return_already_checked");
      if (data.apta) {
        const item = devolution.item;
        await tx.$queryRaw`SELECT id FROM "Estoque" WHERE "lojaId" = ${lojaId} AND "produtoId" = ${item.produtoId} FOR UPDATE`;
        // Unidades já devolvidas saem dos lotes mais recentes primeiro; esta devolução segue dali.
        let skip = item.devolucoes.reduce((sum, d) => sum + d.quantidade, 0);
        let missing = devolution.quantidade;
        const stock = await tx.estoque.findUniqueOrThrow({
          where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } }
        });
        let fisica = stock.quantidadeFisica;
        for (const baixa of item.baixas) {
          if (!missing) break;
          const available = Math.max(0, baixa.quantidade - skip);
          skip = Math.max(0, skip - baixa.quantidade);
          const take = Math.min(available, missing);
          if (!take) continue;
          await tx.movimentacaoEstoque.create({
            data: {
              lojaId,
              produtoId: item.produtoId,
              estoqueId: stock.id,
              pedidoCompraItemId: baixa.lote.pedidoCompraItemId,
              baixaOrigemId: baixa.id,
              tipo: "RETURN_ENTRY",
              motivo: "RETURN",
              quantidade: take,
              quantidadeAnterior: fisica,
              quantidadePosterior: fisica + take,
              responsavelId: userId,
              observacoes: `Devolução conferida ${devolution.id} (lote de origem ${baixa.movimentoEntradaId})`
            }
          });
          fisica += take;
          missing -= take;
        }
        if (missing) throw new AppError(409, "return_exceeds_sold");
        await tx.estoque.update({
          where: { id: stock.id },
          data: { quantidadeFisica: fisica }
        });
      }
      const updated = await tx.devolucaoVenda.update({
        where: { id: devolucaoId },
        data: {
          estado: data.apta ? "CONFERIDA" : "REJEITADA",
          conferidoPorId: userId,
          conferidoEm: new Date(),
          condicaoComercial: data.condicaoComercial,
          funcionamento: data.funcionamento,
          observacaoConferencia: data.observacao
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "DEVOLUCAO_CONFERIR",
        action: "CHECK_SALE_RETURN",
        entity: "DevolucaoVenda",
        entityId: devolucaoId,
        correlationId,
        idempotencyKey: key,
        reason: data.observacao,
        before: { estado: devolution.estado },
        after: updated,
        origin: ORIGIN
      });
      return updated;
    }
  });
}
