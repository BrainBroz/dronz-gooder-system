import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

export async function dashboard(lojaId: string, from?: Date, to?: Date) {
  const date = from || to ? { gte: from, lte: to } : undefined;
  const [orders, openTrips, pendingReceiving, stocks, payments, products] =
    await Promise.all([
      prisma.pedidoCompra.findMany({
        where: { lojaId, dataCompra: date },
        select: { status: true, total: true }
      }),
      prisma.viagem.count({
        where: {
          lojaId,
          status: {
            in: [
              "PLANNED",
              "OPEN_FOR_ALLOCATION",
              "CLOSED_FOR_ALLOCATION",
              "IN_TRANSIT"
            ]
          }
        }
      }),
      prisma.recebimento.count({
        where: { lojaId, status: { notIn: ["COMPLETED", "REJECTED"] } }
      }),
      prisma.estoque.findMany({
        where: { lojaId },
        select: { quantidadeFisica: true, quantidadeReservada: true }
      }),
      prisma.pagamento.findMany({
        where: { lojaId, createdAt: date },
        select: { valor: true, status: true, estornoDeId: true }
      }),
      prisma.produto.findMany({ where: { lojaId }, select: { markup: true } })
    ]);
  const byStatus = Object.fromEntries(
    [...new Set(orders.map((x) => x.status))].map((s) => [
      s,
      orders.filter((x) => x.status === s).length
    ])
  );
  return {
    orders: {
      count: orders.length,
      total: orders.reduce((s, x) => s + Number(x.total), 0),
      byStatus
    },
    openTrips,
    pendingReceiving,
    inventory: {
      available: stocks.reduce(
        (s, x) => s + x.quantidadeFisica - x.quantidadeReservada,
        0
      ),
      reserved: stocks.reduce((s, x) => s + x.quantidadeReservada, 0),
      zero: stocks.filter(
        (x) => x.quantidadeFisica - x.quantidadeReservada === 0
      ).length
    },
    payments: {
      paid: payments
        .filter((x) => !x.estornoDeId)
        .reduce((s, x) => s + Number(x.valor), 0),
      pending: payments.filter(
        (x) => x.status === "PENDING" || x.status === "PARTIAL"
      ).length
    },
    belowMarkup: products.filter((x) => Number(x.markup) < 25).length
  };
}

export async function report(lojaId: string, type: string) {
  switch (type) {
    case "purchase-orders":
      return prisma.pedidoCompra.findMany({
        where: { lojaId },
        include: { fornecedor: true },
        orderBy: { dataCompra: "desc" }
      });
    case "inventory":
      return prisma.estoque.findMany({
        where: { lojaId },
        include: { produto: true }
      });
    case "movements":
      return prisma.movimentacaoEstoque.findMany({
        where: { lojaId },
        include: { produto: true },
        orderBy: { createdAt: "desc" }
      });
    case "payments":
      return prisma.pagamento.findMany({
        where: { lojaId },
        orderBy: { createdAt: "desc" }
      });
    case "receiving":
      return prisma.recebimento.findMany({
        where: { lojaId },
        include: { itens: true },
        orderBy: { createdAt: "desc" }
      });
    case "costs":
      return prisma.custoPedido.findMany({
        where: { lojaId },
        include: { itens: true, pedido: true }
      });
    default:
      throw new AppError(400, "invalid_report");
  }
}
