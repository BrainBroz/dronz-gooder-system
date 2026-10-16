import { createHash } from "node:crypto";
import { Prisma, type MarketplaceProvider } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import { normalizedMarketplaceOrderSchema } from "./marketplace-integrations.schemas";
import type { NormalizedMarketplaceOrder } from "./marketplace-integrations.types";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeId = (value: string) => value.trim().normalize("NFC");
const byJson = <T>(left: T, right: T) => {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

function canonicalOrder(order: NormalizedMarketplaceOrder) {
  const unicodeNormalized = JSON.parse(JSON.stringify(order, (_key, value: unknown) =>
    typeof value === "string" ? value.normalize("NFC") : value
  )) as NormalizedMarketplaceOrder;
  return {
    ...unicodeNormalized,
    items: [...unicodeNormalized.items].sort(byJson),
    shipments: unicodeNormalized.shipments
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

function materialSnapshot(order: NormalizedMarketplaceOrder) {
  return JSON.stringify({
    orderedAt: order.orderedAt,
    currency: order.currency,
    total: order.total ?? null,
    merchant: order.merchant ?? null,
    items: order.items
  });
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
  const candidateIdentity = {
    provider: input.provider,
    contaExternaId: input.accountId,
    externalOrderIdNormalized: externalEvidenceId
  };

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
        if (replay) {
          const candidate = await tx.buyerPurchaseCandidate.findUniqueOrThrow({
            where: { provider_contaExternaId_externalOrderIdNormalized: candidateIdentity },
            select: { id: true }
          });
          return { ...replay, candidateId: candidate.id, created: false };
        }

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
        const prior = await tx.buyerPurchaseCandidate.findUnique({
          where: { provider_contaExternaId_externalOrderIdNormalized: candidateIdentity },
          include: { currentEvidence: {
            select: { sourceOccurredAt: true, normalizedPayload: true }
          } }
        });
        if (prior?.compraImportadaId)
          await tx.$queryRaw`SELECT id FROM "CompraImportada" WHERE id = ${prior.compraImportadaId} FOR UPDATE`;
        const incomingTime = new Date(input.order.updatedAt).getTime();
        const currentTime = prior?.currentEvidence.sourceOccurredAt.getTime() ?? -Infinity;
        const sameTime = currentTime === incomingTime;
        const previous = prior && normalizedMarketplaceOrderSchema.safeParse(
          prior.currentEvidence.normalizedPayload
        );
        const materialChange = !!prior && (!previous || !previous.success ||
          materialSnapshot(canonicalOrder(previous.data)) !== materialSnapshot(normalized));
        const promote = incomingTime > currentTime ||
          (sameTime && (input.order.cancelled || prior?.status !== "CANCELADA"));
        const conflict = materialChange || prior?.status === "COM_DIVERGENCIA";
        const candidate = prior
          ? promote || materialChange ? await tx.buyerPurchaseCandidate.update({
              where: { id: prior.id },
              data: {
                ...(promote ? { currentEvidenceId: evidence.id } : {}),
                status: prior.status === "REJEITADA" ? "REJEITADA"
                  : prior.compraImportadaId
                  ? "COM_DIVERGENCIA"
                  : promote && input.order.cancelled ? "CANCELADA"
                  : conflict || prior.status === "CANCELADA"
                    ? "COM_DIVERGENCIA" : "AGUARDANDO_APROVACAO",
                version: { increment: 1 }
              }
            }) : prior
          : await tx.buyerPurchaseCandidate.create({
              data: {
                ...candidateIdentity,
                currentEvidenceId: evidence.id,
                status: input.order.cancelled ? "CANCELADA" : "AGUARDANDO_APROVACAO"
              }
            });
        await tx.buyerEvidenceLink.create({
          data: {
            candidateId: candidate.id,
            evidenceId: evidence.id,
            type: materialChange || candidate.status === "COM_DIVERGENCIA"
              ? "CONFLICTING" : "MATCHED"
          }
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
        await audit(tx, {
          usuarioId: input.actorId,
          permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
          action: !prior ? "BUYER_CANDIDATE_DETECTED"
            : promote ? "BUYER_CANDIDATE_UPDATED" : "BUYER_EVIDENCE_LINKED",
          entity: "BuyerPurchaseCandidate",
          entityId: candidate.id,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          before: prior ? { status: prior.status, version: prior.version } : undefined,
          after: {
            status: candidate.status,
            version: candidate.version,
            currentEvidenceId: candidate.currentEvidenceId,
            linkedEvidenceId: evidence.id
          },
          origin: "API_MARKETPLACE_INTEGRATIONS"
        });
        return { ...evidence, candidateId: candidate.id, created: true };
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
