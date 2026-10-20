import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import { competenceRange } from "../unified-purchases/monthly-panel.service";
import { currentQuote, currentSettings } from "../economic-settings/economic-settings.service";
import { projectPurchase, type ProjecaoEntrada } from "../purchase-simulation/purchase-projection";

const D = Prisma.Decimal;
// shortcut: envio do Mercado Livre fixo (valor fictício médio informado pelo PO), sem parâmetro; vira configuração quando o valor real for definido.
export const ENVIO_MARKETPLACE_BRL = "30";
const MARKUP_ALERTA_PADRAO = "30"; // exigido pela projeção; o alerta de markup só aparece no simulador, não no controle

export const monthSchema = z.object({ ano: z.coerce.number().int().min(2000).max(2100), mes: z.coerce.number().int().min(1).max(12) });
const decimal = z.number().finite().min(0).max(1_000_000_000);
export const projectionSchema = z
  .object({
    vendaUnitariaBrl: decimal.nullable(),
    pesoKg: z.number().positive().max(1000).nullable(),
    freteRealUsd: decimal.nullable(),
    produtoBaseId: z.string().min(1).nullable()
  })
  .partial()
  .strict();

type Settings = Awaited<ReturnType<typeof currentSettings>>;
type Quote = Awaited<ReturnType<typeof currentQuote>>;

/** Entrada da projeção de uma linha de compra: parâmetros da loja + o que foi digitado na linha. */
function buildInput(args: {
  quantidade: number;
  preco: string;
  moeda: string;
  pesoKg: string | null;
  freteRealUsd: string | null;
  vendaUnitariaBrl: string | null;
  settings: Settings;
  quote: Quote;
}): ProjecaoEntrada {
  const { settings, quote } = args;
  const taxas = settings?.taxasMarketplace ?? [];
  const taxa = taxas.find((t) => t.canal === "MERCADO_LIVRE" && t.modalidade === "PARCELADO") ?? taxas[0];
  const notaFiscal: ProjecaoEntrada["venda"]["notaFiscal"] =
    settings?.notaFiscalPercentual && settings.notaFiscalBase === "VENDA_BRUTA"
      ? { modo: "PERCENTUAL_VENDA_BRUTA", percentual: settings.notaFiscalPercentual.toString() }
      : { modo: "BASE_PENDENTE" };
  const freteReal = args.freteRealUsd !== null;
  return {
    quantidade: args.quantidade,
    compra: { precoUnitario: args.preco, moeda: args.moeda === "BRL" ? "BRL" : "USD" },
    pesoUnitarioKg: freteReal ? "0" : args.pesoKg,
    cambio: quote ? { referencia: quote.referencia, acrescimo: quote.acrescimo } : null,
    frete: freteReal ? { valorPorKg: "0", moeda: "USD" } : settings?.freteValorPorKg ? { valorPorKg: settings.freteValorPorKg.toString(), moeda: settings.freteMoeda === "BRL" ? "BRL" : "USD" } : null,
    encargosCompra: freteReal ? [{ descricao: "Frete pago", tipo: "VALOR_TOTAL", valor: args.freteRealUsd!, moeda: "USD" }] : [],
    venda: {
      precoUnitarioBrl: args.vendaUnitariaBrl,
      marketplace: { canal: taxa?.canal ?? "MERCADO_LIVRE", modalidade: taxa?.modalidade ?? "PARCELADO", parcelas: taxa?.parcelas ?? null, percentual: taxa ? taxa.percentual.toString() : null },
      notaFiscal,
      outrosEncargos: [{ descricao: "Envio Mercado Livre (estimado)", tipo: "VALOR_UNIDADE", valor: ENVIO_MARKETPLACE_BRL }]
    },
    markupAlertaPercentual: settings?.markupAlertaPercentual.toString() ?? MARKUP_ALERTA_PADRAO
  };
}

const text = (value: Prisma.Decimal | null | undefined) => (value === null || value === undefined ? null : value.toString());

export async function control(lojaId: string, filters: z.infer<typeof monthSchema>) {
  const { from, to } = competenceRange(filters.ano, filters.mes);
  const [items, settings, quote] = await Promise.all([
    prisma.compraImportadaItem.findMany({
      where: { status: "ATIVA", compraImportada: { dataPedido: { gte: from, lt: to } }, atribuicoes: { some: { lojaId, quantidade: { gt: 0 } } } },
      include: {
        compraImportada: { select: { id: true, numeroPedido: true, plataforma: true, dataPedido: true, statusExterno: true } },
        atribuicoes: { where: { lojaId }, select: { quantidade: true } },
        projecoes: { where: { lojaId }, include: { produtoBase: { select: { id: true, nome: true, pesoKg: true } } } }
      },
      orderBy: [{ compraImportada: { dataPedido: "asc" } }, { id: "asc" }]
    }),
    currentSettings(lojaId),
    currentQuote(lojaId)
  ]);

  const linhas = items.map((item) => {
    const quantidade = item.atribuicoes[0]!.quantidade;
    const projecao = item.projecoes[0] ?? null;
    const base = projecao?.produtoBase ?? null;
    const pesoKg = text(projecao?.pesoKg) ?? text(base?.pesoKg);
    const calculo = projectPurchase(
      buildInput({
        quantidade,
        preco: item.precoUnitario.toString(),
        moeda: item.moeda,
        pesoKg,
        freteRealUsd: text(projecao?.freteRealUsd),
        vendaUnitariaBrl: text(projecao?.vendaUnitariaBrl),
        settings,
        quote
      })
    );
    return {
      itemId: item.id,
      compraId: item.compraImportada.id,
      numeroPedido: item.compraImportada.numeroPedido,
      plataforma: item.compraImportada.plataforma,
      dataPedido: item.compraImportada.dataPedido,
      statusExterno: item.compraImportada.statusExterno,
      titulo: item.titulo,
      moeda: item.moeda,
      precoUnitario: item.precoUnitario.toString(),
      quantidade,
      produtoBase: base ? { id: base.id, nome: base.nome, pesoKg: text(base.pesoKg) } : null,
      entrada: { vendaUnitariaBrl: text(projecao?.vendaUnitariaBrl), pesoKg: text(projecao?.pesoKg), freteRealUsd: text(projecao?.freteRealUsd) },
      pesoKgUsado: pesoKg,
      freteReal: projecao?.freteRealUsd != null,
      calculo
    };
  });

  // Totais só das linhas completas; as incompletas são contadas à parte para não esconder a falta de dado.
  const soma = (chave: "custo" | "vendaBruta" | "lucro") =>
    linhas.filter((l) => l.calculo.status === "COMPLETO").reduce((acc, l) => acc.plus(l.calculo.total[chave] ?? 0), new D(0));
  const custo = soma("custo");
  const vendaBruta = soma("vendaBruta");
  const lucro = soma("lucro");
  return {
    competencia: { ano: filters.ano, mes: filters.mes },
    cotacao: quote,
    parametros: {
      parametrosGravados: settings !== null,
      envioMarketplaceBrl: ENVIO_MARKETPLACE_BRL
    },
    linhas,
    totais: {
      linhas: linhas.length,
      linhasIncompletas: linhas.filter((l) => l.calculo.status !== "COMPLETO").length,
      custo: custo.toFixed(2),
      vendaBruta: vendaBruta.toFixed(2),
      lucro: lucro.toFixed(2),
      margemPercentual: vendaBruta.gt(0) ? lucro.dividedBy(vendaBruta).times(100).toFixed(2) : null,
      markupPercentual: custo.gt(0) ? lucro.dividedBy(custo).times(100).toFixed(2) : null
    }
  };
}

/** Grava o que foi digitado na linha. Peso informado em linha ligada à base de produtos atualiza o peso da base. */
export async function saveProjection(lojaId: string, userId: string, itemId: string, input: z.infer<typeof projectionSchema>) {
  const attributed = await prisma.atribuicaoCompraItem.findUnique({ where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } } });
  if (!attributed || attributed.quantidade <= 0) throw new AppError(404, "not_found");
  if (input.produtoBaseId && !(await prisma.produtoBase.findUnique({ where: { id: input.produtoBaseId } }))) throw new AppError(404, "not_found");
  const data = {
    ...(input.vendaUnitariaBrl !== undefined ? { vendaUnitariaBrl: input.vendaUnitariaBrl } : {}),
    ...(input.pesoKg !== undefined ? { pesoKg: input.pesoKg } : {}),
    ...(input.freteRealUsd !== undefined ? { freteRealUsd: input.freteRealUsd } : {}),
    ...(input.produtoBaseId !== undefined ? { produtoBaseId: input.produtoBaseId } : {}),
    atualizadoPorId: userId
  };
  return prisma.$transaction(async (tx) => {
    const saved = await tx.projecaoCompraItem.upsert({
      where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } },
      create: { itemExternoId: itemId, lojaId, ...data },
      update: data
    });
    if (input.pesoKg && saved.produtoBaseId) await tx.produtoBase.update({ where: { id: saved.produtoBaseId }, data: { pesoKg: input.pesoKg } });
    return saved;
  });
}
