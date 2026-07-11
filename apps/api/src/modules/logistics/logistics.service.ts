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
      data: { ...d, lojaId, confirmadoPorId: userId, atraso }
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
