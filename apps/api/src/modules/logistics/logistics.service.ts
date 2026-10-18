import { randomUUID } from "node:crypto";
import { MalaStatus, Prisma, ViagemStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit, idempotentMutation } from "../operations/operations.persistence";
import { assertBrazilTransition, assertParaguayTransition } from "../operations/operations.policy";
import {
  MIAMI_BASE_ID,
  assertOperable,
  availableAtPosition,
  type Actor
} from "../positions/positions.service";

// Logística opera quantidades e pesos; valores do item e do produto não saem destas respostas (F-10).
const allocationItem = {
  item: {
    omit: { precoUnitario: true, descontoItem: true, totalItem: true },
    include: { produto: { omit: { precoVenda: true, markup: true } } }
  }
} as const;
const tripTransitions: Record<ViagemStatus, ViagemStatus[]> = {
  PLANNED: ["OPEN_FOR_ALLOCATION"],
  OPEN_FOR_ALLOCATION: ["CLOSED_FOR_ALLOCATION", "CANCELLED"],
  CLOSED_FOR_ALLOCATION: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED_BRAZIL"],
  ARRIVED_BRAZIL: [],
  CANCELLED: []
};
const departedTrip: ViagemStatus[] = ["IN_TRANSIT", "ARRIVED_BRAZIL", "CANCELLED"];
const suitcaseTransitions: Record<MalaStatus, MalaStatus[]> = {
  PLANNING: ["CLOSED", "CANCELLED"],
  CLOSED: ["CHECKED_IN", "CANCELLED", "PLANNING"],
  CHECKED_IN: ["ARRIVED_BRAZIL"],
  ARRIVED_BRAZIL: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: []
};
async function clearedParaguayBags(
  db: Prisma.TransactionClient,
  lojaId: string,
  bagIds: string[]
) {
  if (!bagIds.length) return new Set<string>();
  const checkpoints = await db.checkpointParaguai.findMany({
    where: { lojaId, malaId: { in: bagIds }, supersededAt: null },
    select: { id: true, malaId: true, tipoDivergencia: true }
  });
  const projections = await db.projecaoOperacional.findMany({
    where: { lojaId, entity: "CheckpointParaguai", entityId: { in: checkpoints.map((checkpoint) => checkpoint.id) } },
    select: { entityId: true, state: true }
  });
  const effective = new Map(projections.map((projection) => [
    projection.entityId, projection.state as { tipoDivergencia?: string }
  ]));
  return new Set(checkpoints.filter((checkpoint) =>
    (effective.get(checkpoint.id)?.tipoDivergencia ?? checkpoint.tipoDivergencia) === "CORRETO"
  ).map((checkpoint) => checkpoint.malaId));
}
const readyAfterParaguay = (
  bags: Array<{ id: string; status: MalaStatus }>,
  cleared: Set<string>
) => bags.filter((bag) => bag.status !== "CANCELLED")
  .every((bag) => bag.status === "CHECKED_IN" && cleared.has(bag.id));
async function withPlanningSuitcase<T>(
  lojaId: string,
  id: string,
  action: (tx: Prisma.TransactionClient) => Promise<T>
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mala" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const bag = await tx.mala.findFirst({ where: { id, lojaId } });
    if (!bag) throw new AppError(404, "not_found");
    if (bag.status !== "PLANNING") throw new AppError(409, "conflict");
    return action(tx);
  });
}
export const travelers = (lojaId: string) =>
  prisma.viajante.findMany({
    where: { lojaId },
    select: {
      id: true,
      lojaId: true,
      nome: true,
      email: true,
      telefone: true,
      observacoes: true,
      ativo: true,
      createdAt: true,
      updatedAt: true
    }
  });
export const createTraveler = (
  lojaId: string,
  d: Prisma.ViajanteUncheckedCreateWithoutLojaInput
) =>
  prisma.viajante.create({
    data: { ...d, lojaId },
    select: {
      id: true,
      lojaId: true,
      nome: true,
      email: true,
      telefone: true,
      observacoes: true,
      ativo: true,
      createdAt: true,
      updatedAt: true
    }
  });
export const trips = async (lojaId: string) => {
  const listed = await prisma.viagem.findMany({
    where: { lojaId },
    include: {
      viajante: { select: { id: true, nome: true, ativo: true } },
      malas: { include: { _count: { select: { alocacoes: true } } } }
    }
  });
  const requiringParaguay = listed.filter((trip) =>
    trip.status === "IN_TRANSIT" && trip.checkpointsObrigatorios.includes("PARAGUAI")
  );
  const cleared = await clearedParaguayBags(prisma, lojaId,
    requiringParaguay.flatMap((trip) => trip.malas.map((bag) => bag.id)));
  return listed.map((trip) => ({
    ...trip,
    allowedStatusTransitions: tripTransitions[trip.status].filter((next) =>
      (next !== "CANCELLED" || trip.malas.every((bag) => bag._count.alocacoes === 0)) &&
      (next !== "ARRIVED_BRAZIL" || !trip.checkpointsObrigatorios.includes("PARAGUAI") ||
        readyAfterParaguay(trip.malas, cleared))
    )
  }));
};
export async function createTrip(
  lojaId: string,
  d: {
    viajanteId: string;
    origem: string;
    destino: string;
    partidaEm: Date;
    chegadaPrevistaEm: Date;
    rotaCodigo?: "MIAMI_PARAGUAI_BRASIL" | "MIAMI_BRASIL";
  }
) {
  if (d.chegadaPrevistaEm <= d.partidaEm)
    throw new AppError(400, "bad_request");
  if (
    !(await prisma.viajante.findFirst({
      where: { id: d.viajanteId, lojaId, ativo: true }
    }))
  )
    throw new AppError(404, "not_found");
  const rotaCodigo = d.rotaCodigo ?? "MIAMI_PARAGUAI_BRASIL";
  return prisma.viagem.create({
    data: {
      ...d,
      lojaId,
      rotaCodigo,
      checkpointsObrigatorios: rotaCodigo === "MIAMI_PARAGUAI_BRASIL"
        ? ["MIAMI", "PARAGUAI", "BRASIL", "RECEBIMENTO", "ENTRADA_DEFINITIVA"]
        : ["MIAMI", "BRASIL", "RECEBIMENTO", "ENTRADA_DEFINITIVA"]
    }
  });
}
export async function tripStatus(
  lojaId: string,
  userId: string,
  id: string,
  status: ViagemStatus
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Viagem" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const t = await tx.viagem.findFirst({ where: { id, lojaId } });
    if (!t) throw new AppError(404, "not_found");
    if (!tripTransitions[t.status].includes(status))
      throw new AppError(409, "conflict");
    if (status === "CANCELLED" && await tx.alocacaoMala.count({
      where: { lojaId, mala: { viagemId: id } }
    })) throw new AppError(409, "conflict");
    if (status === "ARRIVED_BRAZIL" && t.checkpointsObrigatorios.includes("PARAGUAI")) {
      const bags = await tx.mala.findMany({
        where: { lojaId, viagemId: id, status: { not: "CANCELLED" } },
        select: { id: true, status: true }
      });
      const cleared = await clearedParaguayBags(tx, lojaId, bags.map((bag) => bag.id));
      if (!readyAfterParaguay(bags, cleared))
        throw new AppError(409, "checkpoint_required");
    }
    const updated = await tx.viagem.updateMany({
      where: { id, lojaId, status: t.status },
      data: {
        status,
        chegadaRealEm: status === "ARRIVED_BRAZIL" ? new Date() : undefined
      }
    });
    if (!updated.count) throw new AppError(409, "conflict");
    const result = await tx.viagem.findUniqueOrThrow({ where: { id } });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: null,
      action: "UPDATE_TRIP_STATUS", entity: "Viagem", entityId: id,
      correlationId: randomUUID(), origin: "API_LOGISTICS",
      before: { status: t.status, chegadaRealEm: t.chegadaRealEm },
      after: { status: result.status, chegadaRealEm: result.chegadaRealEm }
    });
    return result;
  });
}
export const suitcases = async (lojaId: string) =>
  (await prisma.mala.findMany({
    where: { lojaId },
    include: {
      viagem: { select: { status: true } },
      recebimentos: { where: { status: "COMPLETED", supersededAt: null }, select: { id: true } },
      volumes: true,
      alocacoes: { include: allocationItem }
    }
  })).map(({ viagem, recebimentos, ...bag }) => ({
    ...bag,
    allowedStatusTransitions: suitcaseTransitions[bag.status].filter((next) =>
      (next !== "PLANNING" || !departedTrip.includes(viagem.status)) &&
      (next !== "ARRIVED_BRAZIL" || viagem.status === "ARRIVED_BRAZIL") &&
      (next !== "RECEIVED" || recebimentos.length > 0) &&
      (next !== "CANCELLED" || bag.alocacoes.length === 0) &&
      (next !== "CLOSED" || bag.alocacoes.reduce((sum, allocation) => sum.plus(allocation.pesoConteudoKg), new Prisma.Decimal(0))
        .plus(bag.volumes.reduce((sum, volume) => sum.plus(volume.taraKg), new Prisma.Decimal(0)))
        .lessThanOrEqualTo(bag.limitePesoKg))
    )
  }));
export async function createSuitcase(
  lojaId: string,
  d: { viagemId: string; codigo: string; limitePesoKg?: number; posicaoId?: string },
  actor: Actor
) {
  return prisma.$transaction(async (tx) => {
    await assertOperable(tx, actor, d.posicaoId ?? MIAMI_BASE_ID);
    await tx.$queryRaw`SELECT id FROM "Viagem" WHERE id = ${d.viagemId} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const trip = await tx.viagem.findFirst({ where: {
      id: d.viagemId, lojaId,
      status: { notIn: ["CANCELLED", "ARRIVED_BRAZIL"] }
    } });
    if (!trip) throw new AppError(404, "not_found");
    return tx.mala.create({ data: { ...d, posicaoId: d.posicaoId ?? MIAMI_BASE_ID, lojaId } });
  });
}
export async function addVolume(
  lojaId: string,
  malaId: string,
  d: { codigo: string; taraKg: number }
) {
  if (d.taraKg < 0) throw new AppError(400, "bad_request");
  return withPlanningSuitcase(lojaId, malaId, (tx) =>
    tx.volumeLogistico.create({ data: { ...d, malaId, lojaId } })
  );
}
export async function weight(
  lojaId: string,
  malaId: string,
  db: Prisma.TransactionClient = prisma
) {
  const m = await db.mala.findFirst({
    where: { id: malaId, lojaId },
    include: { volumes: true, alocacoes: true }
  });
  if (!m) throw new AppError(404, "not_found");
  const conteudo = m.alocacoes.reduce(
      (s, a) => s.plus(a.pesoConteudoKg),
      new Prisma.Decimal(0)
    ),
    tara = m.volumes.reduce((s, v) => s.plus(v.taraKg), new Prisma.Decimal(0)),
    total = conteudo.plus(tara);
  return {
    conteudoKg: conteudo,
    taraKg: tara,
    totalKg: total,
    restanteKg: Prisma.Decimal.max(0, m.limitePesoKg.minus(total)),
    excesso: total.greaterThan(m.limitePesoKg)
  };
}
export async function allocate(
  lojaId: string,
  d: {
    pedidoCompraItemId: string;
    malaId: string;
    volumeLogisticoId: string;
    quantidade: number;
  },
  actor: Actor
) {
  return prisma.$transaction(async (tx) => {
    const targetBag = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId }, select: { viagemId: true }
    });
    if (!targetBag) throw new AppError(404, "not_found");
    await tx.$queryRaw`SELECT id FROM "Viagem" WHERE id = ${targetBag.viagemId} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const trip = await tx.viagem.findFirst({
      where: { id: targetBag.viagemId, lojaId }
    });
    if (!trip || trip.status === "CANCELLED") throw new AppError(409, "conflict");
    await tx.$queryRaw`SELECT id FROM "PedidoCompraItem" WHERE id = ${d.pedidoCompraItemId} AND "lojaId" = ${lojaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Mala" WHERE id = ${d.malaId} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const item = await tx.pedidoCompraItem.findFirst({
      where: { id: d.pedidoCompraItemId, lojaId },
      include: { produto: true, alocacoesMala: true }
    });
    const bag = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, status: "PLANNING" },
      include: { volumes: true, alocacoes: true }
    });
    const volume = await tx.volumeLogistico.findFirst({
      where: { id: d.volumeLogisticoId, malaId: d.malaId, lojaId }
    });
    if (!item || !bag || !volume) throw new AppError(404, "not_found");
    await assertOperable(tx, actor, bag.posicaoId);
    if (!item.produto.peso) throw new AppError(409, "missing_weight");
    // Reserva só consome o que já foi recebido na posição da mala e ainda não foi comprometido ali.
    if (d.quantidade < 1 || d.quantidade > (await availableAtPosition(tx, item.id, bag.posicaoId)))
      throw new AppError(409, "conflict");
    const content = bag.alocacoes.reduce(
      (sum, allocation) => sum.plus(allocation.pesoConteudoKg),
      new Prisma.Decimal(0)
    );
    const tare = bag.volumes.reduce(
      (sum, entry) => sum.plus(entry.taraKg),
      new Prisma.Decimal(0)
    );
    const allocationWeight = item.produto.peso.mul(d.quantidade);
    if (content.plus(tare).plus(allocationWeight).greaterThan(bag.limitePesoKg))
      throw new AppError(409, "weight_limit");
    // F-8: a seleção cria reserva persistente com responsável; o fechamento da mala a consome.
    const created = await tx.alocacaoMala.create({
      data: { ...d, lojaId, pesoConteudoKg: allocationWeight, status: "RESERVADA", reservadoPorId: actor.userId }
    });
    await audit(tx, {
      usuarioId: actor.userId, lojaId, permissionCode: null,
      action: "RESERVE_SUITCASE_ALLOCATION", entity: "AlocacaoMala", entityId: created.id,
      correlationId: randomUUID(), origin: "API_LOGISTICS", after: created
    });
    return created;
  });
}
export async function suitcaseStatus(
  lojaId: string,
  userId: string,
  id: string,
  status: MalaStatus,
  motivo?: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mala" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
    const m = await tx.mala.findFirst({ where: { id, lojaId }, include: { viagem: true } });
    if (!m) throw new AppError(404, "not_found");
    if (!suitcaseTransitions[m.status].includes(status))
      throw new AppError(409, "conflict");
    if (status === "ARRIVED_BRAZIL" && m.viagem.status !== "ARRIVED_BRAZIL")
      throw new AppError(409, "conflict");
    if (status === "RECEIVED" && !(await tx.recebimento.findFirst({
      where: { lojaId, malaId: id, status: "COMPLETED", supersededAt: null }
    }))) throw new AppError(409, "conflict");
    if (status === "CANCELLED" && (await tx.alocacaoMala.count({ where: { lojaId, malaId: id } })) > 0)
      throw new AppError(409, "conflict");
    if (status === "CLOSED" && (await weight(lojaId, id, tx)).excesso)
      throw new AppError(409, "weight_limit");
    // D-14: reabrir composição fechada só antes da saída, com motivo auditado.
    if (status === "PLANNING") {
      if (!motivo?.trim()) throw new AppError(400, "reason_required");
      if (departedTrip.includes(m.viagem.status)) throw new AppError(409, "trip_departed");
    }
    if (status === "CLOSED")
      await tx.alocacaoMala.updateMany({ where: { lojaId, malaId: id }, data: { status: "CONSUMIDA", consumidaEm: new Date() } });
    if (status === "PLANNING")
      await tx.alocacaoMala.updateMany({ where: { lojaId, malaId: id }, data: { status: "RESERVADA", consumidaEm: null } });
    const result = await tx.mala.update({ where: { id }, data: { status } });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: null,
      action: "UPDATE_SUITCASE_STATUS", entity: "Mala", entityId: id,
      correlationId: randomUUID(), origin: "API_LOGISTICS", reason: motivo,
      before: { status: m.status }, after: { status: result.status }
    });
    return result;
  });
}
export async function confirmMiami(
  lojaId: string,
  actor: Actor,
  d: {
    posicaoId?: string;
    pedidoCompraItemId: string;
    quantidadeRecebida: number;
    recebidoEm: Date;
    observacao?: string;
    tipoDivergencia?: "CORRETO" | "FALTANTE" | "QUANTIDADE_DIVERGENTE" | "DANIFICADO" | "DESCONHECIDO" | "TRACKING_NAO_LOCALIZADO";
  },
  idempotencyKey?: string
) {
  return idempotentMutation({
    lojaId, operation: "CONFIRM_MIAMI", entityId: d.pedidoCompraItemId, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const i = await tx.pedidoCompraItem.findFirst({
      where: { id: d.pedidoCompraItemId, lojaId },
      include: { pedido: true }
    });
    if (
      !i ||
      (i.pedido.status !== "CONFIRMED" && i.pedido.status !== "PARTIALLY_RECEIVED_MIAMI") ||
      d.quantidadeRecebida < 1 ||
      i.quantidadeRecebidaMiami + d.quantidadeRecebida > i.quantidade
    )
      throw new AppError(409, "conflict");
    // D-15/T31: recebe-se só no destino do pedido; outro local exige redirecionamento autorizado.
    if (d.posicaoId && d.posicaoId !== i.pedido.destinoPosicaoId)
      throw new AppError(409, "destination_mismatch");
    await assertOperable(tx, actor, i.pedido.destinoPosicaoId);
    const userId = actor.userId;
    const atraso = Date.now() - d.recebidoEm.getTime() > 86400000;
    const r = await tx.recebimentoMiami.create({
      data: {
        pedidoCompraItemId: d.pedidoCompraItemId,
        quantidadeRecebida: d.quantidadeRecebida,
        recebidoEm: d.recebidoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO",
        posicaoId: i.pedido.destinoPosicaoId,
        lojaId,
        confirmadoPorId: userId,
        atraso
      }
    });
    const qty = i.quantidadeRecebidaMiami + d.quantidadeRecebida;
    await tx.pedidoCompraItem.update({
      where: { id: i.id },
      data: { quantidadeRecebidaMiami: qty }
    });
    const orderItems = await tx.pedidoCompraItem.findMany({
      where: { pedidoCompraId: i.pedidoCompraId },
      select: { quantidade: true, quantidadeRecebidaMiami: true }
    });
    const complete = orderItems.every(
      (item) => item.quantidadeRecebidaMiami >= item.quantidade
    );
    await tx.pedidoCompra.update({
      where: { id: i.pedidoCompraId },
      data: {
        status: complete ? "RECEIVED_MIAMI" : "PARTIALLY_RECEIVED_MIAMI"
      }
    });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "MIAMI_RECEBIMENTO_CONFIRMAR",
      action: "CONFIRM_MIAMI", entity: "PedidoCompraItem", entityId: i.id,
      correlationId, idempotencyKey, before: { quantidadeRecebidaMiami: i.quantidadeRecebidaMiami },
      after: { quantidadeRecebidaMiami: qty, tipoDivergencia: r.tipoDivergencia }
    });
    return r;
    }
  });
}

export async function updateTraveler(
  lojaId: string,
  id: string,
  d: {
    nome?: string;
    email?: string;
    telefone?: string;
    observacoes?: string;
    ativo?: boolean;
  }
) {
  const t = await prisma.viajante.findFirst({
    where: { id, lojaId }
  });
  if (!t) throw new AppError(404, "not_found");
  return prisma.viajante.update({
    where: { id },
    data: d
  });
}

export async function deleteTraveler(lojaId: string, id: string) {
  const t = await prisma.viajante.findFirst({
    where: { id, lojaId }
  });
  if (!t) throw new AppError(404, "not_found");
  const hasTrips = await prisma.viagem.findFirst({
    where: { viajanteId: id, lojaId }
  });
  if (hasTrips) throw new AppError(409, "conflict");
  return prisma.viajante.delete({ where: { id } });
}

export async function updateTrip(
  lojaId: string,
  id: string,
  d: {
    origem?: string;
    destino?: string;
    partidaEm?: Date;
    chegadaPrevistaEm?: Date;
    observacoes?: string;
  }
) {
  const t = await prisma.viagem.findFirst({
    where: { id, lojaId }
  });
  if (!t) throw new AppError(404, "not_found");
  if (t.status !== "PLANNED" && Object.keys(d).length > 0)
    throw new AppError(409, "conflict");
  return prisma.viagem.update({
    where: { id },
    data: d,
    include: { viajante: { select: { id: true, nome: true, ativo: true } }, malas: true }
  });
}

export async function deleteTrip(lojaId: string, id: string) {
  const t = await prisma.viagem.findFirst({
    where: { id, lojaId }
  });
  if (!t) throw new AppError(404, "not_found");
  if (t.status !== "PLANNED") throw new AppError(409, "conflict");
  return prisma.viagem.delete({ where: { id } });
}

export async function updateSuitcase(
  lojaId: string,
  id: string,
  d: {
    codigo?: string;
    limitePesoKg?: number;
    observacoes?: string;
  }
) {
  return withPlanningSuitcase(lojaId, id, (tx) =>
    tx.mala.update({
      where: { id },
      data: d,
      include: { volumes: true, alocacoes: { include: allocationItem } }
    })
  );
}

export async function deleteSuitcase(lojaId: string, id: string) {
  return withPlanningSuitcase(lojaId, id, async (tx) => {
    if (await tx.alocacaoMala.count({ where: { malaId: id, lojaId } }))
      throw new AppError(409, "conflict");
    await tx.volumeLogistico.deleteMany({ where: { malaId: id, lojaId } });
    return tx.mala.delete({ where: { id } });
  });
}

export async function updateVolume(
  lojaId: string,
  malaId: string,
  volumeId: string,
  d: {
    codigo?: string;
    taraKg?: number;
  }
) {
  return withPlanningSuitcase(lojaId, malaId, async (tx) => {
    const volume = await tx.volumeLogistico.findFirst({
      where: { id: volumeId, malaId, lojaId }
    });
    if (!volume) throw new AppError(404, "not_found");
    return tx.volumeLogistico.update({ where: { id: volumeId }, data: d });
  });
}

export async function deleteVolume(
  lojaId: string,
  malaId: string,
  volumeId: string
) {
  return withPlanningSuitcase(lojaId, malaId, async (tx) => {
    const volume = await tx.volumeLogistico.findFirst({
      where: { id: volumeId, malaId, lojaId }
    });
    if (!volume) throw new AppError(404, "not_found");
    return tx.volumeLogistico.delete({ where: { id: volumeId } });
  });
}

export async function deallocate(lojaId: string, alocacaoId: string) {
  const a = await prisma.alocacaoMala.findFirst({
    where: { id: alocacaoId, lojaId }
  });
  if (!a) throw new AppError(404, "not_found");
  return withPlanningSuitcase(lojaId, a.malaId, async (tx) => {
    const allocation = await tx.alocacaoMala.findFirst({
      where: { id: alocacaoId, malaId: a.malaId, lojaId }
    });
    if (!allocation) throw new AppError(404, "not_found");
    return tx.alocacaoMala.delete({ where: { id: alocacaoId } });
  });
}

export async function confirmParaguai(
  lojaId: string,
  userId: string,
  d: {
    viagemId: string;
    malaId: string;
    confirmadoEm: Date;
    observacao?: string;
    tipoDivergencia?: "CORRETO" | "MALA_AUSENTE" | "VOLUME_AUSENTE" | "ITEM_NAO_LOCALIZADO" | "QUANTIDADE_DIVERGENTE" | "AVARIA" | "ITEM_EXTRA" | "CHECKPOINT_PARCIAL";
  },
  idempotencyKey?: string
) {
  return idempotentMutation({
    lojaId, operation: "CONFIRM_PARAGUAY", entityId: `${d.viagemId}:${d.malaId}`, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId }
    });
    if (!viagem) throw new AppError(404, "not_found");
    if (!viagem.checkpointsObrigatorios.includes("PARAGUAI"))
      throw new AppError(409, "checkpoint_not_applicable");
    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");
    assertParaguayTransition(viagem, mala);
    const checkpoint = await tx.checkpointParaguai.create({
      data: {
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO"
      }
    });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "PARAGUAI_CHECKPOINT_CONFIRMAR",
      action: "CONFIRM_PARAGUAY", entity: "CheckpointParaguai", entityId: checkpoint.id,
      correlationId, idempotencyKey, after: checkpoint
    });
    return checkpoint;
    }
  });
}

export async function confirmBrasil(
  lojaId: string,
  userId: string,
  d: {
    viagemId: string;
    malaId: string;
    confirmadoEm: Date;
    observacao?: string;
    tipoDivergencia?: "CORRETO" | "MALA_AUSENTE" | "ITEM_NAO_LOCALIZADO" | "QUANTIDADE_DIVERGENTE" | "AVARIA" | "ITEM_EXTRA" | "REGISTRO_ADUANEIRO_DIVERGENTE" | "LACRE_ROMPIDO";
  },
  idempotencyKey?: string
) {
  return idempotentMutation({
    lojaId, operation: "CONFIRM_BRAZIL", entityId: `${d.viagemId}:${d.malaId}`, key: idempotencyKey, payload: d,
    execute: async (tx, correlationId) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId, status: "ARRIVED_BRAZIL" }
    });
    if (!viagem) throw new AppError(404, "not_found");
    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");
    const paraguay = await tx.checkpointParaguai.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId, supersededAt: null }
    });
    const paraguayProjection = paraguay ? await tx.projecaoOperacional.findUnique({
      where: { lojaId_entity_entityId: { lojaId, entity: "CheckpointParaguai", entityId: paraguay.id } }
    }) : null;
    const effectiveParaguay = paraguay ? {
      tipoDivergencia: (paraguayProjection?.state as { tipoDivergencia?: string } | null)?.tipoDivergencia ?? paraguay.tipoDivergencia
    } : null;
    assertBrazilTransition(viagem, mala, effectiveParaguay);
    const checkpoint = await tx.checkpointBrasil.create({
      data: {
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO"
      }
    });
    await audit(tx, {
      usuarioId: userId, lojaId, permissionCode: "BRASIL_CHECKPOINT_CONFIRMAR",
      action: "CONFIRM_BRAZIL", entity: "CheckpointBrasil", entityId: checkpoint.id,
      correlationId, idempotencyKey, after: checkpoint
    });
    return checkpoint;
    }
  });
}
