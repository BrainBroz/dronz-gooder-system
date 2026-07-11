import { z } from "zod";
export const supplierCreateSchema = z
  .object({
    lojaId: z.string().optional(),
    nome: z.string().min(1),
    nomeFantasia: z.string().nullable().optional(),
    site: z.string().url().nullable().optional(),
    email: z.string().email().nullable().optional(),
    telefone: z.string().nullable().optional(),
    pais: z.string().nullable().optional(),
    moedaPadrao: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    observacoes: z.string().nullable().optional(),
    ativo: z.boolean().optional()
  })
  .strict();
export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .omit({ lojaId: true })
  .strict();
export const supplierQuerySchema = z.object({
  search: z.string().optional(),
  ativo: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
