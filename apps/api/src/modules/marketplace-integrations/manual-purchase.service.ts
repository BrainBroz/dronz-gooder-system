import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { audit, idempotentMutation } from "../operations/operations.persistence";
import { MANUAL_PREFIX } from "./purchases-feed.service";

const ORIGIN = "API_MARKETPLACE_INTEGRATIONS";
const tracking = z.object({ codigo: z.string().trim().min(3).max(80), transportadora: z.string().trim().min(1).max(30).optional() }).strict();

/** Compra feita fora do eBay (Shop.com, Amazon, loja física…): produto, quantidade e preço em dólar, a loja e, se já tiver, o rastreio. */
export const manualPurchaseSchema = z
  .object({
    lojaId: z.string().cuid(),
    referencia: z.string().trim().min(1).max(120).optional(),
    vendedor: z.string().trim().min(1).max(120).optional(),
    dataPedido: z.coerce.date().refine((date) => date.getTime() <= Date.now() + 24 * 60 * 60 * 1000, "future_date"),
    itens: z
      .array(
        z
          .object({
            titulo: z.string().trim().min(1).max(300),
            quantidade: z.number().int().min(1).max(100_000),
            precoUnitario: z.number().finite().min(0).max(10_000_000),
            fotoUrl: z.string().trim().url().max(2000).optional()
          })
          .strict()
      )
      .min(1)
      .max(50),
    rastreio: tracking.optional()
  })
  .strict();

export const manualTrackingSchema = z.object({ rastreio: tracking.nullable() }).strict();

const can = (identity: AuthIdentity, code: string) =>
  identity.permissoes.some((permission) => permission.code === "SYSTEM_ADMIN" || permission.code === code);
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function registerManualPurchase(identity: AuthIdentity, input: z.infer<typeof manualPurchaseSchema>, key?: string) {
  if (!can(identity, "COMPRAS_IMPORTADAS_IMPORTAR")) throw new AppError(403, "insufficient_permission");
  if (!identity.lojas.some((store) => store.id === input.lojaId)) throw new AppError(403, "cross_store_access");
  const external = `manual:${key ? sha(`${identity.user.id}:${key}`) : randomUUID()}`;
  return idempotentMutation({
    lojaId: input.lojaId,
    operation: "REGISTER_MANUAL_PURCHASE",
    entityId: external,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const day = input.dataPedido.toISOString().slice(0, 10).replaceAll("-", "");
      const reference = input.referencia ?? `MAN-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const total = input.itens.reduce((sum, item) => sum + item.quantidade * item.precoUnitario, 0);
      const purchase = await tx.compraImportada.create({
        data: {
          numeroPedido: reference,
          quantidade: input.itens.reduce((sum, item) => sum + item.quantidade, 0),
          moeda: "USD",
          plataforma: "MANUAL",
          origem: "MANUAL",
          estado: "IMPORTADA",
          externalOrderIdOriginal: external,
          externalOrderIdNormalizado: external,
          referenciaPesquisavel: reference,
          dataPedido: input.dataPedido,
          totalExterno: Math.round(total * 100) / 100,
          payloadHash: sha(input),
          payloadSnapshot: { vendedor: input.vendedor, rastreios: input.rastreio ? [input.rastreio] : [] },
          itens: {
            create: input.itens.map((item, index) => ({
              quantidade: item.quantidade,
              identityFingerprint: sha({ titulo: item.titulo, preco: item.precoUnitario, referencia: reference }),
              identityDiscriminator: index,
              identityStrategy: "FINGERPRINT" as const,
              titulo: item.titulo,
              precoUnitario: item.precoUnitario,
              moeda: "USD",
              payloadSnapshot: item.fotoUrl ? { fotoUrl: item.fotoUrl } : undefined
            }))
          }
        },
        include: { itens: true }
      });
      for (const item of purchase.itens)
        await tx.atribuicaoCompraItem.create({
          data: { itemExternoId: item.id, lojaId: input.lojaId, quantidade: item.quantidade, motivo: "Compra cadastrada à mão", atribuidoPorId: identity.user.id }
        });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId: input.lojaId,
        permissionCode: "COMPRAS_IMPORTADAS_IMPORTAR",
        action: "MANUAL_PURCHASE_REGISTERED",
        entity: "CompraImportada",
        entityId: purchase.id,
        correlationId,
        idempotencyKey: key,
        after: { numeroPedido: reference, itens: purchase.itens.length, total },
        origin: ORIGIN
      });
      return { id: `${MANUAL_PREFIX}${purchase.id}`, numeroPedido: reference };
    }
  });
}

/** Inclui, troca ou tira o rastreio de uma compra cadastrada à mão (as do eBay trazem o rastreio do vendedor). */
export async function setManualTracking(identity: AuthIdentity, rowId: string, input: z.infer<typeof manualTrackingSchema>) {
  if (!can(identity, "COMPRAS_IMPORTADAS_IMPORTAR")) throw new AppError(403, "insufficient_permission");
  if (!rowId.startsWith(MANUAL_PREFIX)) throw new AppError(409, "purchase_not_manual");
  const purchaseId = rowId.slice(MANUAL_PREFIX.length);
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.compraImportada.findFirst({
      where: { id: purchaseId, plataforma: "MANUAL", itens: { some: { atribuicoes: { some: { lojaId: { in: identity.lojas.map((store) => store.id) } } } } } },
      select: { id: true, payloadSnapshot: true }
    });
    if (!purchase) throw new AppError(404, "not_found");
    const snapshot = (purchase.payloadSnapshot ?? {}) as { vendedor?: string; rastreios?: unknown[] };
    const next = { ...snapshot, rastreios: input.rastreio ? [input.rastreio] : [] };
    await tx.compraImportada.update({ where: { id: purchase.id }, data: { payloadSnapshot: next, version: { increment: 1 } } });
    await audit(tx, {
      usuarioId: identity.user.id,
      permissionCode: "COMPRAS_IMPORTADAS_IMPORTAR",
      action: "MANUAL_PURCHASE_TRACKING_SET",
      entity: "CompraImportada",
      entityId: purchase.id,
      correlationId: rowId,
      before: { rastreios: snapshot.rastreios ?? [] },
      after: { rastreios: next.rastreios },
      origin: ORIGIN
    });
    return { rastreios: next.rastreios };
  });
}
