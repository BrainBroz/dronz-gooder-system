import { createHash, randomUUID } from "node:crypto";
import { reconciliationScore } from "./reconciliation-score";
import {
  Prisma,
  type ConexaoMarketplace,
  type MarketplaceProvider
} from "@prisma/client";
import type { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";
import {
  createImportedPurchase,
  type ImportInput
} from "../unified-purchases/unified-purchases.service";
import {
  marketplaceAdapterRegistry,
  translateMarketplaceAdapterError
} from "./marketplace-integrations.adapters";
import { hasDuplicateOfficialLineId, isStructuredApiSource, recordMarketplaceEvidence } from "./buyer-evidence.service";
import {
  capabilitySchema,
  marketplaceOrderPageSchema,
  normalizedMarketplaceOrderSchema
} from "./marketplace-integrations.schemas";
import type {
  buyerEvidenceIntakeSchema,
  buyerCandidateListSchema,
  buyerDecisionSchema,
  createConnectionSchema,
  listConnectionsSchema,
  syncConnectionSchema
} from "./marketplace-integrations.schemas";
import type {
  BuyerCandidateReadModel,
  BuyerConflictReadModel,
  BuyerEvidenceDetailReadModel,
  MarketplaceAdapterRegistry,
  MarketplaceBlockedReason,
  MarketplaceConnectionReadModel,
  MarketplaceOrderPage,
  NormalizedMarketplaceOrder
} from "./marketplace-integrations.types";

type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
type ListConnectionsInput = z.infer<typeof listConnectionsSchema>;
type SyncConnectionInput = z.infer<typeof syncConnectionSchema>;
type BuyerCandidateListInput = z.infer<typeof buyerCandidateListSchema>;
type BuyerDecisionInput = z.infer<typeof buyerDecisionSchema>;

const GLOBAL_SCOPE = "GLOBAL_MARKETPLACE_INTEGRATIONS";
const ORIGIN = "API_MARKETPLACE_INTEGRATIONS";
const platformForProvider = (provider: MarketplaceProvider) => provider;
const normalizeExternalId = (value: string) => value.trim().normalize("NFC");
const hash = (value: object) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const grantedPermissions = (identity: AuthIdentity) =>
  new Set(identity.permissoes.map((permission) => permission.code));
const hasPermission = (identity: AuthIdentity, permission: string) => {
  const granted = grantedPermissions(identity);
  return granted.has("SYSTEM_ADMIN") || granted.has(permission);
};
const hasStore = (identity: AuthIdentity, storeId: string) =>
  identity.lojas.some((store) => store.id === storeId);

type ConnectionWithRelations = Prisma.ConexaoMarketplaceGetPayload<{
  include: {
    contaExterna: true;
    lojaPermitida: true;
  };
}>;

function connectionBlockedReasons(
  connection: ConnectionWithRelations
): MarketplaceBlockedReason[] {
  const reasons: MarketplaceBlockedReason[] = [];
  if (connection.status === "NOT_CONFIGURED")
    reasons.push({
      code: "NOT_CONFIGURED",
      message: "A conexão ainda não possui autorização externa configurada."
    });
  if (connection.status === "INACTIVE")
    reasons.push({
      code: "CONNECTION_INACTIVE",
      message: "A conexão está inativa."
    });
  if (connection.status === "AUTHORIZATION_EXPIRED")
    reasons.push({
      code: "AUTHORIZATION_EXPIRED",
      message: "A autorização externa expirou."
    });
  if (connection.capabilities.length === 0)
    reasons.push({
      code: "PROVIDER_ACCESS_UNAVAILABLE",
      message: "O adapter real do provider ainda não está habilitado."
    });
  return reasons;
}

function connectionReadModel(
  identity: AuthIdentity,
  connection: ConnectionWithRelations
): MarketplaceConnectionReadModel {
  const blockedReasons = connectionBlockedReasons(connection);
  const allowedActions: MarketplaceConnectionReadModel["allowedActions"] = [
    "VIEW_CONNECTION"
  ];
  if (hasPermission(identity, "INTEGRACAO_MARKETPLACE_GERENCIAR"))
    allowedActions.push("MANAGE_CONNECTION");
  if (hasPermission(identity, "INTEGRACAO_MARKETPLACE_HISTORICO_VISUALIZAR"))
    allowedActions.push("VIEW_SYNC_HISTORY");
  if (
    hasPermission(identity, "INTEGRACAO_MARKETPLACE_SINCRONIZAR") &&
    connection.status === "ACTIVE" &&
    blockedReasons.length === 0
  )
    allowedActions.push("SYNC_CONNECTION");
  if (
    hasPermission(identity, "INTEGRACAO_MARKETPLACE_REPROCESSAR") &&
    connection.status === "ACTIVE" &&
    blockedReasons.length === 0
  )
    allowedActions.push("REPROCESS_SYNC");
  return {
    id: connection.id,
    provider: connection.provider,
    account: {
      id: connection.contaExterna.id,
      name: connection.contaExterna.nomeExibicao,
      externalIdentifier: connection.contaExterna.identificadorExterno
    },
    name: connection.nome,
    externalIdentifier: connection.identificadorExterno,
    region: connection.regiao,
    marketplace: connection.marketplace,
    scope: connection.escopo,
    allowedStore: connection.lojaPermitida
      ? {
          id: connection.lojaPermitida.id,
          slug: connection.lojaPermitida.slug,
          name: connection.lojaPermitida.nome
        }
      : null,
    status: connection.status,
    secretConfigured: Boolean(connection.secretReference),
    capabilities: capabilitySchema.array().parse(connection.capabilities),
    authorizedAt: connection.autorizadoEm?.toISOString() ?? null,
    authorizationExpiresAt:
      connection.autorizacaoExpiraEm?.toISOString() ?? null,
    lastSyncAt: connection.ultimaSincronizacaoEm?.toISOString() ?? null,
    lastError: connection.ultimoErroSanitizado,
    version: connection.version,
    allowedActions,
    blockedReasons
  };
}

function assertConnectionScope(
  identity: AuthIdentity,
  connection: { escopo: string; lojaPermitidaId: string | null }
) {
  if (
    connection.escopo === "STORE_DEDICATED" &&
    (!connection.lojaPermitidaId ||
      !hasStore(identity, connection.lojaPermitidaId))
  )
    throw new AppError(403, "marketplace_connection_store_mismatch");
}

export async function createConnection(
  identity: AuthIdentity,
  input: CreateConnectionInput,
  key?: string,
  registry: MarketplaceAdapterRegistry = marketplaceAdapterRegistry
) {
  if (input.lojaPermitidaId && !hasStore(identity, input.lojaPermitidaId))
    throw new AppError(403, "marketplace_connection_store_mismatch");
  const identifier = normalizeExternalId(input.identificadorExterno);
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "CREATE_MARKETPLACE_CONNECTION",
    entityId: `${input.provider}:${identifier}`,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const account = await tx.contaExterna.findUnique({
        where: { id: input.contaExternaId }
      });
      if (
        !account ||
        account.status !== "ATIVA" ||
        account.plataforma !== platformForProvider(input.provider)
      )
        throw new AppError(400, "invalid_external_account");
      const existing = await tx.conexaoMarketplace.findFirst({
        where: {
          OR: [
            { contaExternaId: input.contaExternaId },
            { provider: input.provider, identificadorExterno: identifier }
          ]
        }
      });
      if (existing) throw new AppError(409, "marketplace_connection_exists");
      const connection = await tx.conexaoMarketplace.create({
        data: {
          provider: input.provider,
          contaExternaId: account.id,
          nome: input.nome,
          identificadorExterno: identifier,
          regiao: input.regiao,
          marketplace: input.marketplace,
          escopo: input.escopo,
          lojaPermitidaId: input.lojaPermitidaId,
          secretReference: input.secretReference,
          status: "NOT_CONFIGURED",
          capabilities: [...registry[input.provider].capabilities],
          criadoPorId: identity.user.id
        },
        include: { contaExterna: true, lojaPermitida: true }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId: connection.lojaPermitidaId ?? undefined,
        permissionCode: "INTEGRACAO_MARKETPLACE_GERENCIAR",
        action: "MARKETPLACE_CONNECTION_CREATED",
        entity: "ConexaoMarketplace",
        entityId: connection.id,
        correlationId,
        idempotencyKey: key,
        after: {
          id: connection.id,
          provider: connection.provider,
          scope: connection.escopo,
          storeId: connection.lojaPermitidaId,
          secretConfigured: Boolean(connection.secretReference)
        },
        origin: ORIGIN
      });
      return connectionReadModel(identity, connection);
    }
  });
}

export async function listConnections(
  identity: AuthIdentity,
  input: ListConnectionsInput
) {
  const allowedStoreIds = identity.lojas.map((store) => store.id);
  // O lojaId do cliente nunca é confiado sozinho: se informado, precisa ser
  // uma loja da própria identidade — nunca uma checagem implícita.
  if (input.lojaId && !allowedStoreIds.includes(input.lojaId))
    throw new AppError(403, "marketplace_connection_store_mismatch");

  // SHARED é staging global (AGENTS.md: "não usa lojaId como tenant, exige
  // RBAC global") — quem tem permissão para listar conexões enxerga SHARED
  // independentemente de lojaId, inclusive quando o filtro está presente.
  // Só a metade STORE_DEDICATED do OR respeita o filtro de loja; nunca a
  // colocamos como filtro de nível superior (isso é o que fazia o Prisma
  // excluir SHARED, já que lojaPermitidaId é null nessas conexões).
  const storeDedicatedFilter = input.lojaId
    ? { escopo: "STORE_DEDICATED" as const, lojaPermitidaId: input.lojaId }
    : {
        escopo: "STORE_DEDICATED" as const,
        lojaPermitidaId: { in: allowedStoreIds }
      };

  const connections = await prisma.conexaoMarketplace.findMany({
    where: {
      provider: input.provider,
      status: input.status,
      escopo: input.escopo,
      OR: [{ escopo: "SHARED" as const }, storeDedicatedFilter]
    },
    include: { contaExterna: true, lojaPermitida: true },
    orderBy: [{ provider: "asc" }, { nome: "asc" }, { id: "asc" }]
  });
  return connections.map((connection) =>
    connectionReadModel(identity, connection)
  );
}

async function findConnection(identity: AuthIdentity, id: string) {
  const connection = await prisma.conexaoMarketplace.findUnique({
    where: { id },
    include: { contaExterna: true, lojaPermitida: true }
  });
  if (!connection) throw new AppError(404, "not_found");
  assertConnectionScope(identity, connection);
  return connection;
}

export async function connectionDetail(identity: AuthIdentity, id: string) {
  return connectionReadModel(identity, await findConnection(identity, id));
}

export async function syncHistory(
  identity: AuthIdentity,
  connectionId: string,
  page: number,
  limit: number
) {
  await findConnection(identity, connectionId);
  const [items, total] = await Promise.all([
    prisma.execucaoSincronizacao.findMany({
      where: { conexaoId: connectionId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        status: true,
        origem: true,
        cursorInicial: true,
        cursorFinal: true,
        janelaInicio: true,
        janelaFim: true,
        processados: true,
        criados: true,
        atualizados: true,
        ignorados: true,
        conflitos: true,
        falhas: true,
        correlationId: true,
        erroSanitizado: true,
        iniciadoEm: true,
        finalizadoEm: true,
        createdAt: true
      }
    }),
    prisma.execucaoSincronizacao.count({ where: { conexaoId: connectionId } })
  ]);
  return { items, page, limit, total };
}

const candidateInclude = {
  contaExterna: true,
  currentEvidence: true,
  evidenceLinks: { where: { type: { not: "REJECTED" } }, select: { evidence: { select: { source: true } } } },
  conflicts: { where: { status: "ABERTO" }, select: { type: true } }
} satisfies Prisma.BuyerPurchaseCandidateInclude;
type CandidateWithCurrent = Prisma.BuyerPurchaseCandidateGetPayload<{ include: typeof candidateInclude }>;

function candidateReadModel(
  identity: AuthIdentity,
  candidate: CandidateWithCurrent
): BuyerCandidateReadModel {
  const order = normalizedMarketplaceOrderSchema.parse(candidate.currentEvidence.normalizedPayload);
  const duplicateLineId = hasDuplicateOfficialLineId(order);
  const blockedReasons: BuyerCandidateReadModel["blockedReasons"] = [];
  if (candidate.compraImportadaId && candidate.status !== "APROVADA")
    blockedReasons.push(candidate.status === "COM_DIVERGENCIA"
      ? "NEW_EVIDENCE_REQUIRES_RECONCILIATION"
      : "LEGACY_PURCHASE_REQUIRES_REVIEW");
  else if (candidate.status === "CANCELADA") blockedReasons.push("CANCELLED");
  else if (candidate.status === "COM_DIVERGENCIA")
    blockedReasons.push("MATERIAL_DIVERGENCE");
  else if (candidate.status !== "AGUARDANDO_APROVACAO")
    blockedReasons.push("ALREADY_DECIDED");
  if (duplicateLineId) blockedReasons.push("DUPLICATE_EXTERNAL_LINE_ID");
  const allowedActions: BuyerCandidateReadModel["allowedActions"] = ["VIEW"];
  if (!candidate.compraImportadaId &&
      ["AGUARDANDO_APROVACAO", "COM_DIVERGENCIA"].includes(candidate.status)) {
    if (candidate.status === "AGUARDANDO_APROVACAO" && !duplicateLineId &&
        hasPermission(identity, "BUYER_INGESTION_APROVAR"))
      allowedActions.push("APPROVE");
    if (hasPermission(identity, "BUYER_INGESTION_REJEITAR"))
      allowedActions.push("REJECT");
  }
  if (candidate.conflicts.length && hasPermission(identity, "BUYER_INGESTION_APROVAR"))
    allowedActions.push("RESOLVE_CONFLICT");
  return {
    id: candidate.id,
    provider: candidate.provider,
    account: {
      id: candidate.contaExterna.id,
      name: candidate.contaExterna.nomeExibicao
    },
    externalOrderId: candidate.externalOrderIdNormalized,
    status: candidate.status,
    version: candidate.version,
    purchaseId: candidate.compraImportadaId,
    order,
    currentEvidence: {
      id: candidate.currentEvidence.id,
      version: candidate.currentEvidence.version,
      source: candidate.currentEvidence.source,
      recordedAt: candidate.currentEvidence.createdAt.toISOString()
    },
    allowedActions,
    blockedReasons,
    confianca: reconciliationScore({
      order,
      hasStrongIdentity: !!candidate.externalOrderIdNormalized && !!candidate.contaExternaId,
      sources: candidate.evidenceLinks.map((link) => link.evidence.source),
      openConflicts: candidate.conflicts.map((conflict) => conflict.type)
    })
  };
}

export async function listBuyerCandidates(
  identity: AuthIdentity,
  input: BuyerCandidateListInput
) {
  if (!hasPermission(identity, "BUYER_INGESTION_VISUALIZAR"))
    throw new AppError(403, "insufficient_permission");
  const where = { status: input.status };
  return prisma.$transaction(async (tx) => {
    const [items, total] = await Promise.all([
      tx.buyerPurchaseCandidate.findMany({
        where,
        include: candidateInclude,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      tx.buyerPurchaseCandidate.count({ where })
    ]);
    await audit(tx, {
      usuarioId: identity.user.id,
      permissionCode: "BUYER_INGESTION_VISUALIZAR",
      action: "BUYER_CANDIDATES_LISTED",
      entity: "BuyerPurchaseCandidate",
      entityId: "LIST",
      correlationId: randomUUID(),
      after: { status: input.status ?? null, page: input.page, limit: input.limit, total },
      origin: ORIGIN
    });
    return {
      items: items.map((candidate) => candidateReadModel(identity, candidate)),
      page: input.page,
      limit: input.limit,
      total
    };
  });
}

export async function buyerCandidateDetail(identity: AuthIdentity, id: string) {
  if (!hasPermission(identity, "BUYER_INGESTION_VISUALIZAR"))
    throw new AppError(403, "insufficient_permission");
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.buyerPurchaseCandidate.findUnique({
      where: { id },
      include: {
        ...candidateInclude,
        decisions: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!candidate) throw new AppError(404, "not_found");
    await audit(tx, {
      usuarioId: identity.user.id,
      permissionCode: "BUYER_INGESTION_VISUALIZAR",
      action: "BUYER_CANDIDATE_VIEWED",
      entity: "BuyerPurchaseCandidate",
      entityId: id,
      correlationId: randomUUID(),
      after: { currentEvidenceId: candidate.currentEvidenceId, version: candidate.version },
      origin: ORIGIN
    });
    const links = await tx.buyerEvidenceLink.findMany({
      where: { candidateId: id },
      include: { evidence: true },
      orderBy: { evidence: { createdAt: "desc" } }
    });
    return {
      ...candidateReadModel(identity, candidate),
      evidenceVersions: links.map((link) => ({
        id: link.evidence.id,
        version: link.evidence.version,
        source: link.evidence.source,
        type: link.type,
        payloadHash: link.evidence.payloadHash,
        sourceOccurredAt: link.evidence.sourceOccurredAt.toISOString(),
        recordedAt: link.evidence.createdAt.toISOString()
      })),
      decisions: candidate.decisions.map((decision) => ({
        id: decision.id,
        decision: decision.decision,
        candidateVersion: decision.candidateVersion,
        evidenceId: decision.evidenceId,
        actorId: decision.actorId,
        reason: decision.reason,
        decidedAt: decision.createdAt.toISOString()
      }))
    };
  });
}

export async function buyerCandidateEvidenceDetail(
  identity: AuthIdentity,
  candidateId: string,
  evidenceId: string
): Promise<BuyerEvidenceDetailReadModel> {
  if (!hasPermission(identity, "BUYER_INGESTION_VISUALIZAR"))
    throw new AppError(403, "insufficient_permission");
  return prisma.$transaction(async (tx) => {
    const link = await tx.buyerEvidenceLink.findUnique({
      where: { candidateId_evidenceId: { candidateId, evidenceId } },
      include: { evidence: true }
    });
    if (!link) throw new AppError(404, "not_found");
    const result: BuyerEvidenceDetailReadModel = {
      candidateId,
      evidenceId,
      version: link.evidence.version,
      source: link.evidence.source,
      type: link.type,
      dataClassification: link.evidence.dataClassification,
      payloadHash: link.evidence.payloadHash,
      correlationId: link.evidence.correlationId,
      sourceOccurredAt: link.evidence.sourceOccurredAt.toISOString(),
      recordedAt: link.evidence.createdAt.toISOString(),
      order: normalizedMarketplaceOrderSchema.parse(link.evidence.normalizedPayload)
    };
    await audit(tx, {
      usuarioId: identity.user.id,
      permissionCode: "BUYER_INGESTION_VISUALIZAR",
      action: "BUYER_EVIDENCE_VIEWED",
      entity: "BuyerEvidence",
      entityId: evidenceId,
      correlationId: randomUUID(),
      after: { candidateId, evidenceVersion: link.evidence.version },
      origin: ORIGIN
    });
    return result;
  });
}

export async function buyerCandidateConflicts(
  identity: AuthIdentity,
  candidateId: string,
  input: { page: number; limit: number }
) {
  if (!hasPermission(identity, "BUYER_INGESTION_VISUALIZAR"))
    throw new AppError(403, "insufficient_permission");
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.buyerPurchaseCandidate.findUnique({
      where: { id: candidateId }, select: { id: true }
    });
    if (!candidate) throw new AppError(404, "not_found");
    const [conflicts, total] = await Promise.all([
      tx.buyerReconciliationConflict.findMany({
        where: { candidateId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      tx.buyerReconciliationConflict.count({ where: { candidateId } })
    ]);
    await audit(tx, {
      usuarioId: identity.user.id,
      permissionCode: "BUYER_INGESTION_VISUALIZAR",
      action: "BUYER_CONFLICTS_LISTED",
      entity: "BuyerPurchaseCandidate",
      entityId: candidateId,
      correlationId: randomUUID(),
      after: { page: input.page, limit: input.limit, total },
      origin: ORIGIN
    });
    const items: BuyerConflictReadModel[] = conflicts.map((conflict) => ({
      id: conflict.id,
      type: conflict.type,
      status: conflict.status,
      referenceEvidenceId: conflict.referenceEvidenceId,
      evidenceId: conflict.evidenceId,
      createdAt: conflict.createdAt.toISOString(),
      resolucao: conflict.resolucao,
      motivoResolucao: conflict.motivoResolucao,
      resolvidoEm: conflict.resolvidoEm?.toISOString() ?? null
    }));
    return { items, page: input.page, limit: input.limit, total };
  });
}

async function merchantForApproval(
  tx: Prisma.TransactionClient,
  provider: MarketplaceProvider,
  merchant: NormalizedMarketplaceOrder["merchant"],
  actorId: string,
  correlationId: string,
  key: string
) {
  if (!merchant) return undefined;
  const externalId = merchant.externalMerchantId
    ? normalizeExternalId(merchant.externalMerchantId)
    : null;
  const normalizedName = merchant.name.trim().replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
  const existing = externalId
    ? await tx.merchantExterno.findUnique({
        where: {
          plataforma_externalMerchantId: {
            plataforma: provider,
            externalMerchantId: externalId
          }
        }
      })
    : await tx.merchantExterno.findFirst({
        where: {
          plataforma: provider,
          externalMerchantId: null,
          nomeNormalizado: normalizedName
        }
      });
  if (existing) return existing.id;
  const created = await tx.merchantExterno.create({
    data: {
      plataforma: provider,
      externalMerchantId: externalId,
      nomeOriginal: merchant.name,
      nomeNormalizado: normalizedName,
      metadata: { source: "BUYER_APPROVAL" }
    }
  });
  await audit(tx, {
    usuarioId: actorId,
    permissionCode: "BUYER_INGESTION_APROVAR",
    action: "BUYER_MERCHANT_CREATED",
    entity: "MerchantExterno",
    entityId: created.id,
    correlationId,
    idempotencyKey: key,
    after: { provider, externalId, name: merchant.name },
    origin: ORIGIN
  });
  return created.id;
}

export async function decideBuyerCandidate(
  identity: AuthIdentity,
  id: string,
  input: BuyerDecisionInput,
  key: string
) {
  const permission = input.decision === "APROVAR"
    ? "BUYER_INGESTION_APROVAR" : "BUYER_INGESTION_REJEITAR";
  if (!hasPermission(identity, permission))
    throw new AppError(403, "insufficient_permission");
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "DECIDE_BUYER_CANDIDATE",
    entityId: id,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const target = await tx.buyerPurchaseCandidate.findUnique({
        where: { id }, select: { contaExternaId: true }
      });
      if (!target) throw new AppError(404, "not_found");
      await tx.$queryRaw`SELECT id FROM "ContaExterna" WHERE id = ${target.contaExternaId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "BuyerPurchaseCandidate" WHERE id = ${id} FOR UPDATE`;
      const candidate = await tx.buyerPurchaseCandidate.findUniqueOrThrow({
        where: { id },
        include: { contaExterna: true, currentEvidence: true }
      });
      if (candidate.version !== input.expectedVersion)
        throw new AppError(409, "concurrent_modification");
      if (candidate.compraImportadaId)
        throw new AppError(409, "legacy_purchase_requires_review");
      if (candidate.status !== "AGUARDANDO_APROVACAO" &&
          !(input.decision === "REJEITAR" && candidate.status === "COM_DIVERGENCIA"))
        throw new AppError(409, "buyer_candidate_not_reviewable");

      let purchaseId: string | null = null;
      if (input.decision === "APROVAR") {
        const order = normalizedMarketplaceOrderSchema.parse(
          candidate.currentEvidence.normalizedPayload
        );
        if (hasDuplicateOfficialLineId(order))
          throw new AppError(409, "buyer_duplicate_external_line_id");
        if (order.items.some((item) =>
          item.currency.toUpperCase() !== order.currency.toUpperCase()))
          throw new AppError(409, "buyer_currency_mismatch");
        if (order.cancelled) throw new AppError(409, "buyer_candidate_cancelled");
        const legacy = await tx.compraImportada.findUnique({
          where: {
            plataforma_contaExternaId_externalOrderIdNormalizado: {
              plataforma: candidate.provider,
              contaExternaId: candidate.contaExternaId,
              externalOrderIdNormalizado: candidate.externalOrderIdNormalized
            }
          },
          select: { id: true }
        });
        if (legacy) throw new AppError(409, "legacy_purchase_requires_review");
        const merchantId = await merchantForApproval(
          tx, candidate.provider, order.merchant, identity.user.id,
          correlationId, key
        );
        const importInput: ImportInput = {
          plataforma: candidate.provider,
          contaExternaId: candidate.contaExternaId,
          merchantExternoId: merchantId,
          externalOrderId: order.externalOrderId,
          referencia: order.reference,
          dataPedido: new Date(order.orderedAt),
          moeda: order.currency.toUpperCase(),
          statusExterno: order.externalStatus,
          totalExterno: order.total,
          // Evidência de e-mail, documento ou registro manual entra como importação, não como API.
          origem: isStructuredApiSource(candidate.currentEvidence.source) ? "API" : "IMPORTACAO_ARQUIVO",
          itens: order.items.map((item) => ({
            externalLineId: item.externalLineId,
            titulo: item.title,
            variacao: item.variation,
            sku: item.sku,
            asin: item.asin,
            identificadorOferta: item.offerId,
            quantidade: item.quantity,
            quantidadeCancelada: item.cancelledQuantity,
            quantidadeReembolsada: item.refundedQuantity,
            precoUnitario: item.unitPrice,
            moeda: item.currency.toUpperCase(),
            merchantExternoId: merchantId,
            snapshot: { sourceUpdatedAt: order.updatedAt }
          })),
          snapshot: {
            sourceUpdatedAt: order.updatedAt,
            cancelled: order.cancelled,
            approvedEvidenceId: candidate.currentEvidenceId
          }
        };
        const imported = await createImportedPurchase(tx, importInput);
        if (imported.replay)
          throw new AppError(409, "legacy_purchase_requires_review");
        purchaseId = imported.purchase.id;
        await tx.compraImportada.update({
          where: { id: purchaseId },
          data: { conexaoMarketplaceId: candidate.currentEvidence.conexaoMarketplaceId }
        });
        await persistShippingData(tx, purchaseId, order);
      }
      const decided = await tx.buyerPurchaseCandidate.update({
        where: { id },
        data: {
          status: input.decision === "APROVAR" ? "APROVADA" : "REJEITADA",
          compraImportadaId: purchaseId,
          version: { increment: 1 }
        },
        include: candidateInclude
      });
      const decision = await tx.buyerApprovalDecision.create({
        data: {
          candidateId: id,
          evidenceId: candidate.currentEvidenceId,
          candidateVersion: candidate.version,
          decision: input.decision,
          actorId: identity.user.id,
          reason: input.reason,
          correlationId,
          idempotencyKey: key
        }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: permission,
        action: input.decision === "APROVAR"
          ? "BUYER_CANDIDATE_APPROVED" : "BUYER_CANDIDATE_REJECTED",
        entity: "BuyerPurchaseCandidate",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        reason: input.reason,
        before: { status: candidate.status, version: candidate.version },
        after: {
          status: decided.status,
          version: decided.version,
          evidenceId: candidate.currentEvidenceId,
          purchaseId
        },
        origin: ORIGIN
      });
      return { ...candidateReadModel(identity, decided), decisionId: decision.id };
    }
  });
}

async function persistShippingData(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  order: NormalizedMarketplaceOrder
) {
      for (const shipment of order.shipments) {
        const savedShipment = await tx.envioExterno.upsert({
          where: {
            compraImportadaId_externalShipmentId: {
              compraImportadaId: purchaseId,
              externalShipmentId: normalizeExternalId(
                shipment.externalShipmentId
              )
            }
          },
          update: {
            statusExterno: shipment.status,
            enviadoEm: shipment.shippedAt ? new Date(shipment.shippedAt) : null,
            ultimaAtualizacaoEm: new Date(shipment.updatedAt)
          },
          create: {
            compraImportadaId: purchaseId,
            externalShipmentId: normalizeExternalId(
              shipment.externalShipmentId
            ),
            statusExterno: shipment.status,
            enviadoEm: shipment.shippedAt ? new Date(shipment.shippedAt) : null,
            ultimaAtualizacaoEm: new Date(shipment.updatedAt)
          }
        });
        for (const externalPackage of shipment.packages) {
          const savedPackage = await tx.pacoteExterno.upsert({
            where: {
              envioExternoId_externalPackageId: {
                envioExternoId: savedShipment.id,
                externalPackageId: normalizeExternalId(
                  externalPackage.externalPackageId
                )
              }
            },
            update: { transportadora: externalPackage.carrier },
            create: {
              envioExternoId: savedShipment.id,
              externalPackageId: normalizeExternalId(
                externalPackage.externalPackageId
              ),
              transportadora: externalPackage.carrier
            }
          });
          // Passo 1: garante que toda linha de tracking citada por `code`
          // neste payload existe e tem status/timestamp atuais. Nunca toca
          // `ativo`/`substituiTrackingId` de uma linha já existente aqui —
          // isso só é resolvido no passo 2, depois que todos os códigos
          // deste payload já existem no banco. Assim a ordem de chegada
          // dentro do array nunca decide o resultado.
          //
          // A comparação de `ultimaAtualizacaoEm` torna o passo idempotente
          // e protege contra payload atrasado: um evento mais antigo (ou
          // igual) do que o já gravado nunca regride status/timestamp.
          const rowIdByCode = new Map<string, string>();
          for (const tracking of externalPackage.trackings) {
            const normalizedCode = normalizeExternalId(tracking.code);
            const updatedAt = new Date(tracking.updatedAt);
            const existing = await tx.trackingExterno.findFirst({
              where: {
                pacoteExternoId: savedPackage.id,
                codigo: normalizedCode,
                transportadora: tracking.carrier ?? null
              }
            });

            if (existing) {
              if (existing.ultimaAtualizacaoEm < updatedAt) {
                await tx.trackingExterno.update({
                  where: { id: existing.id },
                  data: {
                    statusExterno: tracking.status,
                    ultimaAtualizacaoEm: updatedAt
                  }
                });
              }
              rowIdByCode.set(normalizedCode, existing.id);
            } else {
              const created = await tx.trackingExterno.create({
                data: {
                  pacoteExternoId: savedPackage.id,
                  codigo: normalizedCode,
                  transportadora: tracking.carrier,
                  statusExterno: tracking.status,
                  ativo: true,
                  ultimaAtualizacaoEm: updatedAt,
                  criadoExternamenteEm: tracking.createdAt
                    ? new Date(tracking.createdAt)
                    : null
                }
              });
              rowIdByCode.set(normalizedCode, created.id);
            }
          }

          // Passo 2: resolve as relações de substituição. Todo código citado
          // no payload já existe (passo 1), então a ordem original do array
          // não afeta o resultado. Só desativa o código antigo — nunca
          // reativa nada — e registra a linhagem no código novo.
          for (const tracking of externalPackage.trackings) {
            if (!tracking.replacesCode) continue;
            const normalizedCode = normalizeExternalId(tracking.code);
            const newRowId = rowIdByCode.get(normalizedCode);
            if (!newRowId) continue;
            const oldCode = normalizeExternalId(tracking.replacesCode);
            const oldRow = await tx.trackingExterno.findFirst({
              where: { pacoteExternoId: savedPackage.id, codigo: oldCode }
            });
            if (!oldRow || oldRow.id === newRowId) continue;
            if (oldRow.ativo) {
              await tx.trackingExterno.update({
                where: { id: oldRow.id },
                data: { ativo: false }
              });
            }
            await tx.trackingExterno.update({
              where: { id: newRowId },
              data: { substituiTrackingId: oldRow.id }
            });
          }
        }
      }
}

async function importNormalizedOrder(
  identity: AuthIdentity,
  connection: ConnectionWithRelations,
  order: NormalizedMarketplaceOrder,
  correlationId: string,
  idempotencyKey: string
) {
  const evidence = await recordMarketplaceEvidence({
    provider: connection.provider,
    accountId: connection.contaExternaId,
    connectionId: connection.id,
    order,
    actorId: identity.user.id,
    correlationId,
    idempotencyKey
  });
  return { created: evidence.created };
}

function sanitizeProviderError(error: unknown) {
  if (error instanceof AppError) return error.code;
  return "external_provider_error";
}

async function executePages(
  identity: AuthIdentity,
  connection: ConnectionWithRelations,
  executionId: string,
  correlationId: string,
  idempotencyKey: string,
  input: SyncConnectionInput,
  registry: MarketplaceAdapterRegistry
) {
  const adapter = registry[connection.provider];
  let cursor = input.replay
    ? undefined
    : (connection.cursorSincronizacao ?? undefined);
  let lastCursor = cursor;
  let pageCount = 0;
  const counts = {
    processed: 0,
    created: 0,
    updated: 0,
    ignored: 0,
    conflicts: 0,
    failures: 0
  };
  let page: MarketplaceOrderPage;
  do {
    try {
      const rawPage = await adapter.listOrders(
        {
          id: connection.id,
          provider: connection.provider,
          externalIdentifier: connection.identificadorExterno,
          region: connection.regiao ?? undefined,
          marketplace: connection.marketplace ?? undefined,
          cursor,
          secretReference: connection.secretReference ?? undefined
        },
        { cursor, from: input.from, to: input.to }
      );
      const parsed = marketplaceOrderPageSchema.safeParse(rawPage);
      if (!parsed.success)
        throw new AppError(502, "invalid_marketplace_response");
      page = parsed.data;
    } catch (error) {
      throw translateMarketplaceAdapterError(error);
    }
    let pageFailed = false;
    for (const order of page.orders) {
      counts.processed += 1;
      try {
        let result: Awaited<ReturnType<typeof importNormalizedOrder>>;
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await importNormalizedOrder(
              identity, connection, order, correlationId, idempotencyKey
            );
            break;
          } catch (error) {
            if (attempt < 2 && error instanceof AppError &&
                error.code === "concurrent_modification") continue;
            throw error;
          }
        }
        if (result.created) counts.created += 1;
        else counts.updated += 1;
      } catch (error) {
        pageFailed = true;
        if (error instanceof AppError && error.status === 409)
          counts.conflicts += 1;
        else counts.failures += 1;
      }
    }
    if (pageFailed) return { counts, cursor: lastCursor };
    cursor = page.nextCursor;
    if (cursor) lastCursor = cursor;
    pageCount += 1;
    if (pageCount > 100)
      throw new AppError(409, "marketplace_pagination_limit_exceeded");
  } while (cursor);
  return { counts, cursor: lastCursor };
}

export async function syncConnection(
  identity: AuthIdentity,
  connectionId: string,
  input: SyncConnectionInput,
  idempotencyKey: string,
  registry: MarketplaceAdapterRegistry = marketplaceAdapterRegistry
) {
  const connection = await findConnection(identity, connectionId);
  if (connection.status !== "ACTIVE")
    throw new AppError(409, "marketplace_connection_not_ready");
  const requestHash = hash(input);
  const existing = await prisma.execucaoSincronizacao.findUnique({
    where: {
      conexaoId_idempotencyKey: { conexaoId: connectionId, idempotencyKey }
    }
  });
  if (existing) {
    if (existing.requestHash !== requestHash)
      throw new AppError(409, "idempotency_conflict");
    if (existing.status === "RUNNING")
      throw new AppError(409, "marketplace_sync_in_progress");
    return existing;
  }
  const correlationId = randomUUID();
  let execution: { id: string };
  try {
    execution = await prisma.$transaction(
      async (tx) => {
        const created = await tx.execucaoSincronizacao.create({
          data: {
            conexaoId: connection.id,
            status: "RUNNING",
            origem: input.replay ? "REPLAY" : "MANUAL",
            cursorInicial: input.replay ? null : connection.cursorSincronizacao,
            janelaInicio: input.from,
            janelaFim: input.to,
            correlationId,
            idempotencyKey,
            requestHash,
            iniciadoEm: new Date()
          }
        });
        await audit(tx, {
          usuarioId: identity.user.id,
          lojaId: connection.lojaPermitidaId ?? undefined,
          permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
          action: "MARKETPLACE_SYNC_STARTED",
          entity: "ExecucaoSincronizacao",
          entityId: created.id,
          correlationId,
          idempotencyKey,
          after: {
            connectionId: connection.id,
            provider: connection.provider,
            scope: connection.escopo
          },
          origin: ORIGIN
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new AppError(409, "marketplace_sync_in_progress");
    throw error;
  }
  try {
    const result = await executePages(
      identity,
      connection,
      execution.id,
      correlationId,
      idempotencyKey,
      input,
      registry
    );
    return await prisma.$transaction(
      async (tx) => {
        const status =
          result.counts.failures || result.counts.conflicts
            ? "PARTIALLY_SUCCEEDED"
            : "SUCCEEDED";
        const finished = await tx.execucaoSincronizacao.update({
          where: { id: execution.id },
          data: {
            status,
            cursorFinal: result.cursor,
            processados: result.counts.processed,
            criados: result.counts.created,
            atualizados: result.counts.updated,
            ignorados: result.counts.ignored,
            conflitos: result.counts.conflicts,
            falhas: result.counts.failures,
            finalizadoEm: new Date()
          }
        });
        await tx.conexaoMarketplace.update({
          where: { id: connection.id },
          data: {
            cursorSincronizacao: input.replay ? undefined : (result.cursor ?? null),
            ultimaSincronizacaoEm: new Date(),
            ultimoErroSanitizado: null,
            version: { increment: 1 }
          }
        });
        await tx.contaExterna.update({
          where: { id: connection.contaExternaId },
          data: {
            ultimaSincronizacaoEm: new Date(),
            ultimoErroSincronizacao: null
          }
        });
        await audit(tx, {
          usuarioId: identity.user.id,
          lojaId: connection.lojaPermitidaId ?? undefined,
          permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
          action: "MARKETPLACE_SYNC_FINISHED",
          entity: "ExecucaoSincronizacao",
          entityId: finished.id,
          correlationId,
          idempotencyKey,
          after: {
            status,
            processed: result.counts.processed,
            created: result.counts.created,
            updated: result.counts.updated,
            conflicts: result.counts.conflicts,
            failures: result.counts.failures
          },
          origin: ORIGIN
        });
        return finished;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    const errorCode = sanitizeProviderError(error);
    await prisma.$transaction(async (tx) => {
      await tx.execucaoSincronizacao.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          falhas: 1,
          erroSanitizado: errorCode,
          finalizadoEm: new Date()
        }
      });
      await tx.conexaoMarketplace.update({
        where: { id: connection.id },
        data: { ultimoErroSanitizado: errorCode }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId: connection.lojaPermitidaId ?? undefined,
        permissionCode: "INTEGRACAO_MARKETPLACE_SINCRONIZAR",
        action: "MARKETPLACE_SYNC_FAILED",
        entity: "ExecucaoSincronizacao",
        entityId: execution.id,
        correlationId,
        idempotencyKey,
        after: { error: errorCode },
        origin: ORIGIN
      });
    });
    throw error;
  }
}

export async function reprocessExecution(
  identity: AuthIdentity,
  executionId: string,
  idempotencyKey: string,
  registry: MarketplaceAdapterRegistry = marketplaceAdapterRegistry
) {
  const execution = await prisma.execucaoSincronizacao.findUnique({
    where: { id: executionId }
  });
  if (!execution) throw new AppError(404, "not_found");
  return syncConnection(
    identity,
    execution.conexaoId,
    {
      from: execution.janelaInicio ?? undefined,
      to: execution.janelaFim ?? undefined,
      replay: true
    },
    idempotencyKey,
    registry
  );
}

export function connectionAllowsStore(
  connection: Pick<ConexaoMarketplace, "escopo" | "lojaPermitidaId">,
  storeId: string
) {
  return (
    connection.escopo === "SHARED" || connection.lojaPermitidaId === storeId
  );
}

// X-01: o revisor escolhe qual evidência vale para o par em conflito; compra já aprovada só registra
// ciência, porque fato externo não reescreve decisão interna. Todos os conflitos do par são resolvidos juntos.
export async function resolveBuyerConflicts(
  identity: AuthIdentity,
  candidateId: string,
  input: { evidenceId: string; resolution: "ACEITAR_EVIDENCIA" | "MANTER_REFERENCIA" | "CIENTE"; reason: string; expectedVersion: number },
  key: string
) {
  if (!hasPermission(identity, "BUYER_INGESTION_APROVAR"))
    throw new AppError(403, "insufficient_permission");
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "RESOLVE_BUYER_CONFLICT",
    entityId: candidateId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "BuyerPurchaseCandidate" WHERE id = ${candidateId} FOR UPDATE`;
      const candidate = await tx.buyerPurchaseCandidate.findUnique({ where: { id: candidateId } });
      if (!candidate) throw new AppError(404, "not_found");
      if (candidate.version !== input.expectedVersion) throw new AppError(409, "concurrent_modification");
      const conflicts = await tx.buyerReconciliationConflict.findMany({
        where: { candidateId, evidenceId: input.evidenceId, status: "ABERTO" }
      });
      if (!conflicts.length) throw new AppError(404, "conflict_not_found");
      const approved = !!candidate.compraImportadaId;
      if (approved !== (input.resolution === "CIENTE"))
        throw new AppError(409, approved ? "approved_purchase_requires_acknowledgement" : "resolution_requires_evidence_choice");
      const referenceEvidenceId = conflicts[0]!.referenceEvidenceId;
      const chosen = input.resolution === "ACEITAR_EVIDENCIA" ? input.evidenceId
        : input.resolution === "MANTER_REFERENCIA" ? referenceEvidenceId : candidate.currentEvidenceId;
      if (!chosen) throw new AppError(409, "reference_evidence_missing");
      await tx.buyerReconciliationConflict.updateMany({
        where: { id: { in: conflicts.map((conflict) => conflict.id) } },
        data: { status: "RESOLVIDO", resolucao: input.resolution, motivoResolucao: input.reason, resolvidoPorId: identity.user.id, resolvidoEm: new Date() }
      });
      const remaining = await tx.buyerReconciliationConflict.count({ where: { candidateId, status: "ABERTO" } });
      const current = await tx.buyerEvidence.findUniqueOrThrow({ where: { id: chosen } });
      const order = normalizedMarketplaceOrderSchema.safeParse(current.normalizedPayload);
      const status = remaining ? "COM_DIVERGENCIA"
        : approved ? "APROVADA"
          : order.success && order.data.cancelled ? "CANCELADA" : "AGUARDANDO_APROVACAO";
      const updated = await tx.buyerPurchaseCandidate.update({
        where: { id: candidateId },
        data: { currentEvidenceId: chosen, status, version: { increment: 1 } }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: "BUYER_INGESTION_APROVAR",
        action: "BUYER_CONFLICT_RESOLVED",
        entity: "BuyerPurchaseCandidate",
        entityId: candidateId,
        correlationId,
        idempotencyKey: key,
        reason: input.reason,
        before: { status: candidate.status, currentEvidenceId: candidate.currentEvidenceId, version: candidate.version },
        after: { status: updated.status, currentEvidenceId: chosen, resolution: input.resolution, conflicts: conflicts.map((conflict) => conflict.type) },
        origin: ORIGIN
      });
      return { id: updated.id, status: updated.status, version: updated.version, currentEvidenceId: chosen };
    }
  });
}

type EvidenceIntake = z.infer<typeof buyerEvidenceIntakeSchema>;

// Registra evidência de fonte não-API. Com conta e Order ID, reconcilia pela identidade forte (a API
// mantém prioridade); sem eles, guarda a evidência imutável na fila de identificação, sem candidato.
export async function registerBuyerEvidence(identity: AuthIdentity, input: EvidenceIntake, key: string) {
  if (!hasPermission(identity, "BUYER_INGESTION_REGISTRAR"))
    throw new AppError(403, "insufficient_permission");
  const sourceIdentity = `${input.source}:${input.mailbox ?? "manual"}`;
  const correlationId = randomUUID();
  if (input.contaExternaId && input.order.externalOrderId) {
    const account = await prisma.contaExterna.findUnique({ where: { id: input.contaExternaId } });
    if (!account || account.plataforma !== input.provider) throw new AppError(404, "account_not_found");
    const recorded = await recordMarketplaceEvidence({
      provider: input.provider,
      accountId: account.id,
      connectionId: null,
      order: { ...input.order, externalOrderId: input.order.externalOrderId, reference: input.order.reference ?? input.order.externalOrderId },
      actorId: identity.user.id,
      correlationId,
      idempotencyKey: key,
      source: input.source,
      sourceIdentity,
      externalEvidenceId: input.externalEvidenceId
    });
    return { evidenceId: recorded.id, candidateId: "candidateId" in recorded ? recorded.candidateId : null, status: "IDENTIFICADA" as const };
  }
  const payload = JSON.stringify(input.order);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const externalEvidenceId = input.externalEvidenceId.trim().normalize("NFC");
  return prisma.$transaction(async (tx) => {
    const replay = await tx.buyerEvidence.findUnique({
      where: { sourceIdentity_externalEvidenceId_payloadHash: { sourceIdentity, externalEvidenceId, payloadHash } }
    });
    if (replay) return { evidenceId: replay.id, candidateId: null, status: "AGUARDANDO_IDENTIFICACAO" as const };
    const latest = await tx.buyerEvidence.findFirst({ where: { sourceIdentity, externalEvidenceId }, orderBy: { version: "desc" }, select: { version: true } });
    const evidence = await tx.buyerEvidence.create({
      data: {
        source: input.source, sourceIdentity, externalEvidenceId,
        contaExternaId: input.contaExternaId,
        sourceOccurredAt: new Date(input.order.updatedAt),
        payloadHash, version: (latest?.version ?? 0) + 1,
        normalizedPayload: JSON.parse(payload) as Prisma.InputJsonValue,
        correlationId
      }
    });
    await audit(tx, {
      usuarioId: identity.user.id, permissionCode: "BUYER_INGESTION_REGISTRAR", action: "BUYER_EVIDENCE_UNIDENTIFIED",
      entity: "BuyerEvidence", entityId: evidence.id, correlationId, idempotencyKey: key,
      after: { source: input.source, externalEvidenceId, version: evidence.version, payloadHash }, origin: ORIGIN
    });
    return { evidenceId: evidence.id, candidateId: null, status: "AGUARDANDO_IDENTIFICACAO" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Evidências sem Order ID que ainda não ganharam versão identificada.
export async function unidentifiedBuyerEvidence(identity: AuthIdentity) {
  if (!hasPermission(identity, "BUYER_INGESTION_VISUALIZAR"))
    throw new AppError(403, "insufficient_permission");
  const pending = await prisma.buyerEvidence.findMany({
    where: { externalOrderIdNormalized: null, source: { notIn: ["EBAY_BUYER_API", "AMAZON_BUSINESS_API"] } },
    orderBy: { createdAt: "asc" },
    take: 200
  });
  const identified = await prisma.buyerEvidence.findMany({
    where: {
      externalOrderIdNormalized: { not: null },
      OR: pending.map((evidence) => ({ sourceIdentity: evidence.sourceIdentity, externalEvidenceId: evidence.externalEvidenceId }))
    },
    select: { sourceIdentity: true, externalEvidenceId: true }
  });
  const done = new Set(identified.map((evidence) => `${evidence.sourceIdentity}|${evidence.externalEvidenceId}`));
  return pending
    .filter((evidence) => !done.has(`${evidence.sourceIdentity}|${evidence.externalEvidenceId}`))
    .map((evidence) => ({
      id: evidence.id, source: evidence.source, externalEvidenceId: evidence.externalEvidenceId,
      version: evidence.version, recordedAt: evidence.createdAt.toISOString(), order: evidence.normalizedPayload
    }));
}

// Identificação humana: nova versão da mesma evidência com a identidade forte; a original permanece.
export async function identifyBuyerEvidence(
  identity: AuthIdentity,
  evidenceId: string,
  input: { contaExternaId: string; externalOrderId: string },
  key: string
) {
  if (!hasPermission(identity, "BUYER_INGESTION_REGISTRAR"))
    throw new AppError(403, "insufficient_permission");
  const evidence = await prisma.buyerEvidence.findUnique({ where: { id: evidenceId } });
  if (!evidence || evidence.externalOrderIdNormalized) throw new AppError(404, "not_found");
  const provider = evidence.source === "EMAIL_EBAY" ? "EBAY" : evidence.source === "EMAIL_AMAZON" ? "AMAZON" : null;
  const account = await prisma.contaExterna.findUnique({ where: { id: input.contaExternaId } });
  if (!account || (provider && account.plataforma !== provider) || !["AMAZON", "EBAY"].includes(account.plataforma))
    throw new AppError(404, "account_not_found");
  const order = evidence.normalizedPayload as Record<string, unknown>;
  const recorded = await recordMarketplaceEvidence({
    provider: account.plataforma as "AMAZON" | "EBAY",
    accountId: account.id,
    connectionId: null,
    order: normalizedMarketplaceOrderSchema.parse({ ...order, externalOrderId: input.externalOrderId, reference: order.reference ?? input.externalOrderId }),
    actorId: identity.user.id,
    correlationId: randomUUID(),
    idempotencyKey: key,
    source: evidence.source,
    sourceIdentity: evidence.sourceIdentity,
    externalEvidenceId: evidence.externalEvidenceId
  });
  await prisma.auditLog.create({
    data: {
      usuarioId: identity.user.id, permissionCode: "BUYER_INGESTION_REGISTRAR", action: "BUYER_EVIDENCE_IDENTIFIED",
      entity: "BuyerEvidence", entityId: evidenceId, correlationId: randomUUID(), idempotencyKey: key,
      afterData: { identifiedEvidenceId: recorded.id, contaExternaId: account.id, externalOrderId: input.externalOrderId },
      origin: ORIGIN
    }
  });
  return { evidenceId: recorded.id, candidateId: "candidateId" in recorded ? recorded.candidateId : null };
}
