import { z } from "zod";
const money = z.number().min(0);
export const itemSchema = z
  .object({
    produtoId: z.string().min(1),
    quantidade: z.number().int().positive(),
    precoUnitario: money,
    descontoItem: money.default(0),
    observacoes: z.string().nullable().optional()
  })
  .strict();
export const orderCreateSchema = z
  .object({
    lojaId: z.string().optional(),
    fornecedorId: z.string(),
    numeroPedido: z.string().min(1),
    dataCompra: z.coerce.date(),
    moeda: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    descontoPedido: money.default(0),
    frete: money.default(0),
    imposto: money.default(0),
    observacoes: z.string().nullable().optional(),
    itens: z.array(itemSchema).default([])
  })
  .strict();
export const orderUpdateSchema = orderCreateSchema
  .omit({ lojaId: true, itens: true })
  .partial()
  .strict();
export const itemUpdateSchema = itemSchema.partial().strict();
export const statusSchema = z
  .object({
    status: z.enum([
      "DRAFT",
      "PLACED",
      "CONFIRMED",
      "PARTIALLY_RECEIVED_MIAMI",
      "RECEIVED_MIAMI",
      "ALLOCATED_TO_TRIP",
      "IN_TRANSIT_BRAZIL",
      "ARRIVED_BRAZIL",
      "COMPLETED",
      "CANCELLED"
    ])
  })
  .strict();
export const querySchema = z.object({
  numero: z.string().optional(),
  fornecedorId: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
