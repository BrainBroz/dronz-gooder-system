import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { hasPermission, type OperationalAction } from "./operations.types";
import { evaluateBrazilTransition, evaluateDefinitiveEntry, evaluateParaguayTransition, evaluateReceivingTransition } from "./operations.policy";

const action = (permissions: string[], permission: string, value: OperationalAction) =>
  hasPermission(permissions, permission) ? [value] : [];

export async function overview(lojaId: string, permissions: string[]) {
  const totals: Record<string, number> = {};
  if (hasPermission(permissions, "MIAMI_RECEBIMENTO_VISUALIZAR")) {
    const miamiItems = await prisma.pedidoCompraItem.findMany({ where: { lojaId, pedido: { status: { in: ["CONFIRMED", "PARTIALLY_RECEIVED_MIAMI"] } } }, select: { quantidade: true, quantidadeRecebidaMiami: true } });
    totals.miamiPending = miamiItems.filter((item) => item.quantidadeRecebidaMiami < item.quantidade).length;
    totals.miamiDivergent = await prisma.recebimentoMiami.count({ where: { lojaId, tipoDivergencia: { not: "CORRETO" } } });
  }
  if (hasPermission(permissions, "PARAGUAI_CHECKPOINT_VISUALIZAR"))
    totals.paraguayPending = await prisma.mala.count({ where: { lojaId, viagem: { checkpointsObrigatorios: { has: "PARAGUAI" } }, checkpointsParaguai: { none: { supersededAt: null } } } });
  if (hasPermission(permissions, "BRASIL_CHECKPOINT_VISUALIZAR"))
    totals.brazilPending = await prisma.mala.count({ where: { lojaId, viagem: { status: "ARRIVED_BRAZIL" }, checkpointsBrasil: { none: { supersededAt: null } } } });
  if (hasPermission(permissions, "RECEBIMENTO_VISUALIZAR"))
    totals.receivingPending = await prisma.mala.count({ where: { lojaId, checkpointsBrasil: { some: { supersededAt: null } }, recebimentos: { none: { supersededAt: null } } } });
  if (hasPermission(permissions, "ENTRADA_DEFINITIVA_VISUALIZAR"))
    totals.definitivePending = await prisma.recebimento.count({ where: { lojaId, status: "COMPLETED", viagem: { estoquesEntradas: { none: { supersededAt: null } } } } });
  return {
    lojaId,
    totals,
    allowedActions: [
      ...action(permissions, "MIAMI_RECEBIMENTO_CONFIRMAR", "CONFIRM_MIAMI"),
      ...action(permissions, "PARAGUAI_CHECKPOINT_CONFIRMAR", "CONFIRM_PARAGUAY"),
      ...action(permissions, "BRASIL_CHECKPOINT_CONFIRMAR", "CONFIRM_BRAZIL"),
      ...action(permissions, "RECEBIMENTO_CONFIRMAR", "OPEN_RECEIVING"),
      ...action(permissions, "ENTRADA_DEFINITIVA_CONFIRMAR", "POST_DEFINITIVE_ENTRY")
    ]
  };
}

export async function miamiCandidates(lojaId: string, permissions: string[], itemId?: string) {
  const now = Date.now();
  const items = await prisma.pedidoCompraItem.findMany({
    where: { lojaId, id: itemId, pedido: { status: { in: ["CONFIRMED", "PARTIALLY_RECEIVED_MIAMI"] } } },
    select: {
      id: true, quantidade: true, quantidadeRecebidaMiami: true, createdAt: true,
      produto: { select: { id: true, codigo: true, nome: true, peso: true } },
      pedido: { select: { id: true, numeroPedido: true, status: true } },
      recebimentosMiami: { select: { id: true, quantidadeRecebida: true, recebidoEm: true, tipoDivergencia: true, confirmadoPor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }
    },
    orderBy: { createdAt: "asc" }
  });
  return items.filter((item) => item.quantidadeRecebidaMiami < item.quantidade).map((item) => {
    const physicalReceivedAt = item.recebimentosMiami[0]?.recebidoEm ?? null;
    return {
      ...item,
      quantidadePendente: item.quantidade - item.quantidadeRecebidaMiami,
      physicalReceivedAt,
      alerta24h: physicalReceivedAt ? now - physicalReceivedAt.getTime() > 86_400_000 : false,
      allowedActions: action(permissions, "MIAMI_RECEBIMENTO_CONFIRMAR", "CONFIRM_MIAMI"),
      blockedReasons: []
    };
  });
}

export async function miamiDetail(lojaId: string, itemId: string, permissions: string[]) {
  const candidates = await miamiCandidates(lojaId, permissions, itemId);
  const candidate = candidates.find((item) => item.id === itemId);
  const item = candidate ?? await prisma.pedidoCompraItem.findFirst({
    where: { id: itemId, lojaId },
    select: { id: true, quantidade: true, quantidadeRecebidaMiami: true, produto: { select: { id: true, codigo: true, nome: true, peso: true } }, pedido: { select: { id: true, numeroPedido: true, status: true } }, recebimentosMiami: { include: { confirmadoPor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } } }
  });
  if (!item) throw new AppError(404, "not_found");
  const history = await operationalHistory(lojaId, "PedidoCompraItem", itemId);
  return { ...item, history, allowedActions: candidate?.allowedActions ?? [], blockedReasons: candidate ? [] : [{ code: "MIAMI_ALREADY_COMPLETE", message: "Item sem quantidade pendente em Miami." }] };
}

export async function paraguayCandidates(lojaId: string, permissions: string[], bagId?: string) {
  const bags = await prisma.mala.findMany({
    where: { lojaId, id: bagId },
    include: { viagem: true, checkpointsParaguai: { where: { supersededAt: null }, include: { confirmadoPor: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" }
  });
  const checkpointIds = bags.flatMap((bag) => bag.checkpointsParaguai.map((checkpoint) => checkpoint.id));
  const projections = await prisma.projecaoOperacional.findMany({
    where: { lojaId, entity: "CheckpointParaguai", entityId: { in: checkpointIds } }
  });
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as Record<string, unknown>]));
  return bags.map((bag) => {
    const applicable = bag.viagem.checkpointsObrigatorios.includes("PARAGUAI");
    const checkpoint = bag.checkpointsParaguai[0] ?? null;
    const effectiveCheckpoint = checkpoint ? { ...checkpoint, ...projectionById.get(checkpoint.id) } : null;
    const evaluation = evaluateParaguayTransition(bag.viagem, bag, effectiveCheckpoint);
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, rotaCodigo: bag.viagem.rotaCodigo,
      applicability: applicable ? "REQUIRED" : "NOT_APPLICABLE",
      status: evaluation.status,
      checkpoint: effectiveCheckpoint,
      allowedActions: evaluation.allowed ? action(permissions, "PARAGUAI_CHECKPOINT_CONFIRMAR", "CONFIRM_PARAGUAY") : [],
      blockedReasons: evaluation.blockedReason ? [{ code: evaluation.blockedReason, message: evaluation.blockedReason }] : []
    };
  });
}

export async function brazilCandidates(lojaId: string, permissions: string[], bagId?: string) {
  const bags = await prisma.mala.findMany({
    where: { lojaId, id: bagId, viagem: { status: "ARRIVED_BRAZIL" } },
    include: { viagem: true, checkpointsParaguai: { where: { supersededAt: null } }, checkpointsBrasil: { where: { supersededAt: null }, include: { confirmadoPor: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" }
  });
  const checkpointIds = bags.flatMap((bag) => [...bag.checkpointsParaguai, ...bag.checkpointsBrasil].map((checkpoint) => checkpoint.id));
  const projections = await prisma.projecaoOperacional.findMany({
    where: { lojaId, entityId: { in: checkpointIds }, entity: { in: ["CheckpointParaguai", "CheckpointBrasil"] } }
  });
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as Record<string, unknown>]));
  return bags.map((bag) => {
    const paraguay = bag.checkpointsParaguai[0] ? { ...bag.checkpointsParaguai[0], ...projectionById.get(bag.checkpointsParaguai[0].id) } : null;
    const checkpoint = bag.checkpointsBrasil[0] ?? null;
    const effectiveCheckpoint = checkpoint ? { ...checkpoint, ...projectionById.get(checkpoint.id) } : null;
    const evaluation = evaluateBrazilTransition(bag.viagem, bag, paraguay, effectiveCheckpoint);
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, rotaCodigo: bag.viagem.rotaCodigo,
      requiredCheckpoints: bag.viagem.checkpointsObrigatorios,
      status: evaluation.status,
      checkpoint: effectiveCheckpoint,
      allowedActions: evaluation.allowed ? action(permissions, "BRASIL_CHECKPOINT_CONFIRMAR", "CONFIRM_BRAZIL") : [],
      blockedReasons: evaluation.blockedReason ? [{ code: evaluation.blockedReason, message: evaluation.blockedReason }] : []
    };
  });
}

export async function receivingCandidates(lojaId: string, permissions: string[]) {
  const bags = await prisma.mala.findMany({
    where: { lojaId, checkpointsBrasil: { some: { supersededAt: null } } },
    include: { viagem: true, checkpointsParaguai: { where: { supersededAt: null } }, checkpointsBrasil: { where: { supersededAt: null } }, recebimentos: { where: { supersededAt: null }, include: { itens: true } }, alocacoes: true },
    orderBy: { createdAt: "asc" }
  });
  const checkpointIds = bags.flatMap((bag) => [...bag.checkpointsParaguai, ...bag.checkpointsBrasil].map((checkpoint) => checkpoint.id));
  const projections = await prisma.projecaoOperacional.findMany({ where: { lojaId, entityId: { in: checkpointIds } } });
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as { tipoDivergencia?: string }]));
  return bags.map((bag) => {
    const receiving = bag.recebimentos[0] ?? null;
    const brasil = bag.checkpointsBrasil[0];
    const brasilType = brasil ? projectionById.get(brasil.id)?.tipoDivergencia ?? brasil.tipoDivergencia : null;
    const paraguay = bag.checkpointsParaguai[0];
    const paraguayType = paraguay ? projectionById.get(paraguay.id)?.tipoDivergencia ?? paraguay.tipoDivergencia : null;
    const evaluation = evaluateReceivingTransition(
      bag.viagem,
      bag,
      paraguayType ? { tipoDivergencia: paraguayType } : null,
      brasilType ? { tipoDivergencia: brasilType } : null,
      Boolean(receiving)
    );
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, expectedItems: bag.alocacoes.length,
      receiving,
      allowedActions: evaluation.allowed ? action(permissions, "RECEBIMENTO_CONFIRMAR", "OPEN_RECEIVING") : [],
      blockedReasons: evaluation.blockedReason ? [{ code: evaluation.blockedReason, message: evaluation.blockedReason }] : []
    };
  });
}

export async function receivingDetail(lojaId: string, receivingId: string, permissions: string[]) {
  const receiving = await prisma.recebimento.findFirst({
    where: { id: receivingId, lojaId, supersededAt: null },
    include: { viagem: true, mala: true, itens: { include: { produto: { select: { id: true, codigo: true, nome: true } } }, orderBy: { createdAt: "asc" } } }
  });
  if (!receiving) throw new AppError(404, "not_found");
  const projections = await prisma.projecaoOperacional.findMany({
    where: { lojaId, entity: "RecebimentoItem", entityId: { in: receiving.itens.map((item) => item.id) } }
  });
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as Record<string, unknown>]));
  const items = receiving.itens.map((item) => ({ ...item, ...projectionById.get(item.id) }));
  const pending = items.some((item) => item.quantidadeRecebida + item.quantidadeRejeitada < item.quantidadeEsperada);
  return {
    ...receiving,
    itens: items,
    progress: {
      total: items.length,
      completed: items.filter((item) => item.quantidadeRecebida + item.quantidadeRejeitada >= item.quantidadeEsperada).length,
      pending: items.filter((item) => item.quantidadeRecebida + item.quantidadeRejeitada < item.quantidadeEsperada).length,
      divergent: items.filter((item) => item.tipoDivergencia !== "CORRETO").length
    },
    allowedActions: receiving.status !== "COMPLETED" && pending ? action(permissions, "RECEBIMENTO_CONFIRMAR", "CONFIRM_RECEIVING_ITEM") : [],
    blockedReasons: receiving.status === "COMPLETED" ? [{ code: "RECEIVING_ALREADY_COMPLETE", message: "RECEIVING_ALREADY_COMPLETE" }] : [],
    history: await operationalHistory(lojaId, "Recebimento", receiving.id)
  };
}

export async function definitiveEntryCandidates(lojaId: string, permissions: string[]) {
  const receipts = await prisma.recebimento.findMany({
    where: { lojaId, supersededAt: null },
    include: { viagem: { include: { checkpointsParaguai: { where: { supersededAt: null } }, checkpointsBrasil: { where: { supersededAt: null } }, estoquesEntradas: { where: { supersededAt: null } } } }, mala: true, itens: true },
    orderBy: { createdAt: "asc" }
  });
  const itemIds = receipts.flatMap((receipt) => receipt.itens.map((item) => item.id));
  const checkpointIds = receipts.flatMap((receipt) => [...receipt.viagem.checkpointsParaguai, ...receipt.viagem.checkpointsBrasil].map((checkpoint) => checkpoint.id));
  const projections = await prisma.projecaoOperacional.findMany({
    where: { lojaId, entityId: { in: [...itemIds, ...checkpointIds] } }
  });
  const miamiConfirmations = await prisma.recebimentoMiami.findMany({
    where: { lojaId, pedidoCompraItemId: { in: receipts.flatMap((receipt) => receipt.itens.map((item) => item.pedidoCompraItemId)) } },
    select: { pedidoCompraItemId: true }
  });
  const miamiConfirmedItems = new Set(miamiConfirmations.map((confirmation) => confirmation.pedidoCompraItemId));
  const projectionById = new Map(projections.map((projection) => [projection.entityId, projection.state as Record<string, unknown>]));
  return receipts.map((receipt) => {
    const paraguayRequired = receipt.viagem.checkpointsObrigatorios.includes("PARAGUAI");
    const blockers = [] as { code: string; message: string }[];
    const effectiveItems = receipt.itens.map((item) => ({ ...item, ...projectionById.get(item.id) }));
    const brasil = receipt.viagem.checkpointsBrasil[0];
    const brasilType = brasil ? (projectionById.get(brasil.id)?.tipoDivergencia as string | undefined) ?? brasil.tipoDivergencia : null;
    const paraguay = receipt.viagem.checkpointsParaguai[0];
    const paraguayType = paraguay ? (projectionById.get(paraguay.id)?.tipoDivergencia as string | undefined) ?? paraguay.tipoDivergencia : null;
    const impact = effectiveItems.reduce((sum, item) => sum + Math.max(0, Math.min(item.quantidadeEsperada, item.quantidadeRecebida - item.quantidadeRejeitada) - item.quantidadeJaIncorporada), 0);
    const existingEntry = receipt.viagem.estoquesEntradas.find((entry) => entry.malaId === receipt.malaId && entry.status === "COMPLETED");
    const evaluation = evaluateDefinitiveEntry({
      brazil: brasilType ? { tipoDivergencia: brasilType } : null,
      paraguayRequired,
      paraguay: paraguayType ? { tipoDivergencia: paraguayType } : null,
      receivingComplete: receipt.status === "COMPLETED",
      unresolvedDivergence: effectiveItems.some((item) => !item.divergenciaResolvida),
      alreadyPosted: Boolean(existingEntry),
      impactQuantity: impact,
      miamiComplete: effectiveItems.every((item) => miamiConfirmedItems.has(item.pedidoCompraItemId))
    });
    blockers.push(...evaluation.blockedReasons.map((code) => ({ code, message: code })));
    return {
      id: receipt.id, viagemId: receipt.viagemId, malaId: receipt.malaId, status: receipt.status, entryId: existingEntry?.id ?? null,
      requiredCheckpoints: receipt.viagem.checkpointsObrigatorios, impactQuantity: impact,
      items: effectiveItems.map((item) => ({ id: item.id, produtoId: item.produtoId, quantidadeEsperada: item.quantidadeEsperada, quantidadeRecebida: item.quantidadeRecebida, quantidadeRejeitada: item.quantidadeRejeitada, quantidadeJaIncorporada: item.quantidadeJaIncorporada, tipoDivergencia: item.tipoDivergencia, divergenciaResolvida: item.divergenciaResolvida })),
      allowedActions: blockers.length === 0 ? action(permissions, "ENTRADA_DEFINITIVA_CONFIRMAR", "POST_DEFINITIVE_ENTRY") : [],
      blockedReasons: blockers
    };
  });
}

export async function definitiveEntryDetail(lojaId: string, receivingId: string, permissions: string[]) {
  const candidate = (await definitiveEntryCandidates(lojaId, permissions)).find((entry) => entry.id === receivingId);
  if (!candidate) throw new AppError(404, "not_found");
  return { ...candidate, history: candidate.entryId ? await operationalHistory(lojaId, "EstoqueEntrada", candidate.entryId) : { items: [], nextCursor: null } };
}

export async function operationalHistory(lojaId: string, entity?: string, entityId?: string, cursor?: string, take = 50) {
  const allowedEntities = ["PedidoCompraItem", "CheckpointParaguai", "CheckpointBrasil", "Recebimento", "RecebimentoItem", "EstoqueEntrada"];
  if (entity && !allowedEntities.includes(entity)) throw new AppError(400, "bad_request");
  const rows = await prisma.auditLog.findMany({
    where: { lojaId, entity: entity ?? { in: allowedEntities }, entityId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(take, 100) + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const hasMore = rows.length > Math.min(take, 100);
  const items = hasMore ? rows.slice(0, -1) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

const historyPermissions = {
  PedidoCompraItem: "MIAMI_RECEBIMENTO_VISUALIZAR",
  CheckpointParaguai: "PARAGUAI_CHECKPOINT_VISUALIZAR",
  CheckpointBrasil: "BRASIL_CHECKPOINT_VISUALIZAR",
  Recebimento: "RECEBIMENTO_VISUALIZAR",
  RecebimentoItem: "RECEBIMENTO_VISUALIZAR",
  EstoqueEntrada: "ENTRADA_DEFINITIVA_VISUALIZAR"
} as const;
export const historyPermissionForEntity = (entity: keyof typeof historyPermissions) => historyPermissions[entity];
