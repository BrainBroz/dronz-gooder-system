import { createHash } from "node:crypto";
import { Prisma, type MarketplaceProvider } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import type { NormalizedMarketplaceOrder } from "./marketplace-integrations.types";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeId = (value: string) => value.trim().normalize("NFC");
const byJson = <T>(left: T, right: T) => {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

function canonicalOrder(order: NormalizedMarketplaceOrder) {
  return {
    ...order,
    items: [...order.items].sort(byJson),
    shipments: order.shipments
      .map((shipment) => ({
        ...shipment,
        packages: shipment.packages
          .map((externalPackage) => ({
            ...externalPackage,
            trackings: [...externalPackage.trackings].sort(byJson)
          }))
          .sort(byJson)
      }))
      .sort(byJson)
  };
}

export async function recordMarketplaceEvidence(input: {
  provider: MarketplaceProvider;
  accountId: string;
  connectionId: string;
  order: NormalizedMarketplaceOrder;
  actorId: string;
  correlationId: string;
  idempotencyKey?: string;
}) {
  const normalized = canonicalOrder(input.order);
  const payload = JSON.stringify(normalized);
  const payloadHash = digest(payload);
  const externalEvidenceId = normalizeId(input.order.externalOrderId);
  const sourceIdentity = `${input.provider}:${input.accountId}`;
  const source = input.provider === "EBAY" ? "EBAY_BUYER_API" : "AMAZON_BUSINESS_API";

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ContaExterna" WHERE id = ${input.accountId} FOR UPDATE`;
        const replay = await tx.buyerEvidence.findUnique({
          where: {
            sourceIdentity_externalEvidenceId_payloadHash: {
              sourceIdentity,
              externalEvidenceId,
              payloadHash
            }
          },
          select: { id: true, version: true }
        });
        if (replay) return { ...replay, created: false };

        const latest = await tx.buyerEvidence.findFirst({
          where: { sourceIdentity, externalEvidenceId },
          orderBy: { version: "desc" },
          select: { version: true }
        });
        const repeated = new Map<string, number>();
        const items = normalized.items.map((item) => {
          const externalLineId = item.externalLineId
            ? normalizeId(item.externalLineId)
            : null;
          const identityFingerprint = digest(JSON.stringify(externalLineId ?? {
            sku: item.sku ?? null,
            asin: item.asin ?? null,
            offerId: item.offerId ?? null,
            variation: item.variation ?? null,
            unitPrice: item.unitPrice,
            currency: item.currency
          }));
          const identityDiscriminator = repeated.get(identityFingerprint) ?? 0;
          repeated.set(identityFingerprint, identityDiscriminator + 1);
          return {
            externalLineId,
            identityFingerprint,
            identityDiscriminator,
            title: item.title,
            variation: item.variation,
            sku: item.sku,
            asin: item.asin,
            offerId: item.offerId,
            quantity: item.quantity,
            cancelledQuantity: item.cancelledQuantity,
            refundedQuantity: item.refundedQuantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            currency: item.currency
          };
        });
        const evidence = await tx.buyerEvidence.create({
          data: {
            source,
            sourceIdentity,
            externalEvidenceId,
            externalOrderIdNormalized: externalEvidenceId,
            contaExternaId: input.accountId,
            conexaoMarketplaceId: input.connectionId,
            sourceOccurredAt: new Date(input.order.updatedAt),
            payloadHash,
            version: (latest?.version ?? 0) + 1,
            normalizedPayload: JSON.parse(payload) as Prisma.InputJsonValue,
            correlationId: input.correlationId,
            items: { create: items }
          },
          select: { id: true, version: true }
        });
        await audit(tx, {
          usuarioId: input.actorId,
          permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
          action: "BUYER_EVIDENCE_RECORDED",
          entity: "BuyerEvidence",
          entityId: evidence.id,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          after: {
            source,
            accountId: input.accountId,
            externalEvidenceId,
            version: evidence.version,
            payloadHash
          },
          origin: "API_MARKETPLACE_INTEGRATIONS"
        });
        return { ...evidence, created: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" || error.code === "P2002" ||
        (error.code === "P2010" && error.meta?.code === "40001"))) {
      const replay = await prisma.buyerEvidence.findUnique({
        where: {
          sourceIdentity_externalEvidenceId_payloadHash: {
            sourceIdentity, externalEvidenceId, payloadHash
          }
        },
        select: { id: true, version: true }
      });
      if (replay) return { ...replay, created: false };
      throw new AppError(409, "concurrent_modification");
    }
    throw error;
  }
}
