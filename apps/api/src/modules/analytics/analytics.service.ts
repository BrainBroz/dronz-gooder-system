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

type ReportFilters = { from?: Date; to?: Date; status?: string };
export async function report(
  lojaId: string,
  type: string,
  filters: ReportFilters = {}
) {
  const period =
    filters.from || filters.to
      ? { gte: filters.from, lte: filters.to }
      : undefined;
  const allowedStatuses: Record<string, readonly string[]> = {
    "purchase-orders": [
      "DRAFT",
      "PLACED",
      "CONFIRMED",
      "PARTIALLY_RECEIVED_MIAMI",
      "RECEIVED_MIAMI",
      "ALLOCATED_TO_TRIP",
      "IN_TRANSIT_BRAZIL",
      "ARRIVED_BRAZIL",
      "COMPLETED",
      "CANCELLED"
    ],
    logistics: [
      "PLANNED",
      "OPEN_FOR_ALLOCATION",
      "CLOSED_FOR_ALLOCATION",
      "IN_TRANSIT",
      "ARRIVED_BRAZIL",
      "CANCELLED"
    ],
    receiving: [
      "PENDING",
      "IN_PROGRESS",
      "PARTIALLY_COMPLETED",
      "COMPLETED",
      "REJECTED"
    ],
    payments: ["PENDING", "PARTIAL", "PAID", "REFUNDED", "CANCELLED"]
  };
  if (
    filters.status &&
    (!allowedStatuses[type] || !allowedStatuses[type].includes(filters.status))
  )
    throw new AppError(400, "invalid_status");
  switch (type) {
    case "purchase-orders":
      return prisma.pedidoCompra.findMany({
        where: {
          lojaId,
          dataCompra: period,
          ...(filters.status ? { status: filters.status as never } : {})
        },
        include: { fornecedor: true },
        orderBy: { dataCompra: "desc" }
      });
    case "purchase-items":
      return prisma.pedidoCompraItem.findMany({
        where: { lojaId, pedido: { dataCompra: period } },
        include: { produto: true, pedido: true },
        orderBy: { createdAt: "desc" }
      });
    case "logistics":
      return prisma.viagem.findMany({
        where: {
          lojaId,
          partidaEm: period,
          ...(filters.status ? { status: filters.status as never } : {})
        },
        include: {
          viajante: { select: { id: true, nome: true } },
          malas: true
        },
        orderBy: { partidaEm: "desc" }
      });
    case "suitcase-weight": {
      const bags = await prisma.mala.findMany({
        where: { lojaId },
        include: { volumes: true, alocacoes: true }
      });
      return bags.map((bag) => {
        const conteudoKg = bag.alocacoes.reduce(
          (sum, allocation) => sum + Number(allocation.pesoConteudoKg),
          0
        );
        const taraKg = bag.volumes.reduce(
          (sum, volume) => sum + Number(volume.taraKg),
          0
        );
        return {
          id: bag.id,
          lojaId: bag.lojaId,
          codigo: bag.codigo,
          status: bag.status,
          conteudoKg,
          taraKg,
          totalKg: conteudoKg + taraKg,
          limitePesoKg: bag.limitePesoKg
        };
      });
    }
    case "inventory":
      return prisma.estoque.findMany({
        where: { lojaId, createdAt: period },
        include: { produto: true }
      });
    case "movements":
      return prisma.movimentacaoEstoque.findMany({
        where: { lojaId, createdAt: period },
        include: { produto: true },
        orderBy: { createdAt: "desc" }
      });
    case "payments":
      return prisma.pagamento.findMany({
        where: {
          lojaId,
          createdAt: period,
          ...(filters.status ? { status: filters.status as never } : {})
        },
        orderBy: { createdAt: "desc" }
      });
    case "receiving":
      return prisma.recebimento.findMany({
        where: {
          lojaId,
          createdAt: period,
          ...(filters.status ? { status: filters.status as never } : {})
        },
        include: { itens: true },
        orderBy: { createdAt: "desc" }
      });
    case "costs":
      return prisma.custoPedido.findMany({
        where: { lojaId, createdAt: period },
        include: { itens: true, pedido: true }
      });
    case "markup": {
      const products = await prisma.produto.findMany({
        where: { lojaId },
        include: {
          pedidoCompraItens: {
            include: { custosRateados: true },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      });
      return products.map((product) => {
        const cost = product.pedidoCompraItens[0]?.custosRateados[0];
        const custo = cost ? Number(cost.custoTotalUnitario) : null;
        const venda = Number(product.precoVenda);
        return {
          id: product.id,
          lojaId,
          codigo: product.codigo,
          nome: product.nome,
          precoVenda: product.precoVenda,
          custoTotalUnitario: custo,
          markup: custo && venda > 0 ? ((venda - custo) / custo) * 100 : null,
          margem: custo && venda > 0 ? ((venda - custo) / venda) * 100 : null,
          precoExibicao: venda === 0 ? "A definir" : product.precoVenda
        };
      });
    }
    default:
      throw new AppError(400, "invalid_report");
  }
}
