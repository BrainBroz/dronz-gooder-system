import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { audit } from "../operations/operations.persistence";
import { isStructuredApiSource } from "./buyer-evidence.service";
import { normalizedMarketplaceOrderSchema } from "./marketplace-integrations.schemas";

/**
 * Compra confirmada que ficou "Com divergência" só porque o envio mudou (rastreio, entrega) recebe a evidência nova da API
 * e volta a "Aprovada": é o mesmo que a atualização automática já faz com as mudanças de envio.
 * Qualquer outra divergência (preço, itens, quantidade, vendedor, cancelamento…) continua para revisão humana.
 */
export async function healShipmentDivergences() {
  const open = await prisma.buyerReconciliationConflict.findMany({
    where: { status: "ABERTO", candidate: { status: "COM_DIVERGENCIA", compraImportadaId: { not: null } } },
    select: { candidateId: true, type: true }
  });
  const types = new Map<string, Set<string>>();
  for (const conflict of open) types.set(conflict.candidateId, (types.get(conflict.candidateId) ?? new Set()).add(conflict.type));
  const onlyShipments = [...types].filter(([, set]) => set.size === 1 && set.has("SHIPMENTS")).map(([id]) => id);
  let healed = 0;
  for (const candidateId of onlyShipments) {
    const done = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "BuyerPurchaseCandidate" WHERE id = ${candidateId} FOR UPDATE`;
        const candidate = await tx.buyerPurchaseCandidate.findUnique({ where: { id: candidateId } });
        if (!candidate || candidate.status !== "COM_DIVERGENCIA" || !candidate.compraImportadaId) return false;
        const conflicts = await tx.buyerReconciliationConflict.findMany({ where: { candidateId, status: "ABERTO" }, orderBy: { createdAt: "desc" } });
        if (!conflicts.length || conflicts.some((conflict) => conflict.type !== "SHIPMENTS")) return false;
        const evidence = await tx.buyerEvidence.findUniqueOrThrow({
          where: { id: conflicts[0]!.evidenceId },
          include: { conexaoMarketplace: { select: { criadoPorId: true } } }
        });
        const order = normalizedMarketplaceOrderSchema.safeParse(evidence.normalizedPayload);
        const actorId = evidence.conexaoMarketplace?.criadoPorId;
        if (!isStructuredApiSource(evidence.source) || !order.success || !actorId) return false;
        await tx.buyerReconciliationConflict.updateMany({
          where: { id: { in: conflicts.map((conflict) => conflict.id) } },
          data: { status: "RESOLVIDO", resolucao: "ACEITAR_EVIDENCIA", motivoResolucao: "Mudança só de envio, aplicada automaticamente", resolvidoPorId: actorId, resolvidoEm: new Date() }
        });
        const updated = await tx.buyerPurchaseCandidate.update({
          where: { id: candidateId },
          data: { currentEvidenceId: evidence.id, status: order.data.cancelled ? "CANCELADA" : "APROVADA", version: { increment: 1 } }
        });
        await audit(tx, {
          usuarioId: actorId,
          permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
          action: "BUYER_SHIPMENT_DIVERGENCE_AUTO_RESOLVED",
          entity: "BuyerPurchaseCandidate",
          entityId: candidateId,
          correlationId: candidateId,
          before: { status: candidate.status, currentEvidenceId: candidate.currentEvidenceId },
          after: { status: updated.status, currentEvidenceId: evidence.id },
          origin: "API_MARKETPLACE_INTEGRATIONS"
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    if (done) healed += 1;
  }
  return healed;
}
