import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "../operations/operations.persistence";
import { projectPurchase, type EncargoCompra, type Moeda, type ProjecaoEntrada } from "./purchase-projection";

const ORIGIN = "API_PURCHASE_SIMULATION";

export type SimulationInput = {
  nome: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  quantidade: number;
  compra: { precoUnitario: string | null; moeda: Moeda };
  pesoUnitarioKg: string | null;
  cambio:
    | { origem: "COTACAO_REGISTRADA"; cotacaoCambioId: string }
    | { origem: "INFORMADA"; referencia: string; acrescimo: string; fonte: string | null }
    | { origem: "SEM_COTACAO" };
  frete: { valorPorKg: string; moeda: Moeda } | null;
  encargosCompra: EncargoCompra[];
  venda: ProjecaoEntrada["venda"];
  markupAlertaPercentual: string;
  parametroEconomicoId: string | null;
};

/**
 * Resolve a entrada contra a loja: produto, cotação e versão de parâmetros precisam pertencer a ela.
 * A cotação registrada é lida do banco (referência + acréscimo dela), nunca dos valores do cliente.
 */
async function resolve(lojaId: string, input: SimulationInput) {
  let produto: { id: string; nome: string; codigo: number } | null = null;
  if (input.produtoId) {
    produto = await prisma.produto.findFirst({ where: { id: input.produtoId, lojaId }, select: { id: true, nome: true, codigo: true } });
    if (!produto) throw new AppError(404, "produto_nao_encontrado");
  } else if (!input.produtoNome?.trim()) throw new AppError(422, "produto_obrigatorio");

  if (input.parametroEconomicoId) {
    const parametro = await prisma.parametroEconomico.findFirst({ where: { id: input.parametroEconomicoId, lojaId }, select: { id: true } });
    if (!parametro) throw new AppError(404, "parametro_nao_encontrado");
  }

  let cambio: ProjecaoEntrada["cambio"] = null;
  let cambioOrigem: Record<string, unknown> = { origem: "SEM_COTACAO" };
  let cotacaoCambioId: string | null = null;
  if (input.cambio.origem === "COTACAO_REGISTRADA") {
    const quote = await prisma.cotacaoCambio.findFirst({
      where: { id: input.cambio.cotacaoCambioId, lojaId, moedaOrigem: "USD", moedaDestino: "BRL" }
    });
    if (!quote) throw new AppError(404, "cotacao_nao_encontrada");
    cotacaoCambioId = quote.id;
    cambio = { referencia: quote.valorMercado.toString(), acrescimo: quote.margem.toString() };
    cambioOrigem = { origem: "COTACAO_REGISTRADA", cotacaoCambioId: quote.id, fonte: quote.fonte, cotadoEm: quote.cotadoEm };
  } else if (input.cambio.origem === "INFORMADA") {
    cambio = { referencia: input.cambio.referencia, acrescimo: input.cambio.acrescimo };
    cambioOrigem = { origem: "INFORMADA", fonte: input.cambio.fonte };
  }

  const projecao: ProjecaoEntrada = {
    quantidade: input.quantidade,
    compra: input.compra,
    pesoUnitarioKg: input.pesoUnitarioKg,
    cambio,
    frete: input.frete,
    encargosCompra: input.encargosCompra,
    venda: input.venda,
    markupAlertaPercentual: input.markupAlertaPercentual
  };
  const entrada = {
    ...projecao,
    cambioOrigem,
    parametroEconomicoId: input.parametroEconomicoId,
    produto: produto ?? { id: null, nome: input.produtoNome!.trim(), codigo: null }
  };
  return { projecao, entrada, produto, cotacaoCambioId };
}

/** Calcula sem gravar nada. */
export async function calculate(lojaId: string, input: SimulationInput) {
  const { projecao, entrada } = await resolve(lojaId, input);
  return { entrada, resultado: projectPurchase(projecao) };
}

/** Salva a simulação com a entrada resolvida e o resultado como snapshot. Não cria compra, estoque, venda nem pagamento. */
export async function save(lojaId: string, userId: string, input: SimulationInput, key?: string) {
  const { projecao, entrada, produto, cotacaoCambioId } = await resolve(lojaId, input);
  const resultado = projectPurchase(projecao);
  const produtoNome = produto?.nome ?? input.produtoNome!.trim();
  return idempotentMutation({
    lojaId,
    operation: "SAVE_PURCHASE_SIMULATION",
    entityId: lojaId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const created = await tx.simulacaoCompra.create({
        data: {
          lojaId,
          nome: input.nome?.trim() || `${produtoNome} × ${input.quantidade}`,
          produtoId: produto?.id ?? null,
          produtoNome,
          produtoCodigo: produto?.codigo ?? null,
          parametroEconomicoId: input.parametroEconomicoId,
          cotacaoCambioId,
          entrada: entrada as unknown as Prisma.InputJsonValue,
          resultado: resultado as unknown as Prisma.InputJsonValue,
          criadoPorId: userId
        },
        include: { criadoPor: { select: { id: true, name: true } } }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "SIMULACAO_GERENCIAR",
        action: "SAVE_PURCHASE_SIMULATION",
        entity: "SimulacaoCompra",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: { id: created.id, nome: created.nome, produtoId: created.produtoId },
        origin: ORIGIN
      });
      return created;
    }
  });
}

export const list = (lojaId: string) =>
  prisma.simulacaoCompra.findMany({
    where: { lojaId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      nome: true,
      produtoNome: true,
      produtoCodigo: true,
      createdAt: true,
      resultado: true,
      criadoPor: { select: { name: true } }
    }
  });

export async function get(lojaId: string, id: string) {
  const simulation = await prisma.simulacaoCompra.findFirst({
    where: { id, lojaId },
    include: { criadoPor: { select: { id: true, name: true } } }
  });
  if (!simulation) throw new AppError(404, "not_found");
  return simulation;
}
