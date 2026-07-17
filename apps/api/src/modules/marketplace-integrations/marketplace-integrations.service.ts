import { createHash, randomUUID } from "node:crypto";
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
  importPurchase,
  upsertMerchant
} from "../unified-purchases/unified-purchases.service";
import {
  marketplaceAdapterRegistry,
  translateMarketplaceAdapterError
} from "./marketplace-integrations.adapters";
import {
  capabilitySchema,
  marketplaceOrderPageSchema
} from "./marketplace-integrations.schemas";
import type {
  createConnectionSchema,
  listConnectionsSchema,
  syncConnectionSchema
} from "./marketplace-integrations.schemas";
import type {
  MarketplaceAdapterRegistry,
  MarketplaceBlockedReason,
  MarketplaceConnectionReadModel,
  MarketplaceOrderPage,
  NormalizedMarketplaceOrder
} from "./marketplace-integrations.types";

type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
type ListConnectionsInput = z.infer<typeof listConnectionsSchema>;
type SyncConnectionInput = z.infer<typeof syncConnectionSchema>;

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

async function persistShippingData(
  purchaseId: string,
  order: NormalizedMarketplaceOrder
) {
  await prisma.$transaction(
    async (tx) => {
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
          for (const tracking of externalPackage.trackings) {
            const replaces = tracking.replacesCode
              ? await tx.trackingExterno.findFirst({
                  where: {
                    pacoteExternoId: savedPackage.id,
                    codigo: normalizeExternalId(tracking.replacesCode),
                    ativo: true
                  }
                })
              : null;
            if (replaces)
              await tx.trackingExterno.update({
                where: { id: replaces.id },
                data: { ativo: false }
              });
            const normalizedCode = normalizeExternalId(tracking.code);
            const savedTracking = await tx.trackingExterno.findFirst({
              where: {
                pacoteExternoId: savedPackage.id,
                codigo: normalizedCode,
                transportadora: tracking.carrier ?? null
              }
            });
            const trackingData = {
              statusExterno: tracking.status,
              ativo: true,
              substituiTrackingId: replaces?.id,
              ultimaAtualizacaoEm: new Date(tracking.updatedAt)
            };
            if (savedTracking) {
              await tx.trackingExterno.update({
                where: { id: savedTracking.id },
                data: trackingData
              });
            } else {
              await tx.trackingExterno.create({
                data: {
                  pacoteExternoId: savedPackage.id,
                  codigo: normalizedCode,
                  transportadora: tracking.carrier,
                  ...trackingData,
                  criadoExternamenteEm: tracking.createdAt
                    ? new Date(tracking.createdAt)
                    : null
                }
              });
            }
          }
        }
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function importNormalizedOrder(
  identity: AuthIdentity,
  connection: ConnectionWithRelations,
  order: NormalizedMarketplaceOrder,
  executionId: string
) {
  const merchant = order.merchant
    ? await upsertMerchant(
        identity,
        {
          plataforma: connection.provider,
          externalMerchantId: order.merchant.externalMerchantId,
          nome: order.merchant.name,
          metadata: { source: "MARKETPLACE_SYNC" }
        },
        `merchant:${executionId}:${order.merchant.externalMerchantId ?? order.merchant.name}`
      )
    : null;
  const normalizedOrderId = normalizeExternalId(order.externalOrderId);
  const existing = await prisma.compraImportada.findUnique({
    where: {
      plataforma_contaExternaId_externalOrderIdNormalizado: {
        plataforma: connection.provider,
        contaExternaId: connection.contaExternaId,
        externalOrderIdNormalizado: normalizedOrderId
      }
    }
  });
  const purchase = await importPurchase(
    identity,
    {
      plataforma: connection.provider,
      contaExternaId: connection.contaExternaId,
      merchantExternoId: merchant?.id,
      externalOrderId: order.externalOrderId,
      referencia: order.reference,
      dataPedido: new Date(order.orderedAt),
      moeda: order.currency.toUpperCase(),
      statusExterno: order.externalStatus,
      totalExterno: order.total,
      origem: "API",
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
        merchantExternoId: merchant?.id,
        snapshot: { sourceUpdatedAt: order.updatedAt }
      })),
      snapshot: {
        sourceUpdatedAt: order.updatedAt,
        cancelled: order.cancelled
      }
    },
    `order:${executionId}:${normalizedOrderId}:${order.updatedAt}`
  );
  await prisma.compraImportada.update({
    where: { id: purchase.id },
    data: {
      conexaoMarketplaceId: connection.id,
      ultimaSincronizacaoEm: new Date()
    }
  });
  await persistShippingData(purchase.id, order);
  return { created: !existing };
}

function sanitizeProviderError(error: unknown) {
  if (error instanceof AppError) return error.code;
  return "external_provider_error";
}

async function executePages(
  identity: AuthIdentity,
  connection: ConnectionWithRelations,
  executionId: string,
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
    for (const order of page.orders) {
      counts.processed += 1;
      try {
        const result = await importNormalizedOrder(
          identity,
          connection,
          order,
          executionId
        );
        if (result.created) counts.created += 1;
        else counts.updated += 1;
      } catch (error) {
        if (error instanceof AppError && error.status === 409)
          counts.conflicts += 1;
        else counts.failures += 1;
      }
    }
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
            cursorSincronizacao: result.cursor,
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
