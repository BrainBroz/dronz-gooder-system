import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
const conflict = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new AppError(409, "conflict");
  throw e;
};
export const list = (
  lojaId: string,
  q: { search?: string; ativo?: boolean; page: number; limit: number }
) =>
  prisma.fornecedor.findMany({
    where: {
      lojaId,
      ...(q.search
        ? {
            OR: [
              { nome: { contains: q.search, mode: "insensitive" } },
              { nomeFantasia: { contains: q.search, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(q.ativo === undefined ? {} : { ativo: q.ativo })
    },
    orderBy: { nome: "asc" },
    skip: (q.page - 1) * q.limit,
    take: q.limit
  });
export async function get(lojaId: string, id: string) {
  const v = await prisma.fornecedor.findFirst({ where: { id, lojaId } });
  if (!v) throw new AppError(404, "not_found");
  return v;
}
export async function create(
  lojaId: string,
  data: Omit<Prisma.FornecedorUncheckedCreateInput, "lojaId"> & {
    lojaId?: string;
  }
) {
  try {
    return await prisma.fornecedor.create({ data: { ...data, lojaId } });
  } catch (e) {
    return conflict(e);
  }
}
export async function update(
  lojaId: string,
  id: string,
  data: Prisma.FornecedorUpdateInput
) {
  const v = await get(lojaId, id);
  return prisma.fornecedor.update({ where: { id: v.id }, data });
}
export async function toggle(lojaId: string, id: string) {
  const v = await get(lojaId, id);
  return prisma.fornecedor.update({
    where: { id: v.id },
    data: { ativo: !v.ativo }
  });
}
export async function remove(lojaId: string, id: string) {
  const v = await get(lojaId, id);
  if (
    await prisma.pedidoCompra.count({ where: { fornecedorId: v.id, lojaId } })
  )
    throw new AppError(409, "conflict");
  await prisma.fornecedor.delete({ where: { id: v.id } });
}
