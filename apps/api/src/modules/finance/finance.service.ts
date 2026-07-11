import { Prisma, type FormaPagamento } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

async function order(lojaId: string, id: string) {
  const item = await prisma.pedidoCompra.findFirst({
    where: { id, lojaId },
    include: { itens: true, pagamentos: true }
  });
  if (!item) throw new AppError(404, "not_found");
  return item;
}

export const listPayments = (lojaId: string) =>
  prisma.pagamento.findMany({
    where: { lojaId },
    orderBy: { createdAt: "desc" }
  });

export async function createExchange(
  lojaId: string,
  userId: string,
  data: {
    moedaOrigem: string;
    moedaDestino: string;
    valor: number;
    cotadoEm: Date;
  }
) {
  return prisma.cotacaoCambio.create({
    data: {
      lojaId,
      responsavelId: userId,
      ...data,
      valor: new Prisma.Decimal(data.valor).toDecimalPlaces(
        6,
        Prisma.Decimal.ROUND_HALF_UP
      )
    }
  });
}

export async function pay(
  lojaId: string,
  pedidoCompraId: string,
  data: {
    formaPagamento: FormaPagamento;
    moeda: string;
    valor: number;
    pagoEm?: Date;
    referencia?: string;
    observacoes?: string;
  }
) {
  const o = await order(lojaId, pedidoCompraId);
  const paid = o.pagamentos
    .filter((p) => p.status !== "CANCELLED" && !p.estornoDeId)
    .reduce((s, p) => s.plus(p.valor), new Prisma.Decimal(0));
  const refunds = o.pagamentos
    .filter((p) => !!p.estornoDeId)
    .reduce((s, p) => s.plus(p.valor), new Prisma.Decimal(0));
  const next = paid.minus(refunds).plus(data.valor);
  if (next.greaterThan(o.total)) throw new AppError(409, "overpayment");
  const status = next.equals(o.total) ? "PAID" : "PARTIAL";
  return prisma.pagamento.create({
    data: {
      lojaId,
      pedidoCompraId,
      ...data,
      valor: money(data.valor),
      status,
      pagoEm: data.pagoEm ?? new Date()
    }
  });
}

export async function refund(lojaId: string, id: string, valor: number) {
  const original = await prisma.pagamento.findFirst({
    where: { id, lojaId, estornoDeId: null }
  });
  if (!original) throw new AppError(404, "not_found");
  const alreadyRefunded = await prisma.pagamento.aggregate({
    where: { lojaId, estornoDeId: original.id },
    _sum: { valor: true }
  });
  if (
    money(valor)
      .plus(alreadyRefunded._sum.valor ?? 0)
      .greaterThan(original.valor)
  )
    throw new AppError(409, "refund_exceeds_payment");
  return prisma.$transaction(async (tx) => {
    await tx.pagamento.update({ where: { id }, data: { status: "REFUNDED" } });
    return tx.pagamento.create({
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
  });
}

export async function setCosts(
  lojaId: string,
  pedidoCompraId: string,
  data: {
    cotacaoCambioId?: string;
    iofPercentual: number;
    taxas: number;
    custoAdicional: number;
  }
) {
  const o = await order(lojaId, pedidoCompraId);
  if (
    data.cotacaoCambioId &&
    !(await prisma.cotacaoCambio.findFirst({
      where: { id: data.cotacaoCambioId, lojaId }
    }))
  )
    throw new AppError(404, "not_found");
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
  return prisma.$transaction(async (tx) => {
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
    await tx.custoPedidoItem.deleteMany({ where: { custoPedidoId: cost.id } });
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
    return tx.custoPedido.findUniqueOrThrow({
      where: { id: cost.id },
      include: { itens: true }
    });
  });
}
