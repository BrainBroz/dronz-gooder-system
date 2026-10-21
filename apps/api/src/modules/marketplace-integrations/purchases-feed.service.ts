import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { itemImages } from "./item-images";
import { normalizedMarketplaceOrderSchema } from "./marketplace-integrations.schemas";

const filtersShape = {
  status: z.enum(["AGUARDANDO_APROVACAO", "COM_DIVERGENCIA", "APROVADA", "REJEITADA", "CANCELADA"]).optional(),
  finalidade: z.enum(["LOJA", "PESSOAL"]).optional(),
  lojaId: z.string().cuid().optional()
};
export const purchasePhases = ["CANCELADO", "COMPRADO", "A_CAMINHO_MIAMI", "EM_MIAMI", "EM_REMESSA", "NO_BRASIL"] as const;
export const lotsQuerySchema = z.object(filtersShape).strict();
export const feedQuerySchema = z
  .object({
    ...filtersShape,
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    busca: z.string().trim().min(1).max(100).optional(),
    // Fases separadas por vírgula (as telas de estoque pedem várias de uma vez).
    fases: z
      .string()
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(z.enum(purchasePhases)).min(1))
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(300).default(50)
  })
  .strict();

const can = (identity: AuthIdentity, code: string) =>
  identity.permissoes.some((permission) => permission.code === "SYSTEM_ADMIN" || permission.code === code);

const monthOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)).slice(0, 7);
// shortcut: carrega até 2000 pedidos e filtra por mês, loja e busca em memória; vira consulta no banco se a base passar disso.
const LOAD_LIMIT = 2000;

/**
 * Fase da compra: cancelada; comprada (o vendedor ainda não enviou); a caminho de Miami (o vendedor enviou, com rastreio);
 * e, depois de confirmadas pela equipe, em Miami, em remessa (a caminho do Brasil) e no Brasil.
 */
export type PurchasePhase = (typeof purchasePhases)[number];

/** Carrega os pedidos visíveis ao usuário, já com loja efetiva (da conta dedicada ou da atribuição) e fase. Sem fotos. */
export async function loadRows(identity: AuthIdentity, input: { status?: string; finalidade?: string }) {
  const allowedStores = identity.lojas.map((store) => store.id);
  const where = {
    ...(input.status ? { status: input.status as "APROVADA" } : {}),
    contaExterna: {
      ...(input.finalidade === "PESSOAL"
        ? { conexoes: { some: { finalidade: "PESSOAL" as const } } }
        : input.finalidade === "LOJA"
          ? { conexoes: { none: { finalidade: "PESSOAL" as const } } }
          : {})
    },
    // Conta dedicada a outra loja não aparece; contas compartilhadas e evidências sem conexão aparecem.
    NOT: { contaExterna: { conexoes: { some: { escopo: "STORE_DEDICATED" as const, lojaPermitidaId: { notIn: allowedStores } } } } }
  };
  const candidates = await prisma.buyerPurchaseCandidate.findMany({
    where,
    include: { currentEvidence: true, contaExterna: { include: { conexoes: { include: { lojaPermitida: true } } } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: LOAD_LIMIT
  });
  const parsed = candidates.flatMap((candidate) => {
    const order = normalizedMarketplaceOrderSchema.safeParse(candidate.currentEvidence.normalizedPayload);
    return order.success ? [{ candidate, order: order.data }] : [];
  });

  // Compra confirmada de conta compartilhada: a loja é a das atribuições dos itens (uma só); pode ser trocada até virar estoque.
  const purchaseIds = parsed.map(({ candidate }) => candidate.compraImportadaId).filter((id): id is string => Boolean(id));
  const [assignments, materialized, stages] = purchaseIds.length
    ? await Promise.all([
        prisma.atribuicaoCompraItem.findMany({ where: { itemExterno: { compraImportadaId: { in: purchaseIds } } }, include: { loja: true, itemExterno: { select: { compraImportadaId: true } } } }),
        prisma.materializacaoCompra.findMany({ where: { compraImportadaId: { in: purchaseIds } }, select: { compraImportadaId: true } }),
        prisma.etapaCompra.findMany({ where: { compraImportadaId: { in: purchaseIds } } })
      ])
    : [[], [], []];
  const stageByPurchase = new Map(stages.map((stage) => [stage.compraImportadaId, stage]));
  const storesByPurchase = new Map<string, Map<string, { id: string; slug: string; nome: string }>>();
  for (const assignment of assignments) {
    const bucket = storesByPurchase.get(assignment.itemExterno.compraImportadaId) ?? new Map();
    bucket.set(assignment.loja.id, { id: assignment.loja.id, slug: assignment.loja.slug, nome: assignment.loja.nome });
    storesByPurchase.set(assignment.itemExterno.compraImportadaId, bucket);
  }
  const lockedPurchases = new Set(materialized.map((entry) => entry.compraImportadaId));

  return parsed.map(({ candidate, order }) => {
    const connection = candidate.contaExterna.conexoes[0];
    const assigned = candidate.compraImportadaId ? [...(storesByPurchase.get(candidate.compraImportadaId)?.values() ?? [])] : [];
    const dedicated = connection?.escopo === "STORE_DEDICATED" && connection.lojaPermitida
      ? { id: connection.lojaPermitida.id, slug: connection.lojaPermitida.slug, nome: connection.lojaPermitida.nome }
      : null;
    const shipments = order.shipments;
    const trackings = shipments.flatMap((shipment) => shipment.packages.flatMap((pack) => pack.trackings.map((tracking) => ({ carrier: tracking.carrier ?? pack.carrier ?? null, code: tracking.code }))));
    const stage = candidate.compraImportadaId ? (stageByPurchase.get(candidate.compraImportadaId) ?? null) : null;
    const phase: PurchasePhase = order.cancelled ? "CANCELADO" : stage ? stage.etapa : trackings.length ? "A_CAMINHO_MIAMI" : "COMPRADO";
    return {
      provider: candidate.provider,
      candidateId: candidate.id,
      version: candidate.version,
      status: candidate.status,
      fase: phase,
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
      etapa: stage
        ? { chegouMiamiEm: stage.chegouMiamiEm?.toISOString() ?? null, remessa: stage.remessa, enviadaEm: stage.enviadaEm?.toISOString() ?? null, chegouBrasilEm: stage.chegouBrasilEm?.toISOString() ?? null }
        : null,
      trackings,
      rawItems: order.items,
      canApprove: candidate.status === "AGUARDANDO_APROVACAO" && !candidate.compraImportadaId && can(identity, "BUYER_INGESTION_APROVAR")
    };
  });
}

function checkStore(identity: AuthIdentity, lojaId?: string) {
  if (lojaId && !identity.lojas.some((store) => store.id === lojaId)) throw new AppError(403, "marketplace_connection_store_mismatch");
}

/** Momento da última atualização com o marketplace entre as conexões que o usuário enxerga. */
async function lastUpdate(identity: AuthIdentity) {
  const stores = identity.lojas.map((store) => store.id);
  const connections = await prisma.conexaoMarketplace.findMany({
    where: { OR: [{ escopo: "SHARED" }, { escopo: "STORE_DEDICATED", lojaPermitidaId: { in: stores } }] },
    select: { ultimaSincronizacaoEm: true }
  });
  const times = connections.map((entry) => entry.ultimaSincronizacaoEm?.getTime()).filter((time): time is number => typeof time === "number");
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Lista de compras para a tela: uma linha por pedido, já com foto, itens, loja, rastreio, fase e status do eBay.
 * Filtros: loja (a do topo da tela), origem (loja/pessoal), situação, mês (AAAA-MM) e busca por produto, pedido ou rastreio.
 * Só leitura; confirmar continua pelo endpoint de decisão.
 */
export async function purchasesFeed(identity: AuthIdentity, input: z.infer<typeof feedQuerySchema>) {
  if (!can(identity, "BUYER_INGESTION_VISUALIZAR")) throw new AppError(403, "insufficient_permission");
  checkStore(identity, input.lojaId);
  const needle = input.busca?.toLowerCase();
  const filtered = (await loadRows(identity, input))
    .filter((row) => !input.lojaId || row.store?.id === input.lojaId)
    .filter((row) => !input.mes || monthOf(row.orderedAt) === input.mes)
    .filter((row) => !input.fases || input.fases.includes(row.fase))
    .filter((row) => !needle || row.orderId.toLowerCase().includes(needle) || row.rawItems.some((item) => item.title.toLowerCase().includes(needle)) || row.trackings.some((tracking) => tracking.code.toLowerCase().includes(needle)))
    .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  const page = filtered.slice((input.page - 1) * input.limit, input.page * input.limit);
  const images = new Map<string, Map<string, string>>();
  for (const provider of new Set(page.map((row) => row.provider)))
    images.set(
      provider,
      await itemImages(provider, page.filter((row) => row.provider === provider).flatMap((row) => row.rawItems.map((item) => item.offerId).filter((id): id is string => Boolean(id))))
    );
  const items = page.map(({ rawItems, provider, ...row }) => ({
    ...row,
    items: rawItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      cancelledQuantity: item.cancelledQuantity,
      unitPrice: item.unitPrice,
      currency: item.currency,
      imageUrl: (item.offerId && images.get(provider)?.get(item.offerId)) || null
    }))
  }));
  return { items, page: input.page, limit: input.limit, total: filtered.length, atualizadoEm: await lastUpdate(identity) };
}

/** Lotes de compra por mês do pedido (fuso de São Paulo): o resumo que abre a tela de Compras. */
export async function purchaseLots(identity: AuthIdentity, input: z.infer<typeof lotsQuerySchema>) {
  if (!can(identity, "BUYER_INGESTION_VISUALIZAR")) throw new AppError(403, "insufficient_permission");
  checkStore(identity, input.lojaId);
  const lots = new Map<string, { mes: string; pedidos: number; unidades: number; custoUsd: number; cancelados: number; aConfirmar: number; semLoja: number; porLoja: Record<string, number> }>();
  const all = await loadRows(identity, input);
  for (const row of all.filter((entry) => !input.lojaId || entry.store?.id === input.lojaId)) {
    const mes = monthOf(row.orderedAt);
    const lot = lots.get(mes) ?? { mes, pedidos: 0, unidades: 0, custoUsd: 0, cancelados: 0, aConfirmar: 0, semLoja: 0, porLoja: {} };
    lot.pedidos += 1;
    if (row.cancelled) lot.cancelados += 1;
    else {
      for (const item of row.rawItems) {
        const units = item.quantity - item.cancelledQuantity - item.refundedQuantity;
        lot.unidades += units;
        if (item.currency.toUpperCase() === "USD") lot.custoUsd += units * item.unitPrice;
      }
      if (row.status === "AGUARDANDO_APROVACAO") lot.aConfirmar += 1;
      if (row.status === "APROVADA" && !row.store) lot.semLoja += 1;
      if (row.store) lot.porLoja[row.store.slug] = (lot.porLoja[row.store.slug] ?? 0) + 1;
    }
    lots.set(mes, lot);
  }
  return {
    lotes: [...lots.values()].map((lot) => ({ ...lot, custoUsd: Math.round(lot.custoUsd * 100) / 100 })).sort((a, b) => b.mes.localeCompare(a.mes)),
    // Compras confirmadas sem loja somem do filtro de uma loja; o total avisa que existem (e que aparecem em "Todos").
    semLojaTotal: all.filter((row) => !row.cancelled && row.status === "APROVADA" && !row.store).length,
    atualizadoEm: await lastUpdate(identity)
  };
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
