import { Prisma, type FormaPagamento } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";

const ORIGIN = "API_FINANCE";

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// Bloqueia o pedido até o fim da transação: pagamentos e custos concorrentes do mesmo pedido são serializados.
async function lockedOrder(
  tx: Prisma.TransactionClient,
  lojaId: string,
  id: string
) {
  await tx.$queryRaw`SELECT id FROM "PedidoCompra" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  const item = await tx.pedidoCompra.findFirst({
    where: { id, lojaId },
    include: { itens: true, pagamentos: true }
  });
  if (!item) throw new AppError(404, "not_found");
  return item;
}

type OrderWithPayments = Prisma.PedidoCompraGetPayload<{
  include: { pagamentos: true };
}>;

// Estado agregado da obrigação (PENDING/PARTIAL/PAID/REFUNDED/CANCELLED), não o do comando.
function obligation(order: OrderWithPayments) {
  const total = (
    filter: (p: OrderWithPayments["pagamentos"][number]) => boolean
  ) =>
    order.pagamentos
      .filter(filter)
      .reduce((s, p) => s.plus(p.valor), new Prisma.Decimal(0));
  const pago = total((p) => p.status !== "CANCELLED" && !p.estornoDeId);
  const reembolsado = total((p) => !!p.estornoDeId);
  const estado =
    order.status === "CANCELLED"
      ? "CANCELLED"
      : pago.isZero()
        ? "PENDING"
        : reembolsado.equals(pago)
          ? "REFUNDED"
          : pago.greaterThanOrEqualTo(order.total)
            ? "PAID"
            : "PARTIAL";
  return { pago, reembolsado, estado };
}

export async function orderObligation(lojaId: string, id: string) {
  const order = await prisma.pedidoCompra.findFirst({
    where: { id, lojaId },
    include: { pagamentos: { orderBy: { createdAt: "asc" } } }
  });
  if (!order) throw new AppError(404, "not_found");
  const { pago, reembolsado, estado } = obligation(order);
  return {
    pedidoCompraId: order.id,
    numeroPedido: order.numeroPedido,
    moeda: order.moeda,
    total: order.total.toFixed(2),
    pago: pago.toFixed(2),
    reembolsado: reembolsado.toFixed(2),
    liquido: pago.minus(reembolsado).toFixed(2),
    restante: order.total.minus(pago).toFixed(2),
    estado,
    pagamentos: order.pagamentos
  };
}

// PD-10: a lista ativa oculta cancelados e lançamentos de estorno, salvo filtro; os totais por moeda
// sempre trazem bruto, reembolsado e líquido de todos os lançamentos.
// PD-09 (E-2): a cotação vale até a próxima registrada para o mesmo par; com mais de 7 dias ou já
// substituída, o uso gera aviso (sem bloqueio). O custo guarda o ID da cotação usada como snapshot.
const QUOTE_WARNING_DAYS = 7;
async function quoteWarning(
  db: Prisma.TransactionClient | typeof prisma,
  lojaId: string,
  quote: {
    id: string;
    moedaOrigem: string;
    moedaDestino: string;
    cotadoEm: Date;
  }
) {
  const newer = await db.cotacaoCambio.count({
    where: {
      lojaId,
      moedaOrigem: quote.moedaOrigem,
      moedaDestino: quote.moedaDestino,
      cotadoEm: { gt: quote.cotadoEm }
    }
  });
  if (newer) return "COTACAO_SUBSTITUIDA";
  return Date.now() - quote.cotadoEm.getTime() > QUOTE_WARNING_DAYS * 86_400_000
    ? "COTACAO_ANTIGA"
    : null;
}

export async function listExchangeRates(
  lojaId: string,
  par: { moedaOrigem?: string; moedaDestino?: string }
) {
  const quotes = await prisma.cotacaoCambio.findMany({
    where: {
      lojaId,
      moedaOrigem: par.moedaOrigem,
      moedaDestino: par.moedaDestino
    },
    orderBy: [{ cotadoEm: "desc" }, { id: "desc" }],
    take: 100
  });
  const seen = new Set<string>();
  return quotes.map((quote) => {
    const key = `${quote.moedaOrigem}:${quote.moedaDestino}`;
    const vigente = !seen.has(key);
    seen.add(key);
    const idadeDias = Math.floor(
      (Date.now() - quote.cotadoEm.getTime()) / 86_400_000
    );
    return {
      ...quote,
      vigente,
      idadeDias,
      aviso: !vigente
        ? "COTACAO_SUBSTITUIDA"
        : idadeDias > QUOTE_WARNING_DAYS
          ? "COTACAO_ANTIGA"
          : null
    };
  });
}

export async function listPayments(lojaId: string, incluirCancelados = false) {
  const all = await prisma.pagamento.findMany({
    where: { lojaId },
    orderBy: { createdAt: "desc" }
  });
  const totals = new Map<
    string,
    {
      bruto: Prisma.Decimal;
      reembolsado: Prisma.Decimal;
      cancelado: Prisma.Decimal;
    }
  >();
  for (const p of all) {
    const t = totals.get(p.moeda) ?? {
      bruto: new Prisma.Decimal(0),
      reembolsado: new Prisma.Decimal(0),
      cancelado: new Prisma.Decimal(0)
    };
    if (p.estornoDeId) t.reembolsado = t.reembolsado.plus(p.valor);
    else if (p.status === "CANCELLED") t.cancelado = t.cancelado.plus(p.valor);
    else t.bruto = t.bruto.plus(p.valor);
    totals.set(p.moeda, t);
  }
  return {
    items: incluirCancelados
      ? all
      : all.filter((p) => !p.estornoDeId && p.status !== "CANCELLED"),
    totais: [...totals].map(([moeda, t]) => ({
      moeda,
      bruto: t.bruto.toFixed(2),
      cancelado: t.cancelado.toFixed(2),
      reembolsado: t.reembolsado.toFixed(2),
      liquido: t.bruto.minus(t.reembolsado).toFixed(2)
    }))
  };
}

export async function createExchange(
  lojaId: string,
  userId: string,
  data: {
    moedaOrigem: string;
    moedaDestino: string;
    valorMercado: number;
    margem: number;
    fonte: string;
    cotadoEm: Date;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CREATE_EXCHANGE_RATE",
    entityId: `${data.moedaOrigem}:${data.moedaDestino}`,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const valorMercado = new Prisma.Decimal(
        data.valorMercado
      ).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
      const margem = new Prisma.Decimal(data.margem).toDecimalPlaces(
        6,
        Prisma.Decimal.ROUND_HALF_UP
      );
      const valor = valorMercado.plus(margem);
      const created = await tx.cotacaoCambio.create({
        data: {
          lojaId,
          responsavelId: userId,
          moedaOrigem: data.moedaOrigem,
          moedaDestino: data.moedaDestino,
          cotadoEm: data.cotadoEm,
          valorMercado,
          margem,
          valor,
          fonte: data.fonte
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "CREATE_EXCHANGE_RATE",
        entity: "CotacaoCambio",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

export async function pay(
  lojaId: string,
  userId: string,
  pedidoCompraId: string,
  data: {
    formaPagamento: FormaPagamento;
    moeda: string;
    valor: number;
    pagoEm?: Date;
    referencia?: string;
    observacoes?: string;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "REGISTER_PAYMENT",
    entityId: pedidoCompraId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const o = await lockedOrder(tx, lojaId, pedidoCompraId);
      // Moeda divergente não é convertida silenciosamente: o saldo do pedido só soma a sua própria moeda.
      if (data.moeda !== o.moeda) throw new AppError(409, "currency_mismatch");
      if (o.status === "CANCELLED") throw new AppError(409, "order_cancelled");
      // Reembolso não reabre a dívida: o saldo da obrigação considera só aplicações brutas.
      const next = obligation(o).pago.plus(money(data.valor));
      if (next.greaterThan(o.total)) throw new AppError(409, "overpayment");
      const created = await tx.pagamento.create({
        data: {
          lojaId,
          pedidoCompraId,
          ...data,
          valor: money(data.valor),
          status: next.equals(o.total) ? "PAID" : "PARTIAL",
          pagoEm: data.pagoEm ?? new Date()
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "REGISTER_PAYMENT",
        entity: "Pagamento",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

export async function refund(
  lojaId: string,
  userId: string,
  id: string,
  valor: number,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "REFUND_PAYMENT",
    entityId: id,
    key,
    payload: { valor },
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "Pagamento" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const original = await tx.pagamento.findFirst({
        where: { id, lojaId, estornoDeId: null }
      });
      if (!original) throw new AppError(404, "not_found");
      const alreadyRefunded = await tx.pagamento.aggregate({
        where: { lojaId, estornoDeId: original.id },
        _sum: { valor: true }
      });
      if (
        money(valor)
          .plus(alreadyRefunded._sum.valor ?? 0)
          .greaterThan(original.valor)
      )
        throw new AppError(409, "refund_exceeds_payment");
      // REFUNDED só com estorno integral; parcial mantém bruto, reembolsado e líquido visíveis.
      if (
        money(valor)
          .plus(alreadyRefunded._sum.valor ?? 0)
          .equals(original.valor)
      )
        await tx.pagamento.update({
          where: { id },
          data: { status: "REFUNDED" }
        });
      const created = await tx.pagamento.create({
        data: {
          lojaId,
          pedidoCompraId: original.pedidoCompraId,
          formaPagamento: original.formaPagamento,
          moeda: original.moeda,
          valor: money(valor),
          status: "REFUNDED",
          pagoEm: new Date(),
          estornoDeId: original.id
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "REFUND_PAYMENT",
        entity: "Pagamento",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        before: original,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

export async function setCosts(
  lojaId: string,
  userId: string,
  pedidoCompraId: string,
  data: {
    cotacaoCambioId?: string;
    iofPercentual: number;
    taxas: number;
    custoAdicional: number;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "SET_ORDER_COSTS",
    entityId: pedidoCompraId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const o = await lockedOrder(tx, lojaId, pedidoCompraId);
      const quote = data.cotacaoCambioId
        ? await tx.cotacaoCambio.findFirst({
            where: { id: data.cotacaoCambioId, lojaId }
          })
        : null;
      if (data.cotacaoCambioId && !quote) throw new AppError(404, "not_found");
      const avisoCotacao = quote ? await quoteWarning(tx, lojaId, quote) : null;
      const base = o.total;
      const iofValor = money(base.mul(data.iofPercentual).div(100));
      const global = money(iofValor.plus(data.taxas).plus(data.custoAdicional));
      const allocations: Prisma.Decimal[] = [];
      let assigned = new Prisma.Decimal(0);
      o.itens.forEach((item, index) => {
        const value =
          index === o.itens.length - 1
            ? global.minus(assigned)
            : o.subtotal.isZero()
              ? money(0)
              : money(global.mul(item.totalItem).div(o.subtotal));
        allocations.push(value);
        assigned = assigned.plus(value);
      });
      const previous = await tx.custoPedido.findUnique({
        where: { pedidoCompraId_lojaId: { pedidoCompraId, lojaId } },
        include: { itens: true }
      });
      const cost = await tx.custoPedido.upsert({
        where: { pedidoCompraId_lojaId: { pedidoCompraId, lojaId } },
        create: {
          lojaId,
          pedidoCompraId,
          cotacaoCambioId: data.cotacaoCambioId,
          iofPercentual: data.iofPercentual,
          iofValor,
          taxas: data.taxas,
          custoAdicional: data.custoAdicional,
          totalGlobal: global
        },
        update: {
          cotacaoCambioId: data.cotacaoCambioId,
          iofPercentual: data.iofPercentual,
          iofValor,
          taxas: data.taxas,
          custoAdicional: data.custoAdicional,
          totalGlobal: global
        }
      });
      await tx.custoPedidoItem.deleteMany({
        where: { custoPedidoId: cost.id }
      });
      for (let i = 0; i < o.itens.length; i++) {
        const item = o.itens[i],
          allocated = allocations[i];
        await tx.custoPedidoItem.create({
          data: {
            lojaId,
            custoPedidoId: cost.id,
            pedidoCompraItemId: item.id,
            custoRateado: allocated,
            custoTotalUnitario: money(
              item.totalItem.plus(allocated).div(item.quantidade)
            )
          }
        });
      }
      const result = await tx.custoPedido.findUniqueOrThrow({
        where: { id: cost.id },
        include: { itens: true }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "SET_ORDER_COSTS",
        entity: "CustoPedido",
        entityId: cost.id,
        correlationId,
        idempotencyKey: key,
        before: previous ?? undefined,
        after: result,
        origin: ORIGIN
      });
      return { ...result, avisoCotacao };
    }
  });
}
