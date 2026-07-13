import { z } from "zod";
import { marketplaceCapabilities } from "./marketplace-integrations.types";

export const providerSchema = z.enum(["AMAZON", "EBAY"]);
export const connectionScopeSchema = z.enum(["SHARED", "STORE_DEDICATED"]);
export const capabilitySchema = z.enum(marketplaceCapabilities);

export const createConnectionSchema = z
  .object({
    provider: providerSchema,
    contaExternaId: z.string().cuid(),
    nome: z.string().trim().min(1).max(200),
    identificadorExterno: z.string().trim().min(1).max(240),
    regiao: z.string().trim().min(1).max(80).optional(),
    marketplace: z.string().trim().min(1).max(120).optional(),
    escopo: connectionScopeSchema,
    lojaPermitidaId: z.string().cuid().optional(),
    secretReference: z
      .string()
      .regex(/^env:MARKETPLACE_[A-Z0-9_]+$/)
      .max(200)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.escopo === "SHARED" && value.lojaPermitidaId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lojaPermitidaId"],
        message: "shared connection cannot define a store"
      });
    if (value.escopo === "STORE_DEDICATED" && !value.lojaPermitidaId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lojaPermitidaId"],
        message: "dedicated connection requires a store"
      });
  });

export const listConnectionsSchema = z
  .object({
    provider: providerSchema.optional(),
    status: z
      .enum([
        "NOT_CONFIGURED",
        "ACTIVE",
        "INACTIVE",
        "AUTHORIZATION_EXPIRED",
        "ERROR"
      ])
      .optional(),
    escopo: connectionScopeSchema.optional(),
    lojaId: z.string().cuid().optional()
  })
  .strict();

export const syncConnectionSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    replay: z.boolean().default(false)
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "invalid sync window"
  });

export const syncHistorySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict();

const normalizedTrackingSchema = z
  .object({
    code: z.string().trim().min(1).max(240),
    carrier: z.string().trim().min(1).max(160).optional(),
    status: z.string().trim().max(120).optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    replacesCode: z.string().trim().min(1).max(240).optional()
  })
  .strict();

const normalizedItemSchema = z
  .object({
    externalLineId: z.string().trim().min(1).max(240).optional(),
    title: z.string().trim().min(1).max(500),
    sku: z.string().trim().min(1).max(240).optional(),
    asin: z.string().trim().min(1).max(240).optional(),
    offerId: z.string().trim().min(1).max(240).optional(),
    variation: z.string().trim().min(1).max(500).optional(),
    quantity: z.number().int().positive(),
    cancelledQuantity: z.number().int().nonnegative(),
    refundedQuantity: z.number().int().nonnegative(),
    unitPrice: z.number().finite().nonnegative(),
    currency: z.string().trim().length(3)
  })
  .strict()
  .refine(
    (item) => item.cancelledQuantity + item.refundedQuantity <= item.quantity,
    { message: "cancelled and refunded quantities exceed total quantity" }
  );

export const normalizedMarketplaceOrderSchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(240),
    reference: z.string().trim().min(1).max(240),
    orderedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    currency: z.string().trim().length(3),
    total: z.number().finite().nonnegative().optional(),
    externalStatus: z.string().trim().max(120).optional(),
    cancelled: z.boolean(),
    merchant: z
      .object({
        externalMerchantId: z.string().trim().min(1).max(240).optional(),
        name: z.string().trim().min(1).max(500)
      })
      .strict()
      .optional(),
    items: z.array(normalizedItemSchema).min(1).max(500),
    shipments: z
      .array(
        z
          .object({
            externalShipmentId: z.string().trim().min(1).max(240),
            status: z.string().trim().max(120).optional(),
            shippedAt: z.string().datetime().optional(),
            updatedAt: z.string().datetime(),
            packages: z
              .array(
                z
                  .object({
                    externalPackageId: z.string().trim().min(1).max(240),
                    carrier: z.string().trim().min(1).max(160).optional(),
                    trackings: z.array(normalizedTrackingSchema).max(100)
                  })
                  .strict()
              )
              .max(100)
          })
          .strict()
      )
      .max(100)
  })
  .strict();

export const marketplaceOrderPageSchema = z
  .object({
    orders: z.array(normalizedMarketplaceOrderSchema).max(500),
    nextCursor: z.string().trim().min(1).max(2000).optional()
  })
  .strict();
