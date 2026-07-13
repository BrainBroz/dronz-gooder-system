import { z } from "zod";

export const platformSchema = z.enum([
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA",
  "MANUAL"
]);
export const originSchema = z.enum(["API", "IMPORTACAO_ARQUIVO", "MANUAL"]);

const metadataSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .optional();

export const accountSchema = z
  .object({
    plataforma: platformSchema,
    identificadorExterno: z.string().trim().min(1).max(200),
    nomeExibicao: z.string().trim().min(1).max(200),
    origemIntegracao: originSchema,
    metadata: metadataSchema
  })
  .strict();

export const merchantSchema = z
  .object({
    plataforma: platformSchema,
    externalMerchantId: z.string().trim().min(1).max(200).optional(),
    nome: z.string().trim().min(1).max(300),
    metadata: metadataSchema
  })
  .strict();

const externalItemObjectSchema = z
  .object({
    externalLineId: z.string().trim().min(1).max(240).optional(),
    titulo: z.string().trim().min(1).max(500),
    variacao: z.string().trim().max(300).optional(),
    sku: z.string().trim().max(200).optional(),
    asin: z.string().trim().max(40).optional(),
    identificadorOferta: z.string().trim().max(200).optional(),
    quantidade: z.number().int().positive(),
    quantidadeCancelada: z.number().int().nonnegative().default(0),
    quantidadeReembolsada: z.number().int().nonnegative().default(0),
    precoUnitario: z.number().nonnegative(),
    moeda: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    merchantExternoId: z.string().cuid().optional(),
    snapshot: metadataSchema
  })
  .strict();

export const externalItemSchema = externalItemObjectSchema.refine(
  (value) =>
    value.quantidadeCancelada + value.quantidadeReembolsada <= value.quantidade,
  { message: "cancelled and refunded quantities exceed total quantity" }
);

export const importPurchaseSchema = z
  .object({
    plataforma: platformSchema.exclude(["MANUAL"]),
    contaExternaId: z.string().cuid(),
    merchantExternoId: z.string().cuid().optional(),
    externalOrderId: z.string().trim().min(1).max(240),
    referencia: z.string().trim().min(1).max(240),
    dataPedido: z.coerce.date(),
    moeda: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    statusExterno: z.string().trim().max(100).optional(),
    totalExterno: z.number().nonnegative().optional(),
    origem: originSchema.exclude(["MANUAL"]),
    itens: z.array(externalItemSchema).min(1).max(500),
    snapshot: metadataSchema
  })
  .strict();

export const manualPurchaseSchema = z
  .object({
    referencia: z.string().trim().min(1).max(240),
    lojaId: z.string().cuid(),
    merchantExternoId: z.string().cuid(),
    dataPedido: z.coerce.date(),
    moeda: z.literal("USD"),
    itens: z
      .array(
        externalItemObjectSchema
          .extend({ produtoId: z.string().cuid() })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict();

export const assignmentSchema = z
  .object({
    quantidade: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    motivo: z.string().trim().min(3).max(500).optional()
  })
  .strict();

export const productMappingSchema = z
  .object({
    produtoId: z.string().cuid(),
    expectedVersion: z.number().int().nonnegative().optional()
  })
  .strict();

export const supplierMappingSchema = z
  .object({
    fornecedorId: z.string().cuid(),
    expectedVersion: z.number().int().nonnegative().optional()
  })
  .strict();

export const materializationSchema = z
  .object({
    expectedPurchaseVersion: z.number().int().positive()
  })
  .strict();

export const resolveConflictSchema = z
  .object({
    motivo: z.string().trim().min(5).max(1000)
  })
  .strict();

export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    estado: z
      .enum(["IMPORTADA", "EM_REVISAO", "CANCELADA", "COM_DIVERGENCIA"])
      .optional(),
    plataforma: platformSchema.optional(),
    contaExternaId: z.string().cuid().optional(),
    merchantExternoId: z.string().cuid().optional(),
    referencia: z.string().trim().max(240).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    lojaId: z.string().cuid().optional()
  })
  .strict();
