import { Prisma, PedidoCompraStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import type { itemSchema, itemUpdateSchema, orderCreateSchema, orderUpdateSchema } from "./purchase-orders.schemas";
type OrderCreate = z.infer<typeof orderCreateSchema>;
type OrderUpdate = z.infer<typeof orderUpdateSchema>;
type Item = z.infer<typeof itemSchema>;
type ItemUpdate = z.infer<typeof itemUpdateSchema>;
const transitions: Record<string, string[]> = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PARTIALLY_RECEIVED_MIAMI", "RECEIVED_MIAMI", "CANCELLED"],
  PARTIALLY_RECEIVED_MIAMI: ["RECEIVED_MIAMI"],
  RECEIVED_MIAMI: ["ALLOCATED_TO_TRIP"],
  ALLOCATED_TO_TRIP: ["IN_TRANSIT_BRAZIL"],
  IN_TRANSIT_BRAZIL: ["ARRIVED_BRAZIL"],
  ARRIVED_BRAZIL: ["COMPLETED"]
};
const total = (q: number, p: number, d: number) =>
  Math.max(0, q * p - d).toFixed(2);
async function recalc(tx: Prisma.TransactionClient, id: string) {
  const o = await tx.pedidoCompra.findUniqueOrThrow({
    where: { id },
    include: { itens: true }
  });
  const subtotal = o.itens.reduce(
    (s, i) => s.plus(i.totalItem),
    new Prisma.Decimal(0)
  );
  const t = Prisma.Decimal.max(
    0,
    subtotal.minus(o.descontoPedido).plus(o.frete).plus(o.imposto)
  );
  return tx.pedidoCompra.update({
    where: { id },
    data: { subtotal, total: t },
    include: { fornecedor: true, itens: { include: { produto: true } } }
  });
}
async function supplier(lojaId: string, id: string) {
  if (!(await prisma.fornecedor.findFirst({ where: { id, lojaId } })))
    throw new AppError(404, "not_found");
}
async function product(lojaId: string, id: string) {
  if (!(await prisma.produto.findFirst({ where: { id, lojaId } })))
    throw new AppError(404, "not_found");
}
export const list = (
  lojaId: string,
  q: {
    numero?: string;
    fornecedorId?: string;
    status?: string;
    page: number;
    limit: number;
  }
) =>
  prisma.pedidoCompra.findMany({
    where: {
      lojaId,
      ...(q.numero
        ? { numeroPedido: { contains: q.numero, mode: "insensitive" } }
        : {}),
      ...(q.fornecedorId ? { fornecedorId: q.fornecedorId } : {}),
      ...(q.status ? { status: q.status as PedidoCompraStatus } : {})
    },
    include: { fornecedor: true, itens: true },
    orderBy: { dataCompra: "desc" },
    skip: (q.page - 1) * q.limit,
    take: q.limit
  });
export async function get(lojaId: string, id: string) {
  const o = await prisma.pedidoCompra.findFirst({
    where: { id, lojaId },
    include: { fornecedor: true, itens: { include: { produto: true } } }
  });
  if (!o) throw new AppError(404, "not_found");
  return o;
}
export async function create(lojaId: string, d: OrderCreate) {
  await supplier(lojaId, d.fornecedorId);
  for (const i of d.itens) await product(lojaId, i.produtoId);
  try {
    return await prisma.$transaction(async (tx) => {
      const o = await tx.pedidoCompra.create({
        data: {
          lojaId,
          fornecedorId: d.fornecedorId,
          numeroPedido: d.numeroPedido,
          dataCompra: d.dataCompra,
          moeda: d.moeda,
          descontoPedido: d.descontoPedido,
          frete: d.frete,
          imposto: d.imposto,
          observacoes: d.observacoes
        }
      });
      for (const i of d.itens)
        await tx.pedidoCompraItem.create({
          data: {
            pedidoCompraId: o.id,
            lojaId,
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            descontoItem: i.descontoItem,
            totalItem: total(i.quantidade, i.precoUnitario, i.descontoItem),
            observacoes: i.observacoes
          }
        });
      return recalc(tx, o.id);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError(409, "conflict");
    throw e;
  }
}
export async function update(lojaId: string, id: string, d: OrderUpdate) {
  const o = await get(lojaId, id);
  if (d.fornecedorId) await supplier(lojaId, d.fornecedorId);
  await prisma.pedidoCompra.update({ where: { id: o.id }, data: d });
  return prisma.$transaction((tx) => recalc(tx, o.id));
}
export async function changeStatus(
  lojaId: string,
  id: string,
  status: PedidoCompraStatus
) {
  const o = await get(lojaId, id);
  if (!transitions[o.status]?.includes(status))
    throw new AppError(409, "conflict");
  return prisma.pedidoCompra.update({
    where: { id: o.id },
    data: { status, canceladoEm: status === "CANCELLED" ? new Date() : null }
  });
}
export async function addItem(lojaId: string, id: string, d: Item) {
  const o = await get(lojaId, id);
  await product(lojaId, d.produtoId);
  return prisma.$transaction(async (tx) => {
    await tx.pedidoCompraItem.create({
      data: {
        pedidoCompraId: o.id,
        lojaId,
        produtoId: d.produtoId,
        quantidade: d.quantidade,
        precoUnitario: d.precoUnitario,
        descontoItem: d.descontoItem,
        totalItem: total(d.quantidade, d.precoUnitario, d.descontoItem),
        observacoes: d.observacoes
      }
    });
    return recalc(tx, o.id);
  });
}
export async function updateItem(
  lojaId: string,
  id: string,
  itemId: string,
  d: ItemUpdate
) {
  await get(lojaId, id);
  return prisma.$transaction(async (tx) => {
    const i = await tx.pedidoCompraItem.findFirst({
      where: { id: itemId, pedidoCompraId: id, lojaId }
    });
    if (!i) throw new AppError(404, "not_found");
    const q = d.quantidade ?? i.quantidade,
      p = Number(d.precoUnitario ?? i.precoUnitario),
      di = Number(d.descontoItem ?? i.descontoItem);
    await tx.pedidoCompraItem.update({
      where: { id: i.id },
      data: { ...d, totalItem: total(q, p, di) }
    });
    return recalc(tx, id);
  });
}
export async function removeItem(lojaId: string, id: string, itemId: string) {
  await get(lojaId, id);
  return prisma.$transaction(async (tx) => {
    const r = await tx.pedidoCompraItem.deleteMany({
      where: { id: itemId, pedidoCompraId: id, lojaId }
    });
    if (!r.count) throw new AppError(404, "not_found");
    return recalc(tx, id);
  });
}
export async function searchByNumero(lojaId: string, numero: string) {
  return prisma.pedidoCompra.findMany({
    where: {
      lojaId,
      numeroPedido: { contains: numero, mode: "insensitive" }
    },
    include: {
      fornecedor: true,
      itens: { include: { produto: true } }
    },
    orderBy: { dataCompra: "desc" },
    take: 20
  });
}

export async function remove(lojaId: string, id: string) {
  const o = await get(lojaId, id);
  if (o.status !== "DRAFT") throw new AppError(409, "conflict");
  await prisma.pedidoCompra.delete({ where: { id: o.id } });
}
