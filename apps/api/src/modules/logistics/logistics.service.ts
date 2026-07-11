import { MalaStatus, Prisma, ViagemStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
const tripTransitions: Record<string, string[]> = {
  PLANNED: ["OPEN_FOR_ALLOCATION"],
  OPEN_FOR_ALLOCATION: ["CLOSED_FOR_ALLOCATION", "CANCELLED"],
  CLOSED_FOR_ALLOCATION: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED_BRAZIL"]
};
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
export const trips = (lojaId: string) =>
  prisma.viagem.findMany({
    where: { lojaId },
    include: {
      viajante: { select: { id: true, nome: true, ativo: true } },
      malas: true
    }
  });
export async function createTrip(
  lojaId: string,
  d: {
    viajanteId: string;
    origem: string;
    destino: string;
    partidaEm: Date;
    chegadaPrevistaEm: Date;
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
  return prisma.viagem.create({ data: { ...d, lojaId } });
}
export async function tripStatus(
  lojaId: string,
  id: string,
  status: ViagemStatus
) {
  const t = await prisma.viagem.findFirst({ where: { id, lojaId } });
  if (!t) throw new AppError(404, "not_found");
  if (!tripTransitions[t.status]?.includes(status))
    throw new AppError(409, "conflict");
  return prisma.viagem.update({
    where: { id },
    data: {
      status,
      chegadaRealEm: status === "ARRIVED_BRAZIL" ? new Date() : undefined
    }
  });
}
export const suitcases = (lojaId: string) =>
  prisma.mala.findMany({
    where: { lojaId },
    include: {
      volumes: true,
      alocacoes: { include: { item: { include: { produto: true } } } }
    }
  });
export async function createSuitcase(
  lojaId: string,
  d: { viagemId: string; codigo: string; limitePesoKg?: number }
) {
  const t = await prisma.viagem.findFirst({
    where: {
      id: d.viagemId,
      lojaId,
      status: { notIn: ["CANCELLED", "ARRIVED_BRAZIL"] }
    }
  });
  if (!t) throw new AppError(404, "not_found");
  return prisma.mala.create({ data: { ...d, lojaId } });
}
export async function addVolume(
  lojaId: string,
  malaId: string,
  d: { codigo: string; taraKg: number }
) {
  if (d.taraKg < 0) throw new AppError(400, "bad_request");
  if (
    !(await prisma.mala.findFirst({
      where: { id: malaId, lojaId, status: "PLANNING" }
    }))
  )
    throw new AppError(409, "conflict");
  return prisma.volumeLogistico.create({ data: { ...d, malaId, lojaId } });
}
export async function weight(lojaId: string, malaId: string) {
  const m = await prisma.mala.findFirst({
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
  }
) {
  const item = await prisma.pedidoCompraItem.findFirst({
      where: { id: d.pedidoCompraItemId, lojaId },
      include: { produto: true, alocacoesMala: true }
    }),
    m = await prisma.mala.findFirst({
      where: { id: d.malaId, lojaId, status: "PLANNING" }
    }),
    v = await prisma.volumeLogistico.findFirst({
      where: { id: d.volumeLogisticoId, malaId: d.malaId, lojaId }
    });
  if (!item || !m || !v) throw new AppError(404, "not_found");
  if (!item.produto.peso) throw new AppError(409, "missing_weight");
  const used = item.alocacoesMala.reduce((s, a) => s + a.quantidade, 0);
  if (d.quantidade < 1 || used + d.quantidade > item.quantidade)
    throw new AppError(409, "conflict");
  const created = await prisma.alocacaoMala.create({
    data: { ...d, lojaId, pesoConteudoKg: item.produto.peso.mul(d.quantidade) }
  });
  if ((await weight(lojaId, d.malaId)).excesso) {
    await prisma.alocacaoMala.delete({ where: { id: created.id } });
    throw new AppError(409, "weight_limit");
  }
  return created;
}
export async function suitcaseStatus(
  lojaId: string,
  id: string,
  status: MalaStatus
) {
  const m = await prisma.mala.findFirst({ where: { id, lojaId } });
  if (!m) throw new AppError(404, "not_found");
  if (status === "CLOSED" && (await weight(lojaId, id)).excesso)
    throw new AppError(409, "weight_limit");
  return prisma.mala.update({ where: { id }, data: { status } });
}
export async function confirmMiami(
  lojaId: string,
  userId: string,
  d: {
    pedidoCompraItemId: string;
    quantidadeRecebida: number;
    recebidoEm: Date;
    observacao?: string;
    tipoDivergencia?: "CORRETO" | "FALTANTE" | "QUANTIDADE_DIVERGENTE" | "DANIFICADO" | "DESCONHECIDO" | "TRACKING_NAO_LOCALIZADO";
  }
) {
  return prisma.$transaction(async (tx) => {
    const i = await tx.pedidoCompraItem.findFirst({
      where: { id: d.pedidoCompraItemId, lojaId },
      include: { pedido: true }
    });
    if (
      !i ||
      d.quantidadeRecebida < 1 ||
      i.quantidadeRecebidaMiami + d.quantidadeRecebida > i.quantidade
    )
      throw new AppError(409, "conflict");
    const atraso = Date.now() - d.recebidoEm.getTime() > 86400000;
    const r = await tx.recebimentoMiami.create({
      data: {
        pedidoCompraItemId: d.pedidoCompraItemId,
        quantidadeRecebida: d.quantidadeRecebida,
        recebidoEm: d.recebidoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO",
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
    return r;
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
  const m = await prisma.mala.findFirst({
    where: { id, lojaId }
  });
  if (!m) throw new AppError(404, "not_found");
  if (m.status !== "PLANNING") throw new AppError(409, "conflict");
  return prisma.mala.update({
    where: { id },
    data: d,
    include: { volumes: true, alocacoes: { include: { item: { include: { produto: true } } } } }
  });
}

export async function deleteSuitcase(lojaId: string, id: string) {
  const m = await prisma.mala.findFirst({
    where: { id, lojaId },
    include: { alocacoes: true }
  });
  if (!m) throw new AppError(404, "not_found");
  if (m.status !== "PLANNING") throw new AppError(409, "conflict");
  if (m.alocacoes.length > 0) throw new AppError(409, "conflict");
  return prisma.$transaction(async (tx) => {
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
  const m = await prisma.mala.findFirst({
    where: { id: malaId, lojaId }
  });
  if (!m) throw new AppError(404, "not_found");
  if (m.status !== "PLANNING") throw new AppError(409, "conflict");
  const v = await prisma.volumeLogistico.findFirst({
    where: { id: volumeId, malaId, lojaId }
  });
  if (!v) throw new AppError(404, "not_found");
  return prisma.volumeLogistico.update({
    where: { id: volumeId },
    data: d
  });
}

export async function deleteVolume(
  lojaId: string,
  malaId: string,
  volumeId: string
) {
  const m = await prisma.mala.findFirst({
    where: { id: malaId, lojaId }
  });
  if (!m) throw new AppError(404, "not_found");
  if (m.status !== "PLANNING") throw new AppError(409, "conflict");
  const v = await prisma.volumeLogistico.findFirst({
    where: { id: volumeId, malaId, lojaId }
  });
  if (!v) throw new AppError(404, "not_found");
  return prisma.volumeLogistico.delete({ where: { id: volumeId } });
}

export async function deallocate(lojaId: string, alocacaoId: string) {
  const a = await prisma.alocacaoMala.findFirst({
    where: { id: alocacaoId, lojaId },
    include: { mala: true }
  });
  if (!a) throw new AppError(404, "not_found");
  if (a.mala.status !== "PLANNING") throw new AppError(409, "conflict");
  return prisma.alocacaoMala.delete({ where: { id: alocacaoId } });
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
  }
) {
  return prisma.$transaction(async (tx) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId }
    });
    if (!viagem) throw new AppError(404, "not_found");
    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");
    const checkpoint = await tx.checkpointParaguai.create({
      data: {
        id: `cp-py-${Date.now()}`,
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO"
      }
    });
    return checkpoint;
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
  }
) {
  return prisma.$transaction(async (tx) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId, status: "ARRIVED_BRAZIL" }
    });
    if (!viagem) throw new AppError(404, "not_found");
    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");
    const checkpoint = await tx.checkpointBrasil.create({
      data: {
        id: `cp-br-${Date.now()}`,
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        tipoDivergencia: d.tipoDivergencia || "CORRETO"
      }
    });
    return checkpoint;
  });
}
