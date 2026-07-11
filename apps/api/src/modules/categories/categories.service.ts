import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { categoryCreateSchema, categoryUpdateSchema } from "./categories.schemas";
import type { z } from "zod";

type CreateInput = z.infer<typeof categoryCreateSchema>;
type UpdateInput = z.infer<typeof categoryUpdateSchema>;
const conflict = (error: unknown) => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "conflict"); throw error; };

export const list = (storeId: string) => prisma.categoria.findMany({ where: { lojaId: storeId }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] });
export async function get(storeId: string, id: string) { const item = await prisma.categoria.findFirst({ where: { id, lojaId: storeId } }); if (!item) throw new AppError(404, "not_found"); return item; }
export async function create(storeId: string, input: CreateInput) { try { return await prisma.categoria.create({ data: { ...input, lojaId: storeId } }); } catch (error) { return conflict(error); } }
export async function update(storeId: string, id: string, input: UpdateInput) { const item = await get(storeId, id); try { return await prisma.categoria.update({ where: { id: item.id }, data: input }); } catch (error) { return conflict(error); } }
export async function toggle(storeId: string, id: string) { const item = await get(storeId, id); return prisma.categoria.update({ where: { id: item.id }, data: { ativo: !item.ativo } }); }
export async function remove(storeId: string, id: string) { const item = await get(storeId, id); if (await prisma.produto.count({ where: { categoriaId: item.id, lojaId: storeId } })) throw new AppError(409, "conflict"); await prisma.categoria.delete({ where: { id: item.id } }); }
