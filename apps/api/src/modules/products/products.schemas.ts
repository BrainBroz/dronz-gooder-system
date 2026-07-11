import { z } from "zod";

export const productCreateSchema = z.object({ lojaId: z.string().min(1).optional(), categoriaId: z.string().min(1), codigo: z.number().int().min(1), nome: z.string().min(1), slug: z.string().min(1), descricao: z.string().optional().nullable(), precoVenda: z.number().min(0), markup: z.number().min(25), peso: z.number().min(0).optional().nullable(), ativo: z.boolean().optional() }).strict();
export const productUpdateSchema = productCreateSchema.partial().omit({ lojaId: true, codigo: true }).strict();
export const productQuerySchema = z.object({ search: z.string().optional(), categoriaId: z.string().optional(), ativo: z.enum(["true", "false"]).transform((value) => value === "true").optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
