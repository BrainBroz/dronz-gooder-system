import { z } from "zod";
import { AppError } from "../../lib/app-error";
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

  const items = parsed.map(({ candidate, order }) => {
    const connection = candidate.contaExterna.conexoes[0];
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
      store: connection?.lojaPermitida ? { id: connection.lojaPermitida.id, slug: connection.lojaPermitida.slug, nome: connection.lojaPermitida.nome } : null,
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
