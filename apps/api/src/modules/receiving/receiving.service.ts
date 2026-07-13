import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "../operations/operations.persistence";
import { evaluateDefinitiveEntry, evaluateReceivingTransition } from "../operations/operations.policy";
export const list = (lojaId: string) =>
  prisma.recebimento.findMany({
    where: { lojaId, supersededAt: null },
    include: { viagem: true, mala: true, itens: { include: { produto: true } } }
  });
export async function create(
  lojaId: string,
  userId: string,
  d: { viagemId: string; malaId: string; observacoes?: string },
  idempotencyKey?: string
) {
  const trip = await prisma.viagem.findFirst({
      where: {
        id: d.viagemId,
        lojaId,
        status: "ARRIVED_BRAZIL",
        chegadaRealEm: { not: null }
      }
    }),
    bag = await prisma.mala.findFirst({
      where: {
        id: d.malaId,
        viagemId: d.viagemId,
        lojaId,
        status: { in: ["ARRIVED_BRAZIL", "RECEIVED"] }
      },
      include: { alocacoes: { include: { item: true } } }
    });
  if (!trip || !bag) throw new AppError(409, "not_arrived_brazil");
  const [checkpointBrasil, checkpointParaguai] = await Promise.all([
    prisma.checkpointBrasil.findFirst({ where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null } }),
    prisma.checkpointParaguai.findFirst({ where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null } })
  ]);
  const checkpointIds = [...(checkpointBrasil ? [checkpointBrasil.id] : []), ...(checkpointParaguai ? [checkpointParaguai.id] : [])];
  const projections = await prisma.projecaoOperacional.findMany({ where: { lojaId, entityId: { in: checkpointIds } } });
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as { tipoDivergencia?: string }]));
  const brasilType = checkpointBrasil ? projectionById.get(checkpointBrasil.id)?.tipoDivergencia ?? checkpointBrasil.tipoDivergencia : null;
  const paraguayType = checkpointParaguai ? projectionById.get(checkpointParaguai.id)?.tipoDivergencia ?? checkpointParaguai.tipoDivergencia : null;
  const existingReceiving = await prisma.recebimento.findFirst({ where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null } });
  const evaluation = evaluateReceivingTransition(
    trip,
    bag,
    paraguayType ? { tipoDivergencia: paraguayType } : null,
    brasilType ? { tipoDivergencia: brasilType } : null,
    Boolean(existingReceiving)
  );
  if (!evaluation.allowed) throw new AppError(409, evaluation.blockedReason!.toLowerCase());
  return idempotentMutation({
    lojaId, operation: "OPEN_RECEIVING", entityId: `${d.viagemId}:${d.malaId}`, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const r = await tx.recebimento.create({
      data: {
        ...d,
        lojaId,
        confirmadoPorId: userId,
        iniciadoEm: new Date(),
        status: "IN_PROGRESS"
      }
    });
    for (const a of bag.alocacoes)
      await tx.recebimentoItem.create({
        data: {
          lojaId,
          recebimentoId: r.id,
          pedidoCompraItemId: a.pedidoCompraItemId,
          produtoId: a.item.produtoId,
          quantidadeEsperada: a.quantidade
        }
      });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "RECEBIMENTO_CONFIRMAR",
      action: "OPEN_RECEIVING", entity: "Recebimento", entityId: r.id,
      correlationId, idempotencyKey, after: r
    });
    return r;
    }
  });
}
export async function confirm(
  lojaId: string,
  userId: string,
  id: string,
  itemId: string,
  d: {
    quantidadeRecebida: number;
    quantidadeRejeitada: number;
    observacoes?: string;
    tipoDivergencia: "CORRETO" | "FALTA" | "EXCESSO" | "AVARIA" | "ITEM_INCORRETO" | "OUTRO";
  },
  idempotencyKey?: string
) {
  return idempotentMutation({
    lojaId, operation: "CONFIRM_RECEIVING_ITEM", entityId: `${id}:${itemId}`, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const r = await tx.recebimento.findFirst({
      where: {
        id,
        lojaId,
        status: { in: ["IN_PROGRESS", "PARTIALLY_COMPLETED"] },
        supersededAt: null
      }
    });
    const item = await tx.recebimentoItem.findFirst({
      where: { id: itemId, recebimentoId: id, lojaId }
    });
    if (
      !r ||
      !item ||
      d.quantidadeRecebida < 0 ||
      d.quantidadeRejeitada < 0 ||
      (d.tipoDivergencia !== "EXCESSO" && item.quantidadeRecebida +
        item.quantidadeRejeitada +
        d.quantidadeRecebida +
        d.quantidadeRejeitada >
        item.quantidadeEsperada)
    )
      throw new AppError(409, "conflict");
    if (d.quantidadeRecebida + d.quantidadeRejeitada === 0)
      throw new AppError(400, "bad_request");
    if (d.tipoDivergencia !== "CORRETO" && !d.observacoes?.trim())
      throw new AppError(400, "divergence_observation_required");
    const updatedItem = await tx.recebimentoItem.update({
      where: { id: item.id },
      data: {
        quantidadeRecebida: { increment: d.quantidadeRecebida },
        quantidadeRejeitada: { increment: d.quantidadeRejeitada },
        observacoes: d.observacoes,
        tipoDivergencia: d.tipoDivergencia,
        divergenciaResolvida: d.tipoDivergencia === "CORRETO"
      }
    });
    const items = await tx.recebimentoItem.findMany({
      where: { recebimentoId: id },
      select: {
        quantidadeEsperada: true,
        quantidadeRecebida: true,
        quantidadeRejeitada: true,
        tipoDivergencia: true,
        divergenciaResolvida: true
      }
    });
    const pending = items.some(
      (current) =>
        current.quantidadeRecebida + current.quantidadeRejeitada <
        current.quantidadeEsperada
    );
    const result = await tx.recebimento.update({
      where: { id },
      data: {
        status: pending ? "PARTIALLY_COMPLETED" : "COMPLETED",
        concluidoEm: pending ? null : new Date()
      }
    });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "RECEBIMENTO_CONFIRMAR",
      action: "CONFIRM_RECEIVING_ITEM", entity: "RecebimentoItem", entityId: item.id,
      correlationId, idempotencyKey, before: item, after: updatedItem
    });
    return result;
    }
  });
}

export async function entradaDefinitiva(
  lojaId: string,
  userId: string,
  d: {
    viagemId: string;
    malaId: string;
    confirmadoEm: Date;
    observacao?: string;
  },
  idempotencyKey?: string
) {
  return idempotentMutation({
    lojaId, operation: "POST_DEFINITIVE_ENTRY", entityId: `${d.viagemId}:${d.malaId}`, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId, status: "ARRIVED_BRAZIL" }
    });
    if (!viagem) throw new AppError(404, "not_found");

    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");

    const [checkpointParaguai, checkpointBrasil] = await Promise.all([
      tx.checkpointParaguai.findFirst({ where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null } }),
      tx.checkpointBrasil.findFirst({ where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null } })
    ]);
    const checkpointIds = [checkpointParaguai?.id, checkpointBrasil?.id].filter((id): id is string => Boolean(id));
    const checkpointProjections = await tx.projecaoOperacional.findMany({ where: { lojaId, entityId: { in: checkpointIds } } });
    const projectionByCheckpoint = new Map(checkpointProjections.map((projection) => [projection.entityId, projection.state as { tipoDivergencia?: string }]));
    const effectiveParaguayType = checkpointParaguai ? projectionByCheckpoint.get(checkpointParaguai.id)?.tipoDivergencia ?? checkpointParaguai.tipoDivergencia : null;
    const effectiveBrasilType = checkpointBrasil ? projectionByCheckpoint.get(checkpointBrasil.id)?.tipoDivergencia ?? checkpointBrasil.tipoDivergencia : null;

    const entradaExistente = await tx.estoqueEntrada.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId }
    });

    if (entradaExistente) {
      if (entradaExistente.status === "COMPLETED") {
        return entradaExistente;
      }
      throw new AppError(409, "entrada_already_processing");
    }

    const recebimento = await tx.recebimento.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, status: "COMPLETED", supersededAt: null }
    });
    const rawItems = await tx.recebimentoItem.findMany({
      where: {
        recebimentoId: recebimento?.id ?? "__missing__",
        lojaId
      }
    });
    const itemProjections = await tx.projecaoOperacional.findMany({
      where: { lojaId, entity: "RecebimentoItem", entityId: { in: rawItems.map((item) => item.id) } }
    });
    const projectionByItem = new Map(itemProjections.map((projection) => [projection.entityId, projection.state as Record<string, unknown>]));
    const itens = rawItems.map((item) => ({ ...item, ...projectionByItem.get(item.id) }));

    const miamiItems = await tx.recebimentoMiami.findMany({
      where: { lojaId, pedidoCompraItemId: { in: itens.map((item) => item.pedidoCompraItemId) } },
      select: { pedidoCompraItemId: true }
    });
    const confirmedMiami = new Set(miamiItems.map((item) => item.pedidoCompraItemId));

    const impactQuantity = itens.reduce((sum, item) => sum + Math.max(0, Math.min(item.quantidadeEsperada, item.quantidadeRecebida - item.quantidadeRejeitada) - item.quantidadeJaIncorporada), 0);
    const evaluation = evaluateDefinitiveEntry({
      brazil: effectiveBrasilType ? { tipoDivergencia: effectiveBrasilType } : null,
      paraguayRequired: viagem.checkpointsObrigatorios.includes("PARAGUAI"),
      paraguay: effectiveParaguayType ? { tipoDivergencia: effectiveParaguayType } : null,
      receivingComplete: recebimento?.status === "COMPLETED",
      unresolvedDivergence: itens.some((item) => !item.divergenciaResolvida),
      alreadyPosted: false,
      impactQuantity,
      miamiComplete: itens.every((item) => confirmedMiami.has(item.pedidoCompraItemId))
    });
    if (!evaluation.allowed) throw new AppError(409, evaluation.blockedReasons[0]!.toLowerCase());

    const entrada = await tx.estoqueEntrada.create({
      data: {
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        status: "PENDING"
      }
    });

    for (const item of itens) {
      const quantidadeApta = Math.min(item.quantidadeEsperada, item.quantidadeRecebida - item.quantidadeRejeitada) - item.quantidadeJaIncorporada;

      if (quantidadeApta > 0) {
        const stock = await tx.estoque.upsert({
          where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } },
          update: { quantidadeFisica: { increment: quantidadeApta } },
          create: {
            lojaId,
            produtoId: item.produtoId,
            quantidadeFisica: quantidadeApta
          }
        });

        await tx.movimentacaoEstoque.create({
          data: {
            lojaId,
            produtoId: item.produtoId,
            estoqueId: stock.id,
            recebimentoId: item.recebimentoId,
            tipo: "ENTRY",
            motivo: "PURCHASE_RECEIPT",
            quantidade: quantidadeApta,
            quantidadeAnterior: stock.quantidadeFisica - quantidadeApta,
            quantidadePosterior: stock.quantidadeFisica,
            responsavelId: userId,
            observacoes: `Entrada parcial de ${quantidadeApta} unidades (recebidas: ${item.quantidadeRecebida}, rejeitadas: ${item.quantidadeRejeitada})`
          }
        });

        await tx.recebimentoItem.update({
          where: { id: item.id },
          data: { quantidadeJaIncorporada: { increment: quantidadeApta } }
        });
      }
    }

    const entradaAtualizada = await tx.estoqueEntrada.update({
      where: { id: entrada.id },
      data: { status: "COMPLETED" }
    });

    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "ENTRADA_DEFINITIVA_CONFIRMAR",
      action: "POST_DEFINITIVE_ENTRY", entity: "EstoqueEntrada", entityId: entrada.id,
      correlationId, idempotencyKey, after: entradaAtualizada
    });

    return entradaAtualizada;
    }
  });
}
