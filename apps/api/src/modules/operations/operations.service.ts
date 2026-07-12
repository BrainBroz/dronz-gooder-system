import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { hasPermission, type OperationalAction } from "./operations.types";

const action = (permissions: string[], permission: string, value: OperationalAction) =>
  hasPermission(permissions, permission) ? [value] : [];

export async function overview(lojaId: string, permissions: string[]) {
  const [miamiItems, paraguayPending, brazilPending, receivingPending, definitivePending, divergent] = await Promise.all([
    prisma.pedidoCompraItem.findMany({ where: { lojaId, pedido: { status: { in: ["CONFIRMED", "PARTIALLY_RECEIVED_MIAMI"] } } }, select: { quantidade: true, quantidadeRecebidaMiami: true } }),
    prisma.mala.count({ where: { lojaId, viagem: { checkpointsObrigatorios: { has: "PARAGUAI" } }, checkpointsParaguai: { none: { supersededAt: null } } } }),
    prisma.mala.count({ where: { lojaId, viagem: { status: "ARRIVED_BRAZIL" }, checkpointsBrasil: { none: { supersededAt: null } } } }),
    prisma.mala.count({ where: { lojaId, checkpointsBrasil: { some: { supersededAt: null } }, recebimentos: { none: { supersededAt: null } } } }),
    prisma.recebimento.count({
      where: {
        lojaId,
        status: "COMPLETED",
        viagem: { estoquesEntradas: { none: { supersededAt: null } } }
      }
    }),
    prisma.recebimentoMiami.count({ where: { lojaId, tipoDivergencia: { not: "CORRETO" } } })
  ]);
  const miamiPending = miamiItems.filter((item) => item.quantidadeRecebidaMiami < item.quantidade).length;
  return {
    lojaId,
    totals: { miamiPending, paraguayPending, brazilPending, receivingPending, definitivePending, divergent },
    allowedActions: [
      ...action(permissions, "MIAMI_RECEBIMENTO_CONFIRMAR", "CONFIRM_MIAMI"),
      ...action(permissions, "PARAGUAI_CHECKPOINT_CONFIRMAR", "CONFIRM_PARAGUAY"),
      ...action(permissions, "BRASIL_CHECKPOINT_CONFIRMAR", "CONFIRM_BRAZIL"),
      ...action(permissions, "RECEBIMENTO_CONFIRMAR", "OPEN_RECEIVING"),
      ...action(permissions, "ENTRADA_DEFINITIVA_CONFIRMAR", "POST_DEFINITIVE_ENTRY")
    ]
  };
}

export async function miamiCandidates(lojaId: string, permissions: string[]) {
  const now = Date.now();
  const items = await prisma.pedidoCompraItem.findMany({
    where: { lojaId, pedido: { status: { in: ["CONFIRMED", "PARTIALLY_RECEIVED_MIAMI"] } } },
    select: {
      id: true, quantidade: true, quantidadeRecebidaMiami: true, createdAt: true,
      produto: { select: { id: true, codigo: true, nome: true, peso: true } },
      pedido: { select: { id: true, numeroPedido: true, status: true } },
      recebimentosMiami: { select: { id: true, quantidadeRecebida: true, recebidoEm: true, tipoDivergencia: true, confirmadoPor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }
    },
    orderBy: { createdAt: "asc" }
  });
  return items.filter((item) => item.quantidadeRecebidaMiami < item.quantidade).map((item) => ({
    ...item,
    quantidadePendente: item.quantidade - item.quantidadeRecebidaMiami,
    alerta24h: now - item.createdAt.getTime() > 86_400_000,
    allowedActions: action(permissions, "MIAMI_RECEBIMENTO_CONFIRMAR", "CONFIRM_MIAMI"),
    blockedReasons: []
  }));
}

export async function miamiDetail(lojaId: string, itemId: string, permissions: string[]) {
  const candidates = await miamiCandidates(lojaId, permissions);
  const candidate = candidates.find((item) => item.id === itemId);
  const item = candidate ?? await prisma.pedidoCompraItem.findFirst({
    where: { id: itemId, lojaId },
    select: { id: true, quantidade: true, quantidadeRecebidaMiami: true, produto: { select: { id: true, codigo: true, nome: true, peso: true } }, pedido: { select: { id: true, numeroPedido: true, status: true } }, recebimentosMiami: { include: { confirmadoPor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } } }
  });
  if (!item) throw new AppError(404, "not_found");
  const history = await operationalHistory(lojaId, "PedidoCompraItem", itemId);
  return { ...item, history, allowedActions: candidate?.allowedActions ?? [], blockedReasons: candidate ? [] : [{ code: "MIAMI_ALREADY_COMPLETE", message: "Item sem quantidade pendente em Miami." }] };
}

export async function paraguayCandidates(lojaId: string, permissions: string[]) {
  const bags = await prisma.mala.findMany({
    where: { lojaId },
    include: { viagem: true, checkpointsParaguai: { where: { supersededAt: null }, include: { confirmadoPor: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" }
  });
  return bags.map((bag) => {
    const applicable = bag.viagem.checkpointsObrigatorios.includes("PARAGUAI");
    const checkpoint = bag.checkpointsParaguai[0] ?? null;
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, rotaCodigo: bag.viagem.rotaCodigo,
      applicability: applicable ? "REQUIRED" : "NOT_APPLICABLE",
      status: !applicable ? "NOT_APPLICABLE" : checkpoint ? "COMPLETED" : "PENDING",
      checkpoint,
      allowedActions: applicable && !checkpoint ? action(permissions, "PARAGUAI_CHECKPOINT_CONFIRMAR", "CONFIRM_PARAGUAY") : [],
      blockedReasons: !applicable ? [{ code: "CHECKPOINT_NOT_APPLICABLE", message: "A rota não exige Paraguai." }] : checkpoint ? [{ code: "ALREADY_CONFIRMED", message: "Checkpoint já confirmado." }] : []
    };
  });
}

export async function brazilCandidates(lojaId: string, permissions: string[]) {
  const bags = await prisma.mala.findMany({
    where: { lojaId, viagem: { status: "ARRIVED_BRAZIL" } },
    include: { viagem: true, checkpointsParaguai: { where: { supersededAt: null } }, checkpointsBrasil: { where: { supersededAt: null }, include: { confirmadoPor: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" }
  });
  return bags.map((bag) => {
    const paraguayRequired = bag.viagem.checkpointsObrigatorios.includes("PARAGUAI");
    const paraguayMissing = paraguayRequired && bag.checkpointsParaguai.length === 0;
    const checkpoint = bag.checkpointsBrasil[0] ?? null;
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, rotaCodigo: bag.viagem.rotaCodigo,
      requiredCheckpoints: bag.viagem.checkpointsObrigatorios,
      checkpoint,
      allowedActions: !checkpoint && !paraguayMissing ? action(permissions, "BRASIL_CHECKPOINT_CONFIRMAR", "CONFIRM_BRAZIL") : [],
      blockedReasons: paraguayMissing ? [{ code: "CHECKPOINT_REQUIRED", message: "Checkpoint Paraguai obrigatório para esta rota." }] : checkpoint ? [{ code: "ALREADY_CONFIRMED", message: "Chegada ao Brasil já confirmada." }] : []
    };
  });
}

export async function receivingCandidates(lojaId: string, permissions: string[]) {
  const bags = await prisma.mala.findMany({
    where: { lojaId, checkpointsBrasil: { some: { supersededAt: null } } },
    include: { viagem: true, recebimentos: { where: { supersededAt: null }, include: { itens: true } }, alocacoes: true },
    orderBy: { createdAt: "asc" }
  });
  return bags.map((bag) => {
    const receiving = bag.recebimentos[0] ?? null;
    return {
      id: bag.id, codigo: bag.codigo, viagemId: bag.viagemId, expectedItems: bag.alocacoes.length,
      receiving,
      allowedActions: receiving ? [] : action(permissions, "RECEBIMENTO_CONFIRMAR", "OPEN_RECEIVING"),
      blockedReasons: receiving ? [{ code: "RECEIVING_ALREADY_OPEN", message: "Recebimento já aberto." }] : []
    };
  });
}

export async function definitiveEntryCandidates(lojaId: string, permissions: string[]) {
  const receipts = await prisma.recebimento.findMany({
    where: { lojaId, supersededAt: null },
    include: { viagem: { include: { checkpointsParaguai: { where: { supersededAt: null } }, checkpointsBrasil: { where: { supersededAt: null } }, estoquesEntradas: { where: { supersededAt: null } } } }, mala: true, itens: true },
    orderBy: { createdAt: "asc" }
  });
  return receipts.map((receipt) => {
    const paraguayRequired = receipt.viagem.checkpointsObrigatorios.includes("PARAGUAI");
    const blockers = [] as { code: string; message: string }[];
    if (receipt.viagem.checkpointsBrasil.length === 0) blockers.push({ code: "BRAZIL_ARRIVAL_REQUIRED", message: "Chegada ao Brasil ainda não confirmada." });
    if (paraguayRequired && receipt.viagem.checkpointsParaguai.length === 0) blockers.push({ code: "CHECKPOINT_REQUIRED", message: "Paraguai é obrigatório nesta rota." });
    if (receipt.status !== "COMPLETED") blockers.push({ code: "RECEIVING_NOT_COMPLETE", message: "Conferência ainda não concluída." });
    if (receipt.viagem.estoquesEntradas.some((entry) => entry.malaId === receipt.malaId && entry.status === "COMPLETED")) blockers.push({ code: "STOCK_ALREADY_POSTED", message: "Entrada definitiva já realizada." });
    const impact = receipt.itens.reduce((sum, item) => sum + Math.max(0, item.quantidadeRecebida - item.quantidadeRejeitada - item.quantidadeJaIncorporada), 0);
    return {
      id: receipt.id, viagemId: receipt.viagemId, malaId: receipt.malaId, status: receipt.status,
      requiredCheckpoints: receipt.viagem.checkpointsObrigatorios, impactQuantity: impact,
      allowedActions: blockers.length === 0 ? action(permissions, "ENTRADA_DEFINITIVA_CONFIRMAR", "POST_DEFINITIVE_ENTRY") : [],
      blockedReasons: blockers
    };
  });
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
