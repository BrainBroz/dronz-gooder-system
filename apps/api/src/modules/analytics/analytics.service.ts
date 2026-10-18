import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

// Soma valores só dentro da mesma moeda; moedas diferentes nunca são somadas entre si (B18).
const byCurrency = (rows: { moeda: string; valor: Prisma.Decimal }[]) => {
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows)
    totals.set(
      row.moeda,
      (totals.get(row.moeda) ?? new Prisma.Decimal(0)).plus(row.valor)
    );
  return Object.fromEntries(
    [...totals].map(([moeda, valor]) => [moeda, valor.toFixed(2)])
  );
};

export async function dashboard(
  lojaId: string,
  from?: Date,
  to?: Date,
  financial = false
) {
  const date = from || to ? { gte: from, lte: to } : undefined;
  const [orders, openTrips, pendingReceiving, stocks, payments, products] =
    await Promise.all([
      prisma.pedidoCompra.findMany({
        where: { lojaId, dataCompra: date },
        select: { status: true, total: true, moeda: true }
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
        select: { valor: true, status: true, estornoDeId: true, moeda: true }
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
      // Valores só com acesso financeiro; null indica ausência de permissão, não zero.
      total: financial
        ? byCurrency(orders.map((x) => ({ moeda: x.moeda, valor: x.total })))
        : null,
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
      paid: financial
        ? byCurrency(payments.filter((x) => !x.estornoDeId))
        : null,
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
            include: {
              custosRateados: {
                include: { custo: { include: { cotacaoCambio: true } } }
              },
              pedido: { select: { moeda: true } }
            },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      });
      return products.map((product) => {
        const item = product.pedidoCompraItens[0];
        const cost = item?.custosRateados[0];
        const rate = cost?.custo.cotacaoCambio;
        // Preço de venda é BRL: custo em outra moeda só entra convertido pelo câmbio registrado.
        const custo = !cost
          ? null
          : item.pedido.moeda === "BRL"
            ? Number(cost.custoTotalUnitario)
            : rate &&
                rate.moedaOrigem === item.pedido.moeda &&
                rate.moedaDestino === "BRL"
              ? Number(cost.custoTotalUnitario.mul(rate.valor))
              : null;
        const venda = Number(product.precoVenda);
        return {
          id: product.id,
          lojaId,
          codigo: product.codigo,
          nome: product.nome,
          precoVenda: product.precoVenda,
          custoTotalUnitario: custo,
          moedaCustoOriginal: item?.pedido.moeda ?? null,
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
