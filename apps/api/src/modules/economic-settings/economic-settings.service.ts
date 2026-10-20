import { Prisma, type CanalVenda, type ModalidadeTaxaMarketplace, type NotaFiscalBase } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit, findIdempotentReplay, idempotentMutation } from "../operations/operations.persistence";

const ORIGIN = "API_ECONOMIC_SETTINGS";
const QUOTE_WARNING_DAYS = 7;
const D = Prisma.Decimal;

/**
 * Referências informadas pelo PO (DECISOES_PRODUTO_2026-10-19, OP-04) para pré-preencher o formulário.
 * São parâmetros de estimativa, não tarifas oficiais: só valem depois de gravados por um usuário.
 */
export const REFERENCIAS_PO = {
  acrescimoCambialBrl: "0.20",
  notaFiscalPercentual: "5",
  notaFiscalBase: "VENDA_BRUTA",
  markupAlertaPercentual: "30",
  frete: { valorPorKg: "90", moeda: "USD" },
  // Só o parcelado entra por ora; a taxa à vista (12%) fica fora da simulação de compra.
  taxas: [{ canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: "16" }]
} as const;

export type SettingsInput = {
  acrescimoCambialBrl: string;
  frete: { valorPorKg: string; moeda: "USD" | "BRL" } | null;
  markupAlertaPercentual: string;
  notaFiscalPercentual: string | null;
  notaFiscalBase: NotaFiscalBase | null;
  iofPercentual: string | null;
  observacoes: string | null;
  taxasMarketplace: {
    canal: CanalVenda;
    modalidade: ModalidadeTaxaMarketplace;
    parcelas: number | null;
    percentual: string;
    descricao: string | null;
  }[];
};

const include = {
  taxasMarketplace: { orderBy: [{ canal: "asc" as const }, { modalidade: "asc" as const }, { parcelas: "asc" as const }] },
  criadoPor: { select: { id: true, name: true } }
};

export const currentSettings = (lojaId: string) =>
  prisma.parametroEconomico.findFirst({ where: { lojaId }, orderBy: { versao: "desc" }, include });

export async function getSettings(lojaId: string) {
  const [vigente, versoes] = await Promise.all([
    currentSettings(lojaId),
    prisma.parametroEconomico.findMany({
      where: { lojaId },
      orderBy: { versao: "desc" },
      take: 20,
      select: { id: true, versao: true, createdAt: true, criadoPor: { select: { name: true } } }
    })
  ]);
  return { vigente, versoes, referenciasPO: REFERENCIAS_PO };
}

export function validateSettings(input: SettingsInput) {
  const seen = new Set<string>();
  for (const taxa of input.taxasMarketplace) {
    if (taxa.modalidade === "A_VISTA" ? taxa.parcelas !== null : taxa.parcelas === null)
      throw new AppError(422, "parcelas_invalidas_para_modalidade");
    const identity = `${taxa.canal}:${taxa.modalidade}:${taxa.parcelas ?? 0}`;
    if (seen.has(identity)) throw new AppError(422, "taxa_marketplace_duplicada");
    seen.add(identity);
  }
  // Percentual sem base fica registrado como "base pendente"; base sem percentual não faz sentido.
  if (input.notaFiscalBase !== null && input.notaFiscalPercentual === null)
    throw new AppError(422, "nota_fiscal_sem_percentual");
}

/** Grava uma nova versão; as anteriores permanecem intactas (snapshots continuam apontando para elas). */
export async function saveSettings(lojaId: string, userId: string, input: SettingsInput, key?: string) {
  validateSettings(input);
  return idempotentMutation({
    lojaId,
    operation: "SAVE_ECONOMIC_SETTINGS",
    entityId: lojaId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const anterior = await tx.parametroEconomico.findFirst({ where: { lojaId }, orderBy: { versao: "desc" }, include });
      const version = await tx.parametroEconomico.create({
        data: {
          lojaId,
          versao: (anterior?.versao ?? 0) + 1,
          acrescimoCambialBrl: new D(input.acrescimoCambialBrl),
          freteValorPorKg: input.frete ? new D(input.frete.valorPorKg) : null,
          freteMoeda: input.frete?.moeda ?? null,
          markupAlertaPercentual: new D(input.markupAlertaPercentual),
          notaFiscalPercentual: input.notaFiscalPercentual === null ? null : new D(input.notaFiscalPercentual),
          notaFiscalBase: input.notaFiscalBase,
          iofPercentual: input.iofPercentual === null ? null : new D(input.iofPercentual),
          observacoes: input.observacoes,
          criadoPorId: userId
        }
      });
      // Gravadas à parte: lojaId compõe a chave estrangeira e não cabe no create aninhado.
      await tx.taxaMarketplaceParametro.createMany({
        data: input.taxasMarketplace.map((taxa) => ({
          lojaId,
          parametroEconomicoId: version.id,
          canal: taxa.canal,
          modalidade: taxa.modalidade,
          parcelas: taxa.parcelas,
          percentual: new D(taxa.percentual),
          descricao: taxa.descricao
        }))
      });
      const created = await tx.parametroEconomico.findUniqueOrThrow({ where: { id: version.id }, include });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "SAVE_ECONOMIC_SETTINGS",
        entity: "ParametroEconomico",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        before: anterior ?? undefined,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

/** Cotação USD→BRL vigente da loja (a mais recente), com a condição de uso. */
export async function currentQuote(lojaId: string) {
  const quote = await prisma.cotacaoCambio.findFirst({
    where: { lojaId, moedaOrigem: "USD", moedaDestino: "BRL" },
    orderBy: [{ cotadoEm: "desc" }, { id: "desc" }]
  });
  if (!quote) return null;
  const idadeDias = Math.floor((Date.now() - quote.cotadoEm.getTime()) / 86_400_000);
  return {
    id: quote.id,
    moedaOrigem: quote.moedaOrigem,
    moedaDestino: quote.moedaDestino,
    referencia: quote.valorMercado.toFixed(6),
    acrescimo: quote.margem.toFixed(6),
    operacional: quote.valor.toFixed(6),
    fonte: quote.fonte,
    cotadoEm: quote.cotadoEm,
    idadeDias,
    condicao: idadeDias > QUOTE_WARNING_DAYS ? ("ANTIGA" as const) : ("VIGENTE" as const)
  };
}

/**
 * Fonte: gráfico público do Yahoo Finance (USDBRL=X), sem cadastro nem credencial. É a cotação de mercado do
 * dólar comercial, a mesma que os sites de câmbio mostram; não há ponta de venda separada.
 * Endpoint não oficial: se mudar ou bloquear, a captura falha com dolar_indisponivel e a cotação manual segue disponível.
 */
export type DolarComercial = { valor: number; cotadoEm: Date };
export const dolarSource = {
  async fetchLatest(): Promise<DolarComercial> {
    const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new AppError(502, "dolar_indisponivel");
    const body = (await response.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] } };
    const meta = body.chart?.result?.[0]?.meta;
    const valor = Number(meta?.regularMarketPrice);
    const cotadoEm = new Date(Number(meta?.regularMarketTime) * 1000);
    if (!(valor > 0) || Number.isNaN(cotadoEm.getTime())) throw new AppError(502, "dolar_resposta_invalida");
    return { valor, cotadoEm };
  }
};
export const DOLAR_FONTE = "Dólar comercial - Yahoo Finance (USD/BRL)";

type DolarCapture = { cotacao: Awaited<ReturnType<typeof prisma.cotacaoCambio.create>>; jaRegistrada: boolean };

/** Registra o dólar comercial do dia (uma cotação por dia, horário de Brasília) somando o acréscimo configurado. */
export async function captureDolar(lojaId: string, userId: string, acrescimoInformado: string | null, key?: string) {
  // A idempotência vale para o pedido como enviado: uma repetição devolve o que já foi gravado,
  // sem depender de a fonte externa responder igual (ou responder) de novo.
  const request = { acrescimoCambialBrl: acrescimoInformado };
  const replay = await findIdempotentReplay<DolarCapture>({ lojaId, operation: "CAPTURE_DOLAR", entityId: "USD:BRL", key, payload: request });
  if (replay) return replay;
  const acrescimo = acrescimoInformado ?? (await currentSettings(lojaId))?.acrescimoCambialBrl.toString() ?? null;
  if (acrescimo === null) throw new AppError(422, "acrescimo_cambial_nao_configurado");
  let dolar: DolarComercial;
  try {
    dolar = await dolarSource.fetchLatest();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "dolar_indisponivel");
  }
  const { cotadoEm } = dolar;
  // Brasília é UTC-3 (sem horário de verão desde 2019): o dia começa às 03:00 UTC.
  const brasilia = new Date(Date.now() - 3 * 3_600_000);
  const inicioDoDia = new Date(Date.UTC(brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate(), 3));

  return idempotentMutation({
    lojaId,
    operation: "CAPTURE_DOLAR",
    entityId: "USD:BRL",
    key,
    payload: request,
    execute: async (tx, correlationId): Promise<DolarCapture> => {
      // Uma cotação por dia: a de hoje, se já registrada, é devolvida.
      const existente = await tx.cotacaoCambio.findFirst({
        where: { lojaId, moedaOrigem: "USD", moedaDestino: "BRL", fonte: DOLAR_FONTE, cotadoEm: { gte: inicioDoDia } }
      });
      if (existente) return { cotacao: existente, jaRegistrada: true };
      const valorMercado = new D(dolar.valor).toDecimalPlaces(6, D.ROUND_HALF_UP);
      const margem = new D(acrescimo).toDecimalPlaces(6, D.ROUND_HALF_UP);
      const created = await tx.cotacaoCambio.create({
        data: {
          lojaId,
          responsavelId: userId,
          moedaOrigem: "USD",
          moedaDestino: "BRL",
          cotadoEm,
          valorMercado,
          margem,
          valor: valorMercado.plus(margem),
          fonte: DOLAR_FONTE
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "CAPTURE_DOLAR",
        entity: "CotacaoCambio",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return { cotacao: created, jaRegistrada: false };
    }
  });
}
