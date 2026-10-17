import { createHash } from "node:crypto";
import {
  Prisma,
  type MarketplaceProvider,
  type TipoConflitoEvidenciaCompra
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import { normalizedMarketplaceOrderSchema } from "./marketplace-integrations.schemas";
import type { NormalizedMarketplaceOrder } from "./marketplace-integrations.types";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeId = (value: string) => value.trim().normalize("NFC");
const iso = (value: string) => new Date(value).toISOString();
export const hasDuplicateOfficialLineId = (order: NormalizedMarketplaceOrder) => {
  const ids = order.items.flatMap((item) =>
    item.externalLineId ? [normalizeId(item.externalLineId)] : []);
  return new Set(ids).size !== ids.length;
};
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
    orderedAt: iso(unicodeNormalized.orderedAt),
    updatedAt: iso(unicodeNormalized.updatedAt),
    items: [...unicodeNormalized.items].sort(byJson),
    shipments: unicodeNormalized.shipments
      .map((shipment) => ({
        ...shipment,
        shippedAt: shipment.shippedAt ? iso(shipment.shippedAt) : undefined,
        updatedAt: iso(shipment.updatedAt),
        packages: shipment.packages
          .map((externalPackage) => ({
            ...externalPackage,
            trackings: externalPackage.trackings.map((tracking) => ({
              ...tracking,
              createdAt: tracking.createdAt ? iso(tracking.createdAt) : undefined,
              updatedAt: iso(tracking.updatedAt)
            })).sort(byJson)
          }))
          .sort(byJson)
      }))
      .sort(byJson)
  };
}

function materialConflictTypes(
  previous: NormalizedMarketplaceOrder,
  current: NormalizedMarketplaceOrder
): TipoConflitoEvidenciaCompra[] {
  const types: TipoConflitoEvidenciaCompra[] = [];
  if (Date.parse(previous.orderedAt) !== Date.parse(current.orderedAt))
    types.push("ORDER_DATE");
  if (previous.cancelled !== current.cancelled) types.push("CANCELLATION_CHANGED");
  if (previous.externalStatus !== current.externalStatus) types.push("EXTERNAL_STATUS");
  if (previous.currency.toUpperCase() !== current.currency.toUpperCase() ||
      JSON.stringify(previous.items.map((item) => item.currency.toUpperCase()).sort()) !==
      JSON.stringify(current.items.map((item) => item.currency.toUpperCase()).sort()))
    types.push("CURRENCY");
  if (previous.total !== current.total ||
      JSON.stringify(previous.items.map((item) => item.unitPrice).sort()) !==
      JSON.stringify(current.items.map((item) => item.unitPrice).sort()))
    types.push("TOTAL");
  if (JSON.stringify(previous.merchant ?? null) !==
      JSON.stringify(current.merchant ?? null)) types.push("MERCHANT");
  if (JSON.stringify(previous.items) !== JSON.stringify(current.items)) {
    types.push("ITEMS");
    const quantities = (order: NormalizedMarketplaceOrder) => order.items
      .map((item) => ({
        quantity: item.quantity,
        cancelled: item.cancelledQuantity,
        refunded: item.refundedQuantity
      }))
      .sort(byJson);
    if (JSON.stringify(quantities(previous)) !== JSON.stringify(quantities(current)))
      types.push("QUANTITY");
  }
  return types;
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
  if (hasDuplicateOfficialLineId(normalized))
    throw new AppError(409, "buyer_duplicate_external_line_id");
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
        const legacyPurchase = await tx.compraImportada.findUnique({
          where: {
            plataforma_contaExternaId_externalOrderIdNormalizado: {
              plataforma: input.provider,
              contaExternaId: input.accountId,
              externalOrderIdNormalizado: externalEvidenceId
            }
          },
          select: { id: true }
        });
        if (legacyPurchase)
          await tx.$queryRaw`SELECT id FROM "CompraImportada" WHERE id = ${legacyPurchase.id} FOR UPDATE`;
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

        const prior = await tx.buyerPurchaseCandidate.findUnique({
          where: { provider_contaExternaId_externalOrderIdNormalized: candidateIdentity },
          include: { currentEvidence: {
            select: { version: true, sourceOccurredAt: true, normalizedPayload: true }
          } }
        });
        const previous = prior && normalizedMarketplaceOrderSchema.safeParse(
          prior.currentEvidence.normalizedPayload
        );
        if (prior && previous?.success && JSON.stringify(canonicalOrder(previous.data)) === payload)
          return { id: prior.currentEvidenceId, version: prior.currentEvidence.version,
            candidateId: prior.id, created: false };

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
        if (prior?.compraImportadaId && prior.compraImportadaId !== legacyPurchase?.id)
          await tx.$queryRaw`SELECT id FROM "CompraImportada" WHERE id = ${prior.compraImportadaId} FOR UPDATE`;
        const linkedPurchaseId = prior?.compraImportadaId ?? legacyPurchase?.id ?? null;
        const incomingTime = new Date(input.order.updatedAt).getTime();
        const currentTime = prior?.currentEvidence.sourceOccurredAt.getTime() ?? -Infinity;
        const sameTime = currentTime === incomingTime;
        const conflictTypes: TipoConflitoEvidenciaCompra[] = !prior ? []
          : previous && previous.success
            ? materialConflictTypes(canonicalOrder(previous.data), normalized)
            : ["INVALID_PRIOR_EVIDENCE"];
        if (normalized.items.some((item) =>
          item.currency.toUpperCase() !== normalized.currency.toUpperCase()) &&
          !conflictTypes.includes("CURRENCY"))
          conflictTypes.push("CURRENCY");
        const promote = incomingTime > currentTime ||
          (sameTime && (input.order.cancelled || prior?.status !== "CANCELADA"));
        if (prior?.compraImportadaId && promote && !conflictTypes.length)
          conflictTypes.push("POST_APPROVAL_EVIDENCE");
        const materialChange = conflictTypes.length > 0;
        const conflict = materialChange || prior?.status === "COM_DIVERGENCIA";
        const candidate = prior
          ? promote || materialChange || !prior.compraImportadaId && !!linkedPurchaseId
            ? await tx.buyerPurchaseCandidate.update({
              where: { id: prior.id },
              data: {
                ...(promote ? { currentEvidenceId: evidence.id } : {}),
                ...(linkedPurchaseId ? { compraImportadaId: linkedPurchaseId } : {}),
                status: prior.status === "REJEITADA" ? "REJEITADA"
                  : !promote && prior.status === "CANCELADA" ? "CANCELADA"
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
                ...(linkedPurchaseId ? { compraImportadaId: linkedPurchaseId } : {}),
                status: input.order.cancelled ? "CANCELADA"
                  : conflictTypes.length ? "COM_DIVERGENCIA" : "AGUARDANDO_APROVACAO"
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
        if (conflictTypes.length) {
          await tx.buyerReconciliationConflict.createMany({
            data: conflictTypes.map((type) => ({
              candidateId: candidate.id,
              referenceEvidenceId: prior?.currentEvidenceId,
              evidenceId: evidence.id,
              type
            }))
          });
          await audit(tx, {
            usuarioId: input.actorId,
            permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
            action: "BUYER_CONFLICT_DETECTED",
            entity: "BuyerPurchaseCandidate",
            entityId: candidate.id,
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            before: { referenceEvidenceId: prior?.currentEvidenceId },
            after: { evidenceId: evidence.id, types: conflictTypes },
            origin: "API_MARKETPLACE_INTEGRATIONS"
          });
        }
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
            compraImportadaId: candidate.compraImportadaId,
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
