import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { itemImages } from "./item-images";
import { normalizedMarketplaceOrderSchema } from "./marketplace-integrations.schemas";

export const feedQuerySchema = z
  .object({
    status: z.enum(["AGUARDANDO_APROVACAO", "COM_DIVERGENCIA", "APROVADA", "REJEITADA", "CANCELADA"]).optional(),
    finalidade: z.enum(["LOJA", "PESSOAL"]).optional(),
    lojaId: z.string().cuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

const can = (identity: AuthIdentity, code: string) =>
  identity.permissoes.some((permission) => permission.code === "SYSTEM_ADMIN" || permission.code === code);

/**
 * Lista de compras para a tela: uma linha por pedido, já com foto, itens, loja da conta, rastreio e status do eBay.
 * Só leitura; aprovar continua pelo endpoint de decisão (que também atribui a loja sozinho).
 */
export async function purchasesFeed(identity: AuthIdentity, input: z.infer<typeof feedQuerySchema>) {
  if (!can(identity, "BUYER_INGESTION_VISUALIZAR")) throw new AppError(403, "insufficient_permission");
  const allowedStores = identity.lojas.map((store) => store.id);
  if (input.lojaId && !allowedStores.includes(input.lojaId)) throw new AppError(403, "marketplace_connection_store_mismatch");
  const where = {
    ...(input.status ? { status: input.status } : {}),
    contaExterna: {
      ...(input.finalidade === "PESSOAL"
        ? { conexoes: { some: { finalidade: "PESSOAL" as const } } }
        : input.finalidade === "LOJA"
          ? { conexoes: { none: { finalidade: "PESSOAL" as const } } }
          : {})
    },
    // Conta dedicada a outra loja não aparece; contas compartilhadas e evidências sem conexão aparecem.
    NOT: { contaExterna: { conexoes: { some: { escopo: "STORE_DEDICATED" as const, lojaPermitidaId: { notIn: allowedStores } } } } },
    ...(input.lojaId ? { AND: [{ contaExterna: { conexoes: { some: { lojaPermitidaId: input.lojaId } } } }] } : {})
  };
  const [rows, total] = await Promise.all([
    prisma.buyerPurchaseCandidate.findMany({
      where,
      include: { currentEvidence: true, contaExterna: { include: { conexoes: { include: { lojaPermitida: true } } } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit
    }),
    prisma.buyerPurchaseCandidate.count({ where })
  ]);

  const parsed = rows.flatMap((candidate) => {
    const order = normalizedMarketplaceOrderSchema.safeParse(candidate.currentEvidence.normalizedPayload);
    return order.success ? [{ candidate, order: order.data }] : [];
  });
  const imagesByProvider = new Map<string, Map<string, string>>();
  for (const provider of new Set(parsed.map(({ candidate }) => candidate.provider)))
    imagesByProvider.set(
      provider,
      await itemImages(
        provider,
        parsed.filter(({ candidate }) => candidate.provider === provider).flatMap(({ order }) => order.items.map((item) => item.offerId).filter((id): id is string => Boolean(id)))
      )
    );

  // Compra confirmada de conta compartilhada: a loja é a das atribuições dos itens (uma só); pode ser trocada até virar estoque.
  const purchaseIds = parsed.map(({ candidate }) => candidate.compraImportadaId).filter((id): id is string => Boolean(id));
  const [assignments, materialized] = purchaseIds.length
    ? await Promise.all([
        prisma.atribuicaoCompraItem.findMany({ where: { itemExterno: { compraImportadaId: { in: purchaseIds } } }, include: { loja: true, itemExterno: { select: { compraImportadaId: true } } } }),
        prisma.materializacaoCompra.findMany({ where: { compraImportadaId: { in: purchaseIds } }, select: { compraImportadaId: true } })
      ])
    : [[], []];
  const storesByPurchase = new Map<string, Map<string, { id: string; slug: string; nome: string }>>();
  for (const assignment of assignments) {
    const bucket = storesByPurchase.get(assignment.itemExterno.compraImportadaId) ?? new Map();
    bucket.set(assignment.loja.id, { id: assignment.loja.id, slug: assignment.loja.slug, nome: assignment.loja.nome });
    storesByPurchase.set(assignment.itemExterno.compraImportadaId, bucket);
  }
  const lockedPurchases = new Set(materialized.map((entry) => entry.compraImportadaId));

  const items = parsed.map(({ candidate, order }) => {
    const connection = candidate.contaExterna.conexoes[0];
    const assigned = candidate.compraImportadaId ? [...(storesByPurchase.get(candidate.compraImportadaId)?.values() ?? [])] : [];
    const dedicated = connection?.escopo === "STORE_DEDICATED" && connection.lojaPermitida
      ? { id: connection.lojaPermitida.id, slug: connection.lojaPermitida.slug, nome: connection.lojaPermitida.nome }
      : null;
    const shipments = order.shipments;
    return {
      candidateId: candidate.id,
      version: candidate.version,
      status: candidate.status,
      orderId: order.externalOrderId,
      orderedAt: order.orderedAt,
      currency: order.currency,
      total: order.total ?? null,
      externalStatus: order.externalStatus ?? null,
      cancelled: order.cancelled,
      account: candidate.contaExterna.identificadorExterno,
      purpose: connection?.finalidade ?? "LOJA",
      store: dedicated ?? (assigned.length === 1 ? assigned[0]! : null),
      // Troca de loja: só em compra confirmada de conta compartilhada e antes de virar estoque.
      canChangeStore: Boolean(candidate.compraImportadaId) && !dedicated && !lockedPurchases.has(candidate.compraImportadaId!) && can(identity, "COMPRAS_IMPORTADAS_ATRIBUIR"),
      shippedAt: shipments.map((shipment) => shipment.shippedAt).find(Boolean) ?? null,
      trackings: shipments.flatMap((shipment) => shipment.packages.flatMap((pack) => pack.trackings.map((tracking) => ({ carrier: tracking.carrier ?? pack.carrier ?? null, code: tracking.code })))),
      items: order.items.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        cancelledQuantity: item.cancelledQuantity,
        unitPrice: item.unitPrice,
        currency: item.currency,
        imageUrl: (item.offerId && imagesByProvider.get(candidate.provider)?.get(item.offerId)) || null
      })),
      canApprove: candidate.status === "AGUARDANDO_APROVACAO" && !candidate.compraImportadaId && can(identity, "BUYER_INGESTION_APROVAR")
    };
  });
  return { items, page: input.page, limit: input.limit, total };
}

export const storeSchema = z.object({ lojaId: z.string().cuid() }).strict();

/**
 * Muda a loja de uma compra confirmada: todos os itens passam a pertencer à loja escolhida (quantidade elegível).
 * Não vale para conta dedicada a outra loja nem para compra que já virou estoque.
 */
export async function setPurchaseStore(identity: AuthIdentity, candidateId: string, input: z.infer<typeof storeSchema>) {
  if (!can(identity, "COMPRAS_IMPORTADAS_ATRIBUIR")) throw new AppError(403, "insufficient_permission");
  if (!identity.lojas.some((store) => store.id === input.lojaId)) throw new AppError(403, "marketplace_connection_store_mismatch");
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.buyerPurchaseCandidate.findUnique({
      where: { id: candidateId },
      include: { contaExterna: { include: { conexoes: true } } }
    });
    if (!candidate) throw new AppError(404, "not_found");
    if (!candidate.compraImportadaId) throw new AppError(409, "purchase_not_confirmed");
    const connection = candidate.contaExterna.conexoes[0];
    if (connection?.escopo === "STORE_DEDICATED" && connection.lojaPermitidaId !== input.lojaId)
      throw new AppError(403, "marketplace_connection_store_mismatch");
    const purchaseId = candidate.compraImportadaId;
    if (await tx.materializacaoCompra.findFirst({ where: { compraImportadaId: purchaseId }, select: { id: true } }))
      throw new AppError(409, "already_materialized");
    const lines = await tx.compraImportadaItem.findMany({ where: { compraImportadaId: purchaseId }, include: { atribuicoes: true } });
    for (const line of lines) {
      if (line.atribuicoes.some((entry) => entry.quantidadeMaterializada > 0)) throw new AppError(409, "already_materialized");
      await tx.atribuicaoCompraItem.deleteMany({ where: { itemExternoId: line.id } });
      const eligible = line.quantidade - line.quantidadeCancelada - line.quantidadeReembolsada;
      if (eligible > 0)
        await tx.atribuicaoCompraItem.create({
          data: { itemExternoId: line.id, lojaId: input.lojaId, quantidade: eligible, motivo: "Loja escolhida na lista de compras", atribuidoPorId: identity.user.id }
        });
      await tx.compraImportadaItem.update({ where: { id: line.id }, data: { version: { increment: 1 } } });
    }
    await audit(tx, {
      usuarioId: identity.user.id,
      lojaId: input.lojaId,
      permissionCode: "COMPRAS_IMPORTADAS_ATRIBUIR",
      action: "PURCHASE_STORE_CHANGED",
      entity: "CompraImportada",
      entityId: purchaseId,
      correlationId: candidateId,
      after: { candidateId, storeId: input.lojaId, lines: lines.length },
      origin: "API_MARKETPLACE_INTEGRATIONS"
    });
    return { lojaId: input.lojaId, itens: lines.length };
  });
}
