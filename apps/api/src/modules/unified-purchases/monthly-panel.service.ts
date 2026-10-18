import { Prisma, type PlataformaCompraExterna } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

// Batch 13 (contrato buyer §9): projeção dinâmica das compras importadas por competência
// `dataPedido`, sem tabela paralela. Moedas nunca são somadas entre si; custos de pedido sem
// rateio aprovado aparecem como "não rateado" (diferença entre total externo e soma das linhas).
export const COMPETENCE_TIMEZONE = "America/Sao_Paulo"; // X-13

export type MonthlyFilters = {
  ano: number;
  mes: number;
  plataforma?: PlataformaCompraExterna;
  contaExternaId?: string;
  merchantExternoId?: string;
  moeda?: string;
  lojaId?: string;
};

const cents = (value: Prisma.Decimal.Value) =>
  BigInt(new Prisma.Decimal(value).mul(100).toFixed(0));
const money = (value: bigint) => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
};

function zoneOffsetMs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value])
  );
  return (
    Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
      +parts.second!
    ) - instant
  );
}
// Início do mês local (meia-noite no fuso) em UTC.
const localMonthStart = (year: number, month: number, timeZone: string) => {
  const guess = Date.UTC(year, month - 1, 1);
  return new Date(guess - zoneOffsetMs(guess, timeZone));
};
export function competenceRange(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new AppError(400, "bad_request");
  return {
    from: localMonthStart(year, month, COMPETENCE_TIMEZONE),
    to:
      month === 12
        ? localMonthStart(year + 1, 1, COMPETENCE_TIMEZONE)
        : localMonthStart(year, month + 1, COMPETENCE_TIMEZONE)
  };
}
const localDate = (value: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: COMPETENCE_TIMEZONE }).format(
    value
  );

async function rows(filters: MonthlyFilters) {
  const { from, to } = competenceRange(filters.ano, filters.mes);
  return prisma.compraImportada.findMany({
    where: {
      dataPedido: { gte: from, lt: to },
      ...(filters.plataforma ? { plataforma: filters.plataforma } : {}),
      ...(filters.contaExternaId
        ? { contaExternaId: filters.contaExternaId }
        : {}),
      ...(filters.merchantExternoId
        ? { merchantExternoId: filters.merchantExternoId }
        : {}),
      ...(filters.moeda ? { moeda: filters.moeda } : {}),
      ...(filters.lojaId
        ? {
            itens: {
              some: { atribuicoes: { some: { lojaId: filters.lojaId } } }
            }
          }
        : {})
    },
    include: {
      contaExterna: { select: { nomeExibicao: true } },
      merchantExterno: { select: { nomeOriginal: true } },
      itens: {
        include: {
          atribuicoes: {
            select: {
              lojaId: true,
              quantidade: true,
              quantidadeMaterializada: true
            }
          },
          mapeamentos: { where: { status: "ATIVO" }, select: { id: true } }
        }
      },
      conflitos: { where: { status: "ABERTO" }, select: { id: true } }
    },
    orderBy: [{ dataPedido: "asc" }, { id: "asc" }]
  });
}

export async function monthlyPanel(filters: MonthlyFilters) {
  const [purchases, stores] = await Promise.all([
    rows(filters),
    prisma.loja.findMany({
      orderBy: { slug: "asc" },
      select: { id: true, slug: true, nome: true }
    })
  ]);
  type Bucket = {
    pedidos: Set<string>;
    linhas: number;
    unidades: number;
    bruto: bigint;
    cancelado: bigint;
    reembolsado: bigint;
    pendente: bigint;
    materializado: bigint;
    naoRateado: bigint;
    lojas: Map<
      string,
      { valor: bigint; unidades: number; pedidos: Set<string> }
    >;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (currency: string) => {
    if (!buckets.has(currency))
      buckets.set(currency, {
        pedidos: new Set(),
        linhas: 0,
        unidades: 0,
        bruto: 0n,
        cancelado: 0n,
        reembolsado: 0n,
        pendente: 0n,
        materializado: 0n,
        naoRateado: 0n,
        lojas: new Map(
          stores.map((store) => [
            store.id,
            { valor: 0n, unidades: 0, pedidos: new Set<string>() }
          ])
        )
      });
    return buckets.get(currency)!;
  };
  let conflitos = 0,
    mappingsPendentes = 0;
  for (const purchase of purchases) {
    conflitos += purchase.conflitos.length;
    let linesTotal = 0n;
    for (const item of purchase.itens) {
      const current = bucket(item.moeda);
      const price = cents(item.precoUnitario);
      const eligible =
        item.quantidade - item.quantidadeCancelada - item.quantidadeReembolsada;
      const assigned = item.atribuicoes.reduce(
        (sum, entry) => sum + entry.quantidade,
        0
      );
      current.pedidos.add(purchase.id);
      current.linhas += 1;
      current.unidades += item.quantidade;
      current.bruto += price * BigInt(item.quantidade);
      current.cancelado += price * BigInt(item.quantidadeCancelada);
      current.reembolsado += price * BigInt(item.quantidadeReembolsada);
      current.pendente += price * BigInt(Math.max(0, eligible - assigned));
      linesTotal += price * BigInt(item.quantidade);
      if (!item.mapeamentos.length) mappingsPendentes += 1;
      for (const entry of item.atribuicoes) {
        const store = current.lojas.get(entry.lojaId);
        if (!store) continue;
        store.valor += price * BigInt(entry.quantidade);
        store.unidades += entry.quantidade;
        if (entry.quantidade > 0) store.pedidos.add(purchase.id);
        current.materializado += price * BigInt(entry.quantidadeMaterializada);
      }
    }
    if (purchase.totalExterno !== null)
      bucket(purchase.moeda).naoRateado +=
        cents(purchase.totalExterno) - linesTotal;
  }
  const semDataPedido = await prisma.compraImportada.count({
    where: { dataPedido: null }
  });
  const pending = await prisma.buyerPurchaseCandidate.findMany({
    where: { status: { in: ["AGUARDANDO_APROVACAO", "COM_DIVERGENCIA"] } },
    select: { currentEvidence: { select: { normalizedPayload: true } } }
  });
  const { from, to } = competenceRange(filters.ano, filters.mes);
  const pendingByCurrency = new Map<
    string,
    { candidatos: number; valor: bigint }
  >();
  for (const candidate of pending) {
    const order = candidate.currentEvidence.normalizedPayload as {
      orderedAt?: string;
      currency?: string;
      items?: { quantity: number; unitPrice: number }[];
    };
    const at = Date.parse(order.orderedAt ?? "");
    if (!(at >= from.getTime() && at < to.getTime()) || !order.currency)
      continue;
    if (filters.moeda && order.currency.toUpperCase() !== filters.moeda)
      continue;
    const entry = pendingByCurrency.get(order.currency.toUpperCase()) ?? {
      candidatos: 0,
      valor: 0n
    };
    entry.candidatos += 1;
    entry.valor += (order.items ?? []).reduce(
      (sum, item) => sum + cents(item.unitPrice) * BigInt(item.quantity),
      0n
    );
    pendingByCurrency.set(order.currency.toUpperCase(), entry);
  }
  return {
    competencia: {
      ano: filters.ano,
      mes: filters.mes,
      timezone: COMPETENCE_TIMEZONE,
      inicio: from.toISOString(),
      fim: to.toISOString()
    },
    referenciaEm: new Date().toISOString(),
    moedas: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moeda, value]) => ({
        moeda,
        pedidos: value.pedidos.size,
        linhas: value.linhas,
        unidades: value.unidades,
        bruto: money(value.bruto),
        cancelado: money(value.cancelado),
        reembolsado: money(value.reembolsado),
        liquido: money(value.bruto - value.cancelado - value.reembolsado),
        pendenteAtribuicao: money(value.pendente),
        materializado: money(value.materializado),
        naoRateado: money(value.naoRateado),
        lojas: stores.map((store) => {
          const entry = value.lojas.get(store.id)!;
          return {
            lojaId: store.id,
            slug: store.slug,
            nome: store.nome,
            valor: money(entry.valor),
            unidades: entry.unidades,
            pedidos: entry.pedidos.size
          };
        })
      })),
    pendentesAprovacao: [...pendingByCurrency.entries()].map(
      ([moeda, value]) => ({
        moeda,
        candidatos: value.candidatos,
        valor: money(value.valor)
      })
    ),
    semDataPedido,
    conflitosAbertos: conflitos,
    mappingsPendentes,
    definicoes: {
      competencia: "Mês de dataPedido no fuso America/Sao_Paulo (X-13).",
      pedidosPorLoja:
        "Uma compra conta uma vez em cada loja com atribuição positiva; a soma por loja pode exceder o total.",
      naoRateado:
        "Total externo do pedido menos a soma das linhas (frete, imposto, desconto); sem rateio entre lojas.",
      pendentesAprovacao:
        "Candidatos buyer ainda não aprovados; não entram nos totais de compras."
    }
  };
}

// Neutraliza fórmula em planilha (=, +, -, @) e escapa aspas.
const csvCell = (value: string | number) => {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function monthlyCsv(filters: MonthlyFilters) {
  const [purchases, stores] = await Promise.all([
    rows(filters),
    prisma.loja.findMany({
      orderBy: { slug: "asc" },
      select: { id: true, slug: true }
    })
  ]);
  const header = [
    "data_pedido",
    "plataforma",
    "conta",
    "merchant",
    "pedido",
    "linha",
    "titulo",
    "moeda",
    "quantidade",
    "cancelada",
    "reembolsada",
    "preco_unitario",
    "valor_bruto",
    ...stores.flatMap((store) => [`qtd_${store.slug}`, `valor_${store.slug}`]),
    "qtd_pendente",
    "valor_pendente",
    "qtd_materializada",
    "estado"
  ];
  const lines = [header.join(",")];
  for (const purchase of purchases)
    for (const item of purchase.itens) {
      const price = cents(item.precoUnitario);
      const eligible =
        item.quantidade - item.quantidadeCancelada - item.quantidadeReembolsada;
      const byStore = new Map(
        item.atribuicoes.map((entry) => [entry.lojaId, entry])
      );
      const assigned = item.atribuicoes.reduce(
        (sum, entry) => sum + entry.quantidade,
        0
      );
      const pending = Math.max(0, eligible - assigned);
      lines.push(
        [
          localDate(purchase.dataPedido!),
          purchase.plataforma,
          purchase.contaExterna?.nomeExibicao ?? "",
          purchase.merchantExterno?.nomeOriginal ?? "",
          purchase.externalOrderIdOriginal ?? purchase.numeroPedido,
          item.externalLineIdOriginal ?? item.id,
          item.titulo,
          item.moeda,
          item.quantidade,
          item.quantidadeCancelada,
          item.quantidadeReembolsada,
          money(price),
          money(price * BigInt(item.quantidade)),
          ...stores.flatMap((store) => {
            const quantity = byStore.get(store.id)?.quantidade ?? 0;
            return [quantity, money(price * BigInt(quantity))];
          }),
          pending,
          money(price * BigInt(pending)),
          item.atribuicoes.reduce(
            (sum, entry) => sum + entry.quantidadeMaterializada,
            0
          ),
          purchase.estado
        ]
          .map(csvCell)
          .join(",")
      );
    }
  return `${lines.join("\n")}\n`;
}
