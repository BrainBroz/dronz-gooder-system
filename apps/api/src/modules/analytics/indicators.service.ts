import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { saleInclude, saleView } from "../sales/sales.service";

// Batch 18: read models derivados e reconstruíveis (não é ledger paralelo). Cada indicador declara
// código, versão, fonte e fórmula; a execução devolve parâmetros e o instante de corte para reproduzir.
const VERSION = "B18-v1";

type Definition = {
  codigo: string;
  descricao: string;
  fonte: string;
  formula: string;
  financeiro: boolean;
};
export const DEFINITIONS: Definition[] = [
  {
    codigo: "COMPRAS_PEDIDOS",
    descricao: "Pedidos de compra por status",
    fonte: "PedidoCompra.dataCompra",
    formula: "contagem de pedidos por status",
    financeiro: false
  },
  {
    codigo: "COMPRAS_VALOR",
    descricao: "Valor dos pedidos de compra",
    fonte: "PedidoCompra.total",
    formula: "soma de total por moeda, exceto CANCELLED",
    financeiro: true
  },
  {
    codigo: "LEAD_TIME_COMPRA_ENTRADA",
    descricao: "Dias entre a compra e a entrada definitiva no Brasil",
    fonte: "MovimentacaoEstoque ENTRY × PedidoCompra.dataCompra",
    formula: "média de (ENTRY.createdAt − dataCompra) em dias, por lote",
    financeiro: false
  },
  {
    codigo: "ESTOQUE_BR",
    descricao: "Unidades no estoque Brasil",
    fonte: "Estoque (instantâneo no corte)",
    formula: "disponível = físico − reservado; reservado",
    financeiro: false
  },
  {
    codigo: "VENDAS_POR_CANAL",
    descricao: "Vendas confirmadas por canal",
    fonte: "Venda.dataVenda (CONFIRMADA)",
    formula: "contagem e receita líquida por canal e moeda",
    financeiro: true
  },
  {
    codigo: "MARGEM_REALIZADA",
    descricao: "Margem das vendas com custo conhecido",
    fonte: "BaixaVenda (snapshot X-10)",
    formula:
      "Σ lucro / Σ receita líquida das vendas com custo na moeda da venda",
    financeiro: true
  },
  {
    codigo: "FLUXO_FINANCEIRO",
    descricao: "Saídas e entradas de caixa registradas",
    fonte: "Pagamento, PagamentoFatura, AuditLog RECEIVE_SALE",
    formula:
      "pagamentos a fornecedor − reembolsos; pagamentos de fatura; recebimentos de venda",
    financeiro: true
  }
];

type Row = {
  codigo: string;
  versao: string;
  dimensao: string | null;
  moeda: string | null;
  valor: string | null;
  amostra: number;
  status: "OK" | "SEM_AMOSTRA";
};
const row = (
  codigo: string,
  dimensao: string | null,
  moeda: string | null,
  valor: string | null,
  amostra: number
): Row => ({
  codigo,
  versao: VERSION,
  dimensao,
  moeda,
  valor,
  amostra,
  status: amostra ? "OK" : "SEM_AMOSTRA"
});
const empty = (codigo: string) => row(codigo, null, null, null, 0);
const receiptSnapshot = z.object({
  moeda: z.string(),
  valorRecebido: z.string().regex(/^\d+(\.\d+)?$/),
  dataRecebida: z.string().datetime().nullable()
});
const add = (
  map: Map<string, { valor: Prisma.Decimal; amostra: number }>,
  key: string,
  valor: Prisma.Decimal.Value
) => {
  const current = map.get(key) ?? { valor: new Prisma.Decimal(0), amostra: 0 };
  map.set(key, {
    valor: current.valor.plus(valor),
    amostra: current.amostra + 1
  });
};

export async function indicators(
  lojaId: string,
  filters: { from?: Date; to?: Date; moeda?: string },
  financial: boolean
) {
  return prisma.$transaction(
    (db) => readIndicators(db, lojaId, filters, financial),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    }
  );
}

async function readIndicators(
  db: Prisma.TransactionClient,
  lojaId: string,
  filters: { from?: Date; to?: Date; moeda?: string },
  financial: boolean
) {
  const [clock] = await db.$queryRaw<
    { referenciaEm: Date }[]
  >`SELECT statement_timestamp() AS "referenciaEm"`;
  const referenciaEm = clock!.referenciaEm;
  const period = {
    gte: filters.from,
    lt: filters.to ?? referenciaEm
  };
  const moeda = filters.moeda?.toUpperCase();
  const rows: Row[] = [];

  const orders = await db.pedidoCompra.findMany({
    where: { lojaId, dataCompra: period },
    select: { status: true, total: true, moeda: true }
  });
  const byStatus = new Map<string, number>();
  for (const order of orders)
    byStatus.set(order.status, (byStatus.get(order.status) ?? 0) + 1);
  rows.push(
    ...(byStatus.size
      ? [...byStatus].map(([status, count]) =>
          row("COMPRAS_PEDIDOS", status, null, String(count), count)
        )
      : [empty("COMPRAS_PEDIDOS")])
  );
  if (financial) {
    const values = new Map<
      string,
      { valor: Prisma.Decimal; amostra: number }
    >();
    for (const order of orders)
      if (order.status !== "CANCELLED" && (!moeda || order.moeda === moeda))
        add(values, order.moeda, order.total);
    rows.push(
      ...(values.size
        ? [...values].map(([currency, v]) =>
            row("COMPRAS_VALOR", null, currency, v.valor.toFixed(2), v.amostra)
          )
        : [empty("COMPRAS_VALOR")])
    );
  }

  const lots = await db.movimentacaoEstoque.findMany({
    where: {
      lojaId,
      tipo: "ENTRY",
      createdAt: period,
      pedidoCompraItemId: { not: null }
    },
    select: {
      createdAt: true,
      pedidoItem: { select: { pedido: { select: { dataCompra: true } } } }
    }
  });
  const days = lots.map(
    (lot) =>
      (lot.createdAt.getTime() - lot.pedidoItem!.pedido.dataCompra.getTime()) /
      86_400_000
  );
  rows.push(
    row(
      "LEAD_TIME_COMPRA_ENTRADA",
      null,
      null,
      days.length
        ? (days.reduce((sum, value) => sum + value, 0) / days.length).toFixed(1)
        : null,
      days.length
    )
  );

  const stock = await db.estoque.findMany({
    where: { lojaId },
    select: { quantidadeFisica: true, quantidadeReservada: true }
  });
  const reserved = stock.reduce((sum, s) => sum + s.quantidadeReservada, 0);
  const physical = stock.reduce((sum, s) => sum + s.quantidadeFisica, 0);
  rows.push(
    row(
      "ESTOQUE_BR",
      "DISPONIVEL",
      null,
      String(physical - reserved),
      stock.length
    ),
    row("ESTOQUE_BR", "RESERVADO", null, String(reserved), stock.length)
  );

  if (financial) {
    const sales = await db.venda.findMany({
      where: {
        lojaId,
        estado: "CONFIRMADA",
        dataVenda: period,
        ...(moeda ? { moeda } : {})
      },
      include: saleInclude
    });
    const views = sales.map((sale) => saleView(sale, true));
    const byChannel = new Map<
      string,
      { valor: Prisma.Decimal; amostra: number }
    >();
    for (const view of views)
      add(byChannel, `${view.canal}|${view.moeda}`, view.receitaLiquida);
    rows.push(
      ...(byChannel.size
        ? [...byChannel].map(([key, v]) => {
            const [canal, currency] = key.split("|");
            return row(
              "VENDAS_POR_CANAL",
              canal!,
              currency!,
              v.valor.toFixed(2),
              v.amostra
            );
          })
        : [empty("VENDAS_POR_CANAL")])
    );
    // Venda sem custo conhecido fica fora da margem e é contada à parte; nada de custo presumido.
    const margins = new Map<
      string,
      {
        lucro: Prisma.Decimal;
        liquido: Prisma.Decimal;
        amostra: number;
        semCusto: number;
      }
    >();
    for (const view of views) {
      const current = margins.get(view.moeda) ?? {
        lucro: new Prisma.Decimal(0),
        liquido: new Prisma.Decimal(0),
        amostra: 0,
        semCusto: 0
      };
      if (view.lucro === null || view.lucro === undefined) current.semCusto++;
      else {
        current.lucro = current.lucro.plus(view.lucro);
        current.liquido = current.liquido.plus(view.receitaLiquida);
        current.amostra++;
      }
      margins.set(view.moeda, current);
    }
    rows.push(
      ...(margins.size
        ? [...margins].flatMap(([currency, m]) => [
            row(
              "MARGEM_REALIZADA",
              "PERCENTUAL",
              currency,
              m.amostra && !m.liquido.isZero()
                ? m.lucro.div(m.liquido).mul(100).toFixed(2)
                : null,
              m.amostra
            ),
            row(
              "MARGEM_REALIZADA",
              "VENDAS_SEM_CUSTO",
              currency,
              String(m.semCusto),
              m.semCusto
            )
          ])
        : [empty("MARGEM_REALIZADA")])
    );

    const flows = new Map<string, { valor: Prisma.Decimal; amostra: number }>();
    const payments = await db.pagamento.findMany({
      where: {
        lojaId,
        pagoEm: period,
        status: { not: "CANCELLED" },
        ...(moeda ? { moeda } : {})
      },
      select: { moeda: true, valor: true, estornoDeId: true }
    });
    for (const payment of payments)
      add(
        flows,
        `PAGAMENTO_FORNECEDOR_LIQUIDO|${payment.moeda}`,
        payment.estornoDeId ? payment.valor.neg() : payment.valor
      );
    const statementPayments = await db.pagamentoFatura.findMany({
      where: {
        lojaId,
        pagoEm: period,
        ...(moeda ? { fatura: { moeda } } : {})
      },
      select: { valor: true, fatura: { select: { moeda: true } } }
    });
    for (const payment of statementPayments)
      add(flows, `PAGAMENTO_FATURA|${payment.fatura.moeda}`, payment.valor);
    // Cada parcela já tem antes/depois imutáveis no AuditLog; saldo acumulado não é fluxo mensal.
    const receipts = await db.auditLog.findMany({
      where: {
        lojaId,
        entity: "RecebivelVenda",
        action: "RECEIVE_SALE",
        AND: [
          {
            afterData: {
              path: ["dataRecebida"],
              lt: (filters.to ?? referenciaEm).toISOString()
            }
          },
          ...(filters.from
            ? [
                {
                  afterData: {
                    path: ["dataRecebida"],
                    gte: filters.from.toISOString()
                  }
                }
              ]
            : []),
          ...(moeda ? [{ afterData: { path: ["moeda"], equals: moeda } }] : [])
        ]
      },
      select: { beforeData: true, afterData: true }
    });
    for (const receipt of receipts) {
      const before = receiptSnapshot.safeParse(receipt.beforeData);
      const after = receiptSnapshot.safeParse(receipt.afterData);
      if (
        !before.success ||
        !after.success ||
        before.data.moeda !== after.data.moeda
      )
        throw new AppError(409, "sale_receipt_history_requires_reconciliation");
      const amount = new Prisma.Decimal(after.data.valorRecebido).minus(
        before.data.valorRecebido
      );
      if (amount.isNegative())
        throw new AppError(409, "sale_receipt_history_requires_reconciliation");
      add(flows, `RECEBIMENTO_VENDA|${after.data.moeda}`, amount);
    }
    rows.push(
      ...(flows.size
        ? [...flows].map(([key, v]) => {
            const [dimensao, currency] = key.split("|");
            return row(
              "FLUXO_FINANCEIRO",
              dimensao!,
              currency!,
              v.valor.toFixed(2),
              v.amostra
            );
          })
        : [empty("FLUXO_FINANCEIRO")])
    );
  }

  return {
    versao: VERSION,
    referenciaEm,
    parametros: {
      from: filters.from ?? null,
      to: filters.to ?? null,
      moeda: moeda ?? null,
      financeiro: financial
    },
    definicoes: DEFINITIONS.filter((d) => financial || !d.financeiro).map(
      (d) => ({
        ...d,
        versao: VERSION
      })
    ),
    linhas: rows
  };
}

const CSV_COLUMNS = [
  "codigo",
  "versao",
  "dimensao",
  "moeda",
  "valor",
  "amostra",
  "status"
] as const;
const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutraliza fórmula em planilha e escapa aspas/vírgulas.
  const numeric = /^-?\d+(\.\d+)?$/.test(text);
  const safe = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function indicatorsCsv(result: Awaited<ReturnType<typeof indicators>>) {
  return (
    [
      CSV_COLUMNS.join(","),
      ...result.linhas.map((line) =>
        CSV_COLUMNS.map((column) => csvCell(line[column])).join(",")
      )
    ].join("\n") + "\n"
  );
}
