import { Prisma, type CanalVenda, type StatusVenda } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";

// Batch 17: venda, baixa patrimonial por lote e recebível. Confirmação, EXIT/SALE, snapshot de custo
// e auditoria acontecem numa única transação; só estoque Brasil disponível pode ser vendido.
const ORIGIN = "API_SALES";
// X-10: custo específico do lote escolhido; FIFO é só sugestão para o operador confirmar.
const COST_POLICY = "X-10-LOTE-v1";
const LOT_TYPES = ["ENTRY", "ADJUSTMENT_POSITIVE", "RETURN_ENTRY"] as const;
const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const zero = () => new Prisma.Decimal(0);

type ItemInput = {
  produtoId: string;
  quantidade: number;
  precoUnitario: number;
  desconto?: number;
  taxaMarketplace?: number;
  notaFiscal?: number;
  frete?: number;
};

export const saleInclude = {
  itens: {
    include: {
      produto: { select: { id: true, nome: true } },
      baixas: true
    },
    orderBy: { createdAt: "asc" }
  },
  recebivel: true,
  devolucoes: { orderBy: { createdAt: "asc" } }
} satisfies Prisma.VendaInclude;
type SaleRow = Prisma.VendaGetPayload<{ include: typeof saleInclude }>;

// Receita líquida = bruto − descontos e encargos informados; lucro só quando todo custo baixado
// está na moeda da venda (direto ou por câmbio registrado). Sem custo conhecido, não há lucro presumido.
export function saleView(sale: SaleRow, includeCost: boolean) {
  let bruto = zero(),
    liquido = zero(),
    custo: Prisma.Decimal | null = zero();
  const itens = sale.itens.map((item) => {
    const itemBruto = item.precoUnitario.mul(item.quantidade);
    const itemLiquido = itemBruto
      .minus(item.desconto)
      .minus(item.taxaMarketplace)
      .minus(item.notaFiscal)
      .minus(item.frete);
    bruto = bruto.plus(itemBruto);
    liquido = liquido.plus(itemLiquido);
    let itemCusto: Prisma.Decimal | null = item.baixas.length ? zero() : null;
    for (const baixa of item.baixas)
      itemCusto =
        itemCusto && baixa.custoUnitarioConvertido
          ? itemCusto.plus(baixa.custoUnitarioConvertido.mul(baixa.quantidade))
          : null;
    custo = custo && itemCusto ? custo.plus(itemCusto) : null;
    return {
      id: item.id,
      produto: item.produto,
      quantidade: item.quantidade,
      precoUnitario: item.precoUnitario.toFixed(2),
      desconto: item.desconto.toFixed(2),
      taxaMarketplace: item.taxaMarketplace.toFixed(2),
      notaFiscal: item.notaFiscal.toFixed(2),
      frete: item.frete.toFixed(2),
      receitaBruta: money(itemBruto).toFixed(2),
      receitaLiquida: money(itemLiquido).toFixed(2),
      ...(includeCost
        ? {
            custo: itemCusto ? money(itemCusto).toFixed(2) : null,
            baixas: item.baixas.map((baixa) => ({
              movimentoEntradaId: baixa.movimentoEntradaId,
              quantidade: baixa.quantidade,
              custoUnitario: baixa.custoUnitario?.toFixed(2) ?? null,
              moedaCusto: baixa.moedaCusto,
              custoUnitarioConvertido:
                baixa.custoUnitarioConvertido?.toFixed(2) ?? null,
              politica: baixa.politica
            }))
          }
        : {})
    };
  });
  const confirmed = sale.estado === "CONFIRMADA";
  const lucro = confirmed && custo ? liquido.minus(custo) : null;
  return {
    id: sale.id,
    canal: sale.canal,
    referenciaExterna: sale.referenciaExterna,
    dataVenda: sale.dataVenda,
    moeda: sale.moeda,
    estado: sale.estado,
    observacao: sale.observacao,
    confirmadoEm: sale.confirmadoEm,
    estornadaEm: sale.estornadaEm,
    motivoEstorno: sale.motivoEstorno,
    devolucoes: sale.devolucoes.map((d) => ({
      id: d.id,
      vendaItemId: d.vendaItemId,
      quantidade: d.quantidade,
      estado: d.estado,
      motivo: d.motivo,
      conferidoEm: d.conferidoEm,
      condicaoComercial: d.condicaoComercial,
      funcionamento: d.funcionamento
    })),
    receitaBruta: money(bruto).toFixed(2),
    receitaLiquida: money(liquido).toFixed(2),
    ...(includeCost
      ? {
          custo: confirmed && custo ? money(custo).toFixed(2) : null,
          lucro: lucro ? money(lucro).toFixed(2) : null,
          margem:
            lucro && !liquido.isZero()
              ? lucro.div(liquido).mul(100).toDecimalPlaces(2).toFixed(2)
              : null
        }
      : {}),
    recebivel: sale.recebivel,
    itens
  };
}

export async function listSales(
  lojaId: string,
  includeCost: boolean,
  filters: { canal?: CanalVenda; estado?: StatusVenda; from?: Date; to?: Date }
) {
  const sales = await prisma.venda.findMany({
    where: {
      lojaId,
      canal: filters.canal,
      estado: filters.estado,
      ...(filters.from || filters.to
        ? { dataVenda: { gte: filters.from, lt: filters.to } }
        : {})
    },
    include: saleInclude,
    orderBy: [{ dataVenda: "desc" }, { id: "desc" }],
    take: 200
  });
  return sales.map((sale) => saleView(sale, includeCost));
}

export async function getSale(
  lojaId: string,
  id: string,
  includeCost: boolean
) {
  const sale = await prisma.venda.findFirst({
    where: { id, lojaId },
    include: saleInclude
  });
  if (!sale) throw new AppError(404, "not_found");
  return saleView(sale, includeCost);
}

export function createSale(
  lojaId: string,
  userId: string,
  data: {
    canal: CanalVenda;
    referenciaExterna?: string;
    dataVenda: Date;
    moeda: string;
    observacao?: string;
    itens: ItemInput[];
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CREATE_SALE",
    entityId: data.referenciaExterna ?? "manual",
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const productIds = [...new Set(data.itens.map((item) => item.produtoId))];
      const products = await tx.produto.count({
        where: { lojaId, id: { in: productIds } }
      });
      if (products !== productIds.length)
        throw new AppError(404, "product_not_found");
      if (
        data.referenciaExterna &&
        (await tx.venda.findFirst({
          where: {
            lojaId,
            canal: data.canal,
            referenciaExterna: data.referenciaExterna
          }
        }))
      )
        throw new AppError(409, "sale_reference_exists");
      const header = await tx.venda.create({
        data: {
          lojaId,
          canal: data.canal,
          referenciaExterna: data.referenciaExterna,
          dataVenda: data.dataVenda,
          moeda: data.moeda,
          observacao: data.observacao,
          criadoPorId: userId
        }
      });
      // Relação composta (vendaId, lojaId): itens entram por createMany, não por create aninhado.
      await tx.vendaItem.createMany({
        data: data.itens.map((item) => ({
          lojaId,
          vendaId: header.id,
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          precoUnitario: money(item.precoUnitario),
          desconto: money(item.desconto ?? 0),
          taxaMarketplace: money(item.taxaMarketplace ?? 0),
          notaFiscal: money(item.notaFiscal ?? 0),
          frete: money(item.frete ?? 0)
        }))
      });
      const created = await tx.venda.findUniqueOrThrow({
        where: { id: header.id },
        include: saleInclude
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "VENDA_CRIAR",
        action: "CREATE_SALE",
        entity: "Venda",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return saleView(created, false);
    }
  });
}

export function cancelDraft(
  lojaId: string,
  userId: string,
  id: string,
  motivo: string,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CANCEL_SALE_DRAFT",
    entityId: id,
    key,
    payload: { motivo },
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "Venda" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const sale = await tx.venda.findFirst({ where: { id, lojaId } });
      if (!sale) throw new AppError(404, "not_found");
      // Venda confirmada já moveu estoque: correção e devolução física seguem comandos próprios.
      if (sale.estado !== "RASCUNHO") throw new AppError(409, "sale_not_draft");
      const updated = await tx.venda.update({
        where: { id },
        data: { estado: "CANCELADA" }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "VENDA_CRIAR",
        action: "CANCEL_SALE_DRAFT",
        entity: "Venda",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        reason: motivo,
        before: { estado: sale.estado },
        after: { estado: updated.estado },
        origin: ORIGIN
      });
      return updated;
    }
  });
}

type Db = Prisma.TransactionClient | typeof prisma;

export async function lotsFor(db: Db, lojaId: string, produtoIds: string[]) {
  const lots = await db.movimentacaoEstoque.findMany({
    where: {
      lojaId,
      produtoId: { in: produtoIds },
      tipo: { in: [...LOT_TYPES] },
      // PD-01: retorno de estorno (RETURN_ENTRY/SALE) só desfaz a baixa; não é lote novo.
      NOT: { tipo: "RETURN_ENTRY", motivo: "SALE" }
    },
    include: {
      baixasComoLote: {
        where: { revertidaEm: null },
        select: { quantidade: true }
      },
      reconciliacoesLote: { select: { quantidade: true } },
      baixaOrigem: {
        select: {
          custoUnitario: true,
          moedaCusto: true,
          custoUnitarioConvertido: true,
          cotacaoCambioId: true,
          item: { select: { venda: { select: { moeda: true } } } }
        }
      },
      pedidoItem: {
        include: {
          pedido: { select: { moeda: true, numeroPedido: true } },
          custosRateados: {
            include: { custo: { include: { cotacaoCambio: true } } }
          }
        }
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  return lots.map((lot) => ({
    ...lot,
    restante:
      lot.quantidade -
      lot.baixasComoLote.reduce((sum, baixa) => sum + baixa.quantidade, 0) -
      // PD-03: saídas antigas atribuídas a este lote na reconciliação.
      lot.reconciliacoesLote.reduce((sum, r) => sum + r.quantidade, 0)
  }));
}
export type Lot = Awaited<ReturnType<typeof lotsFor>>[number];

export async function lotBalances(
  db: Db,
  lojaId: string,
  produtoIds: string[],
  lots: Lot[]
) {
  const stocks = await db.estoque.findMany({
    where: { lojaId, produtoId: { in: produtoIds } }
  });
  return new Map(
    stocks.map((stock) => {
      const remaining = lots
        .filter((lot) => lot.produtoId === stock.produtoId)
        .reduce((sum, lot) => sum + lot.restante, 0);
      return [
        stock.produtoId,
        {
          stock,
          // Perdas e saídas antigas não identificam lote. Não presumir de qual entrada saíram.
          reconciled: remaining === stock.quantidadeFisica
        }
      ];
    })
  );
}

export function lotCost(lot: Lot, moedaVenda: string) {
  // Lote de devolução (PD-02): custo é o snapshot da baixa original, nunca o custo atual do item.
  const origem = lot.baixaOrigem;
  if (origem)
    return {
      custoUnitario: origem.custoUnitario,
      moedaCusto: origem.moedaCusto,
      convertido:
        origem.moedaCusto === moedaVenda
          ? origem.custoUnitario
          : origem.item.venda.moeda === moedaVenda
            ? origem.custoUnitarioConvertido
            : null,
      cotacaoCambioId:
        origem.item.venda.moeda === moedaVenda
          ? (origem.cotacaoCambioId ?? undefined)
          : undefined
    };
  const item = lot.pedidoItem;
  if (!item)
    return {
      custoUnitario: null,
      moedaCusto: null,
      convertido: null,
      cotacaoCambioId: undefined
    };
  const rated = item.custosRateados[0];
  const custoUnitario = rated
    ? rated.custoTotalUnitario
    : money(item.totalItem.div(item.quantidade));
  const moedaCusto = item.pedido.moeda;
  if (moedaCusto === moedaVenda)
    return {
      custoUnitario,
      moedaCusto,
      convertido: custoUnitario,
      cotacaoCambioId: undefined
    };
  const rate = rated?.custo.cotacaoCambio;
  if (
    rate &&
    rate.moedaOrigem === moedaCusto &&
    rate.moedaDestino === moedaVenda
  )
    return {
      custoUnitario,
      moedaCusto,
      convertido: money(custoUnitario.mul(rate.valor)),
      cotacaoCambioId: rate.id
    };
  return {
    custoUnitario,
    moedaCusto,
    convertido: null,
    cotacaoCambioId: undefined
  };
}

// Sugestão FIFO por entrada e ID; o operador confirma ou troca os lotes no comando de confirmação.
export async function lotSuggestion(lojaId: string, id: string) {
  const sale = await prisma.venda.findFirst({
    where: { id, lojaId },
    include: { itens: { orderBy: { createdAt: "asc" } } }
  });
  if (!sale) throw new AppError(404, "not_found");
  const lots = await lotsFor(
    prisma,
    lojaId,
    sale.itens.map((item) => item.produtoId)
  );
  const balances = await lotBalances(
    prisma,
    lojaId,
    sale.itens.map((item) => item.produtoId),
    lots
  );
  const used = new Map<string, number>();
  const usedProducts = new Map<string, number>();
  return {
    politica: COST_POLICY,
    itens: sale.itens.map((item) => {
      const balance = balances.get(item.produtoId);
      let missing = item.quantidade;
      const lotes = [];
      for (const lot of lots) {
        if (!missing) break;
        if (lot.produtoId !== item.produtoId) continue;
        if (!balance?.reconciled) break;
        const free = Math.min(
          lot.restante - (used.get(lot.id) ?? 0),
          balance.stock.quantidadeFisica -
            balance.stock.quantidadeReservada -
            (usedProducts.get(item.produtoId) ?? 0)
        );
        if (free <= 0) continue;
        const take = Math.min(free, missing);
        used.set(lot.id, (used.get(lot.id) ?? 0) + take);
        usedProducts.set(
          item.produtoId,
          (usedProducts.get(item.produtoId) ?? 0) + take
        );
        missing -= take;
        lotes.push({
          movimentoEntradaId: lot.id,
          quantidade: take,
          entradaEm: lot.createdAt,
          pedido: lot.pedidoItem?.pedido.numeroPedido ?? null,
          custoConhecido: lot.baixaOrigem
            ? lot.baixaOrigem.custoUnitario !== null
            : !!lot.pedidoItem
        });
      }
      return {
        vendaItemId: item.id,
        produtoId: item.produtoId,
        blockedReason:
          balance && !balance.reconciled
            ? "stock_lots_require_reconciliation"
            : null,
        lotes,
        faltante: missing
      };
    })
  };
}

export async function confirmSale(
  lojaId: string,
  userId: string,
  id: string,
  data: {
    lotes: {
      vendaItemId: string;
      movimentoEntradaId: string;
      quantidade: number;
    }[];
    recebivelPrevisto?: number;
    dataPrevista?: Date;
  },
  key?: string,
  includeCost = false
) {
  await idempotentMutation({
    lojaId,
    operation: "CONFIRM_SALE",
    entityId: id,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "Venda" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const sale = await tx.venda.findFirst({
        where: { id, lojaId },
        include: saleInclude
      });
      if (!sale) throw new AppError(404, "not_found");
      if (sale.estado !== "RASCUNHO") throw new AppError(409, "sale_not_draft");
      const productIds = [
        ...new Set(sale.itens.map((item) => item.produtoId))
      ].sort();
      // Trava os saldos em ordem fixa: vendas concorrentes do mesmo produto são serializadas.
      for (const produtoId of productIds)
        await tx.$queryRaw`SELECT id FROM "Estoque" WHERE "lojaId" = ${lojaId} AND "produtoId" = ${produtoId} FOR UPDATE`;
      const eligibleLots = await lotsFor(tx, lojaId, productIds);
      const balances = await lotBalances(tx, lojaId, productIds, eligibleLots);
      if ([...balances.values()].some((balance) => !balance.reconciled))
        throw new AppError(409, "stock_lots_require_reconciliation");
      const lots = new Map(eligibleLots.map((lot) => [lot.id, lot]));
      const consumed = new Map<string, number>();
      for (const item of sale.itens) {
        const chosen = data.lotes.filter(
          (entry) => entry.vendaItemId === item.id
        );
        if (
          chosen.reduce((sum, entry) => sum + entry.quantidade, 0) !==
          item.quantidade
        )
          throw new AppError(409, "lots_must_cover_item");
        for (const entry of chosen) {
          const lot = lots.get(entry.movimentoEntradaId);
          if (!lot || lot.produtoId !== item.produtoId)
            throw new AppError(409, "lot_not_eligible");
          const next = (consumed.get(lot.id) ?? 0) + entry.quantidade;
          if (next > lot.restante) throw new AppError(409, "lot_insufficient");
          consumed.set(lot.id, next);
        }
      }
      if (
        data.lotes.some(
          (entry) => !sale.itens.some((item) => item.id === entry.vendaItemId)
        )
      )
        throw new AppError(409, "lot_item_not_in_sale");

      for (const item of sale.itens) {
        const stock = await tx.estoque.findUnique({
          where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } }
        });
        // Disponível = físico − reservado; Miami, trânsito e conferido sem entrada não contam.
        if (
          !stock ||
          stock.quantidadeFisica - stock.quantidadeReservada < item.quantidade
        )
          throw new AppError(409, "insufficient_stock");
        await tx.estoque.update({
          where: { id: stock.id },
          data: { quantidadeFisica: { decrement: item.quantidade } }
        });
        const exit = await tx.movimentacaoEstoque.create({
          data: {
            lojaId,
            produtoId: item.produtoId,
            estoqueId: stock.id,
            tipo: "EXIT",
            motivo: "SALE",
            quantidade: item.quantidade,
            quantidadeAnterior: stock.quantidadeFisica,
            quantidadePosterior: stock.quantidadeFisica - item.quantidade,
            responsavelId: userId,
            observacoes: `Venda ${sale.canal} ${sale.referenciaExterna ?? sale.id}`
          }
        });
        for (const entry of data.lotes.filter(
          (e) => e.vendaItemId === item.id
        )) {
          const cost = lotCost(lots.get(entry.movimentoEntradaId)!, sale.moeda);
          await tx.baixaVenda.create({
            data: {
              lojaId,
              vendaItemId: item.id,
              movimentoEntradaId: entry.movimentoEntradaId,
              movimentoSaidaId: exit.id,
              quantidade: entry.quantidade,
              custoUnitario: cost.custoUnitario,
              moedaCusto: cost.moedaCusto,
              custoUnitarioConvertido: cost.convertido,
              cotacaoCambioId: cost.cotacaoCambioId,
              politica: COST_POLICY
            }
          });
        }
      }
      const previsto =
        data.recebivelPrevisto !== undefined
          ? money(data.recebivelPrevisto)
          : money(
              sale.itens.reduce(
                (sum, item) =>
                  sum
                    .plus(item.precoUnitario.mul(item.quantidade))
                    .minus(item.desconto)
                    .minus(item.taxaMarketplace),
                zero()
              )
            );
      if (previsto.isNegative()) throw new AppError(409, "negative_receivable");
      await tx.recebivelVenda.create({
        data: {
          lojaId,
          vendaId: id,
          moeda: sale.moeda,
          valorPrevisto: previsto,
          dataPrevista: data.dataPrevista,
          status: previsto.isZero() ? "RECEBIDO" : "PENDENTE"
        }
      });
      await tx.venda.update({
        where: { id },
        data: {
          estado: "CONFIRMADA",
          confirmadoPorId: userId,
          confirmadoEm: new Date()
        }
      });
      const result = await tx.venda.findUniqueOrThrow({
        where: { id },
        include: saleInclude
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "VENDA_CONFIRMAR",
        action: "CONFIRM_SALE",
        entity: "Venda",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        before: { estado: sale.estado },
        after: result,
        origin: ORIGIN
      });
      // O replay guarda só a identidade; a resposta é filtrada pela permissão atual do chamador.
      return result.id;
    }
  });
  return getSale(lojaId, id, includeCost);
}

// Recebimento liquida o recebível e preserva cada parcela no AuditLog, sem registrar receita duplicada.
export function receive(
  lojaId: string,
  userId: string,
  id: string,
  data: { valor: number; recebidoEm: Date; transacaoFonteId?: string },
  key?: string
) {
  // As fontes do B16 representam despesas, não entradas de venda. Não conciliá-las por mera referência.
  if (data.transacaoFonteId)
    throw new AppError(409, "sale_receipt_source_not_supported");
  return idempotentMutation({
    lojaId,
    operation: "RECEIVE_SALE",
    entityId: id,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "RecebivelVenda" WHERE "vendaId" = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const receivable = await tx.recebivelVenda.findFirst({
        where: { vendaId: id, lojaId }
      });
      if (!receivable) throw new AppError(404, "receivable_not_found");
      const total = receivable.valorRecebido.plus(money(data.valor));
      if (total.greaterThan(receivable.valorPrevisto))
        throw new AppError(409, "receipt_exceeds_receivable");
      const updated = await tx.recebivelVenda.update({
        where: { id: receivable.id },
        data: {
          valorRecebido: total,
          dataRecebida: data.recebidoEm,
          status: total.equals(receivable.valorPrevisto)
            ? "RECEBIDO"
            : "PARCIAL"
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "RECEIVE_SALE",
        entity: "RecebivelVenda",
        entityId: receivable.id,
        correlationId,
        idempotencyKey: key,
        before: receivable,
        after: updated,
        origin: ORIGIN
      });
      return updated;
    }
  });
}
