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
  markupAlertaPercentual: "25",
  taxas: [
    { modalidade: "A_VISTA", parcelas: null, percentual: "12" },
    { modalidade: "PARCELADO", parcelas: null, percentual: "16", observacao: "Informada com 2 parcelas; uso frequente de 12. Confirme o plano." }
  ]
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
 * Fonte: API de dados abertos do Banco Central (Olinda, serviço PTAX), sem cadastro nem credencial.
 * Captura a PTAX de VENDA do boletim de FECHAMENTO (publicada em dias úteis, por volta das 13h).
 * PTAX é taxa de referência calculada pelo BCB; não é o dólar comercial nem a taxa paga numa operação.
 */
export type PtaxBoletim = { cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string };
export const ptaxSource = {
  async fetchPeriod(from: Date, to: Date): Promise<PtaxBoletim[]> {
    const fmt = (date: Date) =>
      `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
    const url =
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
      `?@moeda='USD'&@dataInicial='${fmt(from)}'&@dataFinalCotacao='${fmt(to)}'&$format=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new AppError(502, "ptax_indisponivel");
    const body = (await response.json()) as { value?: PtaxBoletim[] };
    return body.value ?? [];
  }
};
export const PTAX_FONTE = "BCB PTAX venda - boletim de fechamento";

// dataHoraCotacao vem no horário de Brasília (sem horário de verão desde 2019): "2026-10-19 13:05:47.20983".
const parseBcbTime = (value: string) => new Date(`${value.replace(" ", "T").slice(0, 23)}-03:00`);

type PtaxCapture = { cotacao: Awaited<ReturnType<typeof prisma.cotacaoCambio.create>>; jaRegistrada: boolean };

export async function capturePtax(lojaId: string, userId: string, acrescimoInformado: string | null, key?: string) {
  // A idempotência vale para o pedido como enviado: uma repetição devolve o que já foi gravado,
  // sem depender de a fonte externa responder igual (ou responder) de novo.
  const request = { acrescimoCambialBrl: acrescimoInformado };
  const replay = await findIdempotentReplay<PtaxCapture>({ lojaId, operation: "CAPTURE_PTAX", entityId: "USD:BRL", key, payload: request });
  if (replay) return replay;
  const acrescimo = acrescimoInformado ?? (await currentSettings(lojaId))?.acrescimoCambialBrl.toString() ?? null;
  if (acrescimo === null) throw new AppError(422, "acrescimo_cambial_nao_configurado");
  const now = new Date();
  let boletins: PtaxBoletim[];
  try {
    boletins = await ptaxSource.fetchPeriod(new Date(now.getTime() - 10 * 86_400_000), now);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "ptax_indisponivel");
  }
  const fechamento = boletins
    .filter((boletim) => boletim.tipoBoletim === "Fechamento" && Number(boletim.cotacaoVenda) > 0)
    .sort((a, b) => b.dataHoraCotacao.localeCompare(a.dataHoraCotacao))[0];
  if (!fechamento) throw new AppError(502, "ptax_sem_fechamento_recente");
  const cotadoEm = parseBcbTime(fechamento.dataHoraCotacao);
  if (Number.isNaN(cotadoEm.getTime())) throw new AppError(502, "ptax_resposta_invalida");

  return idempotentMutation({
    lojaId,
    operation: "CAPTURE_PTAX",
    entityId: "USD:BRL",
    key,
    payload: request,
    execute: async (tx, correlationId): Promise<PtaxCapture> => {
      // O mesmo boletim não é registrado duas vezes.
      const existente = await tx.cotacaoCambio.findFirst({
        where: { lojaId, moedaOrigem: "USD", moedaDestino: "BRL", fonte: PTAX_FONTE, cotadoEm }
      });
      if (existente) return { cotacao: existente, jaRegistrada: true };
      const valorMercado = new D(fechamento.cotacaoVenda).toDecimalPlaces(6, D.ROUND_HALF_UP);
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
          fonte: PTAX_FONTE
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_REGISTRAR",
        action: "CAPTURE_PTAX",
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
