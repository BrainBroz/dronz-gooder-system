import { z } from "zod";

export const categoryCreateSchema = z.object({ lojaId: z.string().min(1).optional(), nome: z.string().min(1), slug: z.string().min(1), descricao: z.string().optional().nullable(), ordem: z.number().int().default(0), ativo: z.boolean().optional() }).strict();
export const categoryUpdateSchema = categoryCreateSchema.partial().omit({ lojaId: true }).strict();
