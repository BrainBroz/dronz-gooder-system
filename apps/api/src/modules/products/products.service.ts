import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { productCreateSchema, productQuerySchema, productUpdateSchema } from "./products.schemas";

type CreateInput = z.infer<typeof productCreateSchema>; type UpdateInput = z.infer<typeof productUpdateSchema>; type Query = z.infer<typeof productQuerySchema>;
const conflict = (error: unknown) => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "conflict"); throw error; };
async function ensureCategory(storeId: string, id: string) { if (!await prisma.categoria.findFirst({ where: { id, lojaId: storeId } })) throw new AppError(404, "not_found"); }
export const list = (storeId: string, query: Query) => prisma.produto.findMany({ where: { lojaId: storeId, ...(query.search ? { OR: [{ nome: { contains: query.search, mode: "insensitive" as const } }, { slug: { contains: query.search, mode: "insensitive" as const } }] } : {}), ...(query.categoriaId ? { categoriaId: query.categoriaId } : {}), ...(query.ativo === undefined ? {} : { ativo: query.ativo }) }, orderBy: [{ nome: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit, include: { categoria: true } });
export async function get(storeId: string, id: string) { const item = await prisma.produto.findFirst({ where: { id, lojaId: storeId }, include: { categoria: true } }); if (!item) throw new AppError(404, "not_found"); return item; }
export async function create(storeId: string, input: CreateInput) { await ensureCategory(storeId, input.categoriaId); try { return await prisma.produto.create({ data: { ...input, lojaId: storeId, precoVenda: input.precoVenda.toFixed(2), markup: input.markup.toFixed(2), peso: input.peso == null ? undefined : input.peso.toFixed(3) } }); } catch (error) { return conflict(error); } }
export async function update(storeId: string, id: string, input: UpdateInput) { const item = await get(storeId, id); if (input.categoriaId) await ensureCategory(storeId, input.categoriaId); try { return await prisma.produto.update({ where: { id: item.id }, data: { ...input, precoVenda: input.precoVenda === undefined ? undefined : input.precoVenda.toFixed(2), markup: input.markup === undefined ? undefined : input.markup.toFixed(2), peso: input.peso == null ? undefined : input.peso.toFixed(3) } }); } catch (error) { return conflict(error); } }
export async function toggle(storeId: string, id: string) { const item = await get(storeId, id); return prisma.produto.update({ where: { id: item.id }, data: { ativo: !item.ativo } }); }
export async function remove(storeId: string, id: string) { const item = await get(storeId, id); await prisma.produto.delete({ where: { id: item.id } }); }
