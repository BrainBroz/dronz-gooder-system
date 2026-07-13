import { createHash, randomUUID } from "node:crypto";
import {
  EstadoCompraImportada,
  OrigemCompraExterna,
  OrigemMapeamentoExterno,
  PlataformaCompraExterna,
  Prisma,
  StatusAtribuicao
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";
import type { AuthIdentity } from "../../middlewares/auth";
import type {
  UnifiedPurchaseAction,
  UnifiedPurchaseBlockedReason,
  UnifiedPurchasePage
} from "./unified-purchases.types";
import type { z } from "zod";
import type {
  accountSchema,
  assignmentSchema,
  importPurchaseSchema,
  listSchema,
  manualPurchaseSchema,
  materializationSchema,
  merchantSchema,
  productMappingSchema,
  supplierMappingSchema
} from "./unified-purchases.schemas";

type AccountInput = z.infer<typeof accountSchema>;
type MerchantInput = z.infer<typeof merchantSchema>;
type ImportInput = z.infer<typeof importPurchaseSchema>;
type ManualInput = z.infer<typeof manualPurchaseSchema>;
type AssignmentInput = z.infer<typeof assignmentSchema>;
type ProductMappingInput = z.infer<typeof productMappingSchema>;
type SupplierMappingInput = z.infer<typeof supplierMappingSchema>;
type MaterializationInput = z.infer<typeof materializationSchema>;
type ListInput = z.infer<typeof listSchema>;

const GLOBAL_SCOPE = "GLOBAL_STAGING";
const ORIGIN = "API_COMPRAS_UNIFICADAS";

const normalizeExternalId = (value: string) => value.trim().normalize("NFC");
const normalizeMerchantName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const hash = (value: object | string) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const json = (value: object): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const permissions = (identity: AuthIdentity) =>
  new Set(identity.permissoes.map((permission) => permission.code));
const has = (identity: AuthIdentity, permission: string) => {
  const granted = permissions(identity);
  return granted.has("SYSTEM_ADMIN") || granted.has(permission);
};
const assertStore = (identity: AuthIdentity, lojaId: string) => {
  if (!identity.lojas.some((loja) => loja.id === lojaId))
    throw new AppError(403, "cross_store_access");
};

function itemIdentity(
  item: ImportInput["itens"][number],
  discriminator: number
) {
  const externalLineId = item.externalLineId
    ? normalizeExternalId(item.externalLineId)
    : null;
  const fingerprint = hash(
    externalLineId ?? {
      sku: item.sku ?? null,
      asin: item.asin ?? null,
      offer: item.identificadorOferta ?? null,
      variation: item.variacao ?? null,
      price: item.precoUnitario,
      currency: item.moeda
    }
  );
  return {
    externalLineId,
    fingerprint,
    discriminator,
    strategy: externalLineId
      ? ("EXTERNAL_LINE_ID" as const)
      : ("FINGERPRINT" as const)
  };
}

const itemEligibility = (item: {
  quantidade: number;
  quantidadeCancelada: number;
  quantidadeReembolsada: number;
}) => item.quantidade - item.quantidadeCancelada - item.quantidadeReembolsada;

export async function createExternalAccount(
  identity: AuthIdentity,
  input: AccountInput,
  key?: string
) {
  const externalId = normalizeExternalId(input.identificadorExterno);
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "CREATE_EXTERNAL_ACCOUNT",
    entityId: `${input.plataforma}:${externalId}`,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const account = await tx.contaExterna.upsert({
        where: {
          plataforma_identificadorExterno: {
            plataforma: input.plataforma,
            identificadorExterno: externalId
          }
        },
        update: {
          nomeExibicao: input.nomeExibicao,
          metadata: input.metadata,
          status: "ATIVA"
        },
        create: {
          ...input,
          identificadorExterno: externalId,
          metadata: input.metadata,
          criadoPorId: identity.user.id
        }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: "CONTA_EXTERNA_GERENCIAR",
        action: "EXTERNAL_ACCOUNT_UPSERTED",
        entity: "ContaExterna",
        entityId: account.id,
        correlationId,
        idempotencyKey: key,
        after: account,
        origin: ORIGIN
      });
      return account;
    }
  });
}

export async function upsertMerchant(
  identity: AuthIdentity,
  input: MerchantInput,
  key?: string
) {
  const normalized = normalizeMerchantName(input.nome);
  const entityIdentity = input.externalMerchantId
    ? normalizeExternalId(input.externalMerchantId)
    : normalized;
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "UPSERT_EXTERNAL_MERCHANT",
    entityId: `${input.plataforma}:${entityIdentity}`,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const existing = input.externalMerchantId
        ? await tx.merchantExterno.findUnique({
            where: {
              plataforma_externalMerchantId: {
                plataforma: input.plataforma,
                externalMerchantId: entityIdentity
              }
            }
          })
        : await tx.merchantExterno.findFirst({
            where: {
              plataforma: input.plataforma,
              externalMerchantId: null,
              nomeNormalizado: normalized
            }
          });
      const merchant = existing
        ? await tx.merchantExterno.update({
            where: { id: existing.id },
            data: {
              nomeOriginal: input.nome,
              nomeNormalizado: normalized,
              metadata: input.metadata,
              status: "ATIVO"
            }
          })
        : await tx.merchantExterno.create({
            data: {
              plataforma: input.plataforma,
              externalMerchantId: input.externalMerchantId
                ? entityIdentity
                : null,
              nomeOriginal: input.nome,
              nomeNormalizado: normalized,
              metadata: input.metadata
            }
          });
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: "MAPPING_FORNECEDOR_GERENCIAR",
        action: "EXTERNAL_MERCHANT_UPSERTED",
        entity: "MerchantExterno",
        entityId: merchant.id,
        correlationId,
        idempotencyKey: key,
        before: existing ?? undefined,
        after: merchant,
        origin: ORIGIN
      });
      return merchant;
    }
  });
}

async function createImportedPurchase(
  tx: Prisma.TransactionClient,
  input: ImportInput,
  payloadHash: string
) {
  const account = await tx.contaExterna.findUnique({
    where: { id: input.contaExternaId }
  });
  if (
    !account ||
    account.status !== "ATIVA" ||
    account.plataforma !== input.plataforma
  )
    throw new AppError(400, "invalid_external_account");
  if (input.merchantExternoId) {
    const merchant = await tx.merchantExterno.findUnique({
      where: { id: input.merchantExternoId }
    });
    if (!merchant || merchant.plataforma !== input.plataforma)
      throw new AppError(400, "invalid_external_merchant");
  }
  const externalOrderId = normalizeExternalId(input.externalOrderId);
  const existing = await tx.compraImportada.findUnique({
    where: {
      plataforma_contaExternaId_externalOrderIdNormalizado: {
        plataforma: input.plataforma,
        contaExternaId: input.contaExternaId,
        externalOrderIdNormalizado: externalOrderId
      }
    }
  });
  if (existing) {
    if (existing.payloadHash === payloadHash)
      return { purchase: existing, replay: true };
    await tx.conflitoCompra.create({
      data: {
        compraImportadaId: existing.id,
        tipo: "PAYLOAD_MISMATCH",
        referencia: input.referencia,
        payloadAnterior: existing.payloadSnapshot ?? Prisma.JsonNull,
        payloadNovo: json(input)
      }
    });
    await tx.compraImportada.update({
      where: { id: existing.id },
      data: { estado: "COM_DIVERGENCIA", version: { increment: 1 } }
    });
    throw new AppError(409, "external_id_conflict");
  }
  const purchase = await tx.compraImportada.create({
    data: {
      lojaId: null,
      fornecedorId: null,
      numeroPedido: input.referencia,
      quantidade: input.itens.reduce((sum, item) => sum + item.quantidade, 0),
      moeda: input.moeda,
      plataforma: input.plataforma,
      contaExternaId: input.contaExternaId,
      merchantExternoId: input.merchantExternoId,
      externalOrderIdOriginal: input.externalOrderId,
      externalOrderIdNormalizado: externalOrderId,
      referenciaPesquisavel: input.referencia,
      dataPedido: input.dataPedido,
      statusExterno: input.statusExterno,
      totalExterno: input.totalExterno,
      payloadSnapshot: input.snapshot,
      payloadHash,
      origem: input.origem,
      estado: "IMPORTADA",
      ultimaSincronizacaoEm: new Date(),
      itens: {
        create: input.itens.map((item, index) => {
          const identity = itemIdentity(item, index);
          return {
            quantidade: item.quantidade,
            externalLineIdOriginal: item.externalLineId,
            externalLineIdNormalizado: identity.externalLineId,
            identityFingerprint: identity.fingerprint,
            identityDiscriminator: identity.discriminator,
            identityStrategy: identity.strategy,
            titulo: item.titulo,
            variacao: item.variacao,
            skuExterno: item.sku,
            asin: item.asin,
            identificadorOferta: item.identificadorOferta,
            precoUnitario: item.precoUnitario,
            moeda: item.moeda,
            merchantExternoId: item.merchantExternoId,
            payloadSnapshot: item.snapshot
          };
        })
      }
    }
  });
  return { purchase, replay: false };
}

export async function importPurchase(
  identity: AuthIdentity,
  input: ImportInput,
  key?: string
) {
  const normalizedOrderId = normalizeExternalId(input.externalOrderId);
  const payloadHash = hash(input);
  const existing = await prisma.compraImportada.findUnique({
    where: {
      plataforma_contaExternaId_externalOrderIdNormalizado: {
        plataforma: input.plataforma,
        contaExternaId: input.contaExternaId,
        externalOrderIdNormalizado: normalizedOrderId
      }
    }
  });
  if (existing && existing.payloadHash !== payloadHash) {
    await prisma.$transaction(
      async (tx) => {
        const conflict = await tx.conflitoCompra.create({
          data: {
            compraImportadaId: existing.id,
            tipo: "PAYLOAD_MISMATCH",
            referencia: input.referencia,
            payloadAnterior: existing.payloadSnapshot ?? Prisma.JsonNull,
            payloadNovo: json(input)
          }
        });
        await tx.compraImportada.update({
          where: { id: existing.id },
          data: { estado: "COM_DIVERGENCIA", version: { increment: 1 } }
        });
        await audit(tx, {
          usuarioId: identity.user.id,
          permissionCode: "COMPRAS_IMPORTADAS_IMPORTAR",
          action: "EXTERNAL_PURCHASE_CONFLICT_DETECTED",
          entity: "ConflitoCompra",
          entityId: conflict.id,
          correlationId: randomUUID(),
          before: existing.payloadSnapshot ?? undefined,
          after: input,
          origin: ORIGIN
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    throw new AppError(409, "external_id_conflict");
  }
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "IMPORT_EXTERNAL_PURCHASE",
    entityId: `${input.plataforma}:${input.contaExternaId}:${normalizedOrderId}`,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const result = await createImportedPurchase(tx, input, payloadHash);
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: "COMPRAS_IMPORTADAS_IMPORTAR",
        action: result.replay
          ? "EXTERNAL_PURCHASE_REIMPORTED"
          : "EXTERNAL_PURCHASE_IMPORTED",
        entity: "CompraImportada",
        entityId: result.purchase.id,
        correlationId,
        idempotencyKey: key,
        after: result.purchase,
        origin: ORIGIN
      });
      return result.purchase;
    }
  });
}

export async function createManualPurchase(
  identity: AuthIdentity,
  input: ManualInput,
  key: string
) {
  assertStore(identity, input.lojaId);
  const syntheticOrderId = `manual:${hash(`${identity.user.id}:${key}`)}`;
  return idempotentMutation({
    lojaId: input.lojaId,
    operation: "CREATE_MANUAL_PURCHASE",
    entityId: syntheticOrderId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const merchant = await tx.merchantExterno.findUnique({
        where: { id: input.merchantExternoId }
      });
      if (!merchant) throw new AppError(400, "invalid_external_merchant");
      const purchase = await tx.compraImportada.create({
        data: {
          lojaId: null,
          fornecedorId: null,
          numeroPedido: input.referencia,
          quantidade: input.itens.reduce(
            (sum, item) => sum + item.quantidade,
            0
          ),
          moeda: "USD",
          plataforma: PlataformaCompraExterna.MANUAL,
          merchantExternoId: merchant.id,
          externalOrderIdOriginal: syntheticOrderId,
          externalOrderIdNormalizado: syntheticOrderId,
          referenciaPesquisavel: input.referencia,
          dataPedido: input.dataPedido,
          payloadHash: hash(input),
          origem: OrigemCompraExterna.MANUAL,
          estado: EstadoCompraImportada.IMPORTADA,
          itens: {
            create: input.itens.map((item, index) => {
              const identity = itemIdentity(item, index);
              return {
                quantidade: item.quantidade,
                externalLineIdOriginal: item.externalLineId,
                externalLineIdNormalizado: identity.externalLineId,
                identityFingerprint: identity.fingerprint,
                identityDiscriminator: index,
                identityStrategy: identity.strategy,
                titulo: item.titulo,
                variacao: item.variacao,
                skuExterno: item.sku,
                asin: item.asin,
                identificadorOferta: item.identificadorOferta,
                precoUnitario: item.precoUnitario,
                moeda: "USD",
                merchantExternoId: merchant.id
              };
            })
          }
        },
        include: { itens: true }
      });
      for (const [index, item] of purchase.itens.entries()) {
        const source = input.itens[index];
        const product = await tx.produto.findFirst({
          where: { id: source.produtoId, lojaId: input.lojaId, ativo: true }
        });
        if (!product) throw new AppError(400, "product_store_mismatch");
        await tx.atribuicaoCompraItem.create({
          data: {
            itemExternoId: item.id,
            lojaId: input.lojaId,
            quantidade: item.quantidade,
            atribuidoPorId: identity.user.id
          }
        });
        await tx.mapeamentoItemProduto.create({
          data: {
            itemExternoId: item.id,
            lojaId: input.lojaId,
            produtoId: product.id,
            revisadoPorId: identity.user.id
          }
        });
      }
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId: input.lojaId,
        permissionCode: "COMPRAS_IMPORTADAS_IMPORTAR",
        action: "MANUAL_PURCHASE_CREATED",
        entity: "CompraImportada",
        entityId: purchase.id,
        correlationId,
        idempotencyKey: key,
        after: purchase,
        origin: ORIGIN
      });
      return purchase;
    }
  });
}

export async function setAssignment(
  identity: AuthIdentity,
  itemId: string,
  lojaId: string,
  input: AssignmentInput,
  key?: string
) {
  assertStore(identity, lojaId);
  return idempotentMutation({
    lojaId,
    operation: "SET_EXTERNAL_ITEM_ASSIGNMENT",
    entityId: itemId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "CompraImportadaItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.compraImportadaItem.findUnique({
        where: { id: itemId },
        include: { atribuicoes: true }
      });
      if (!item) throw new AppError(404, "not_found");
      if (item.version !== input.expectedVersion)
        throw new AppError(409, "concurrent_modification");
      const current = item.atribuicoes.find(
        (assignment) => assignment.lojaId === lojaId
      );
      if (current && input.quantidade < current.quantidadeMaterializada)
        throw new AppError(409, "already_materialized");
      const other = item.atribuicoes
        .filter((assignment) => assignment.lojaId !== lojaId)
        .reduce((sum, assignment) => sum + assignment.quantidade, 0);
      if (other + input.quantidade > itemEligibility(item))
        throw new AppError(409, "store_assignment_overflow");
      const assignment = await tx.atribuicaoCompraItem.upsert({
        where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } },
        update: {
          quantidade: input.quantidade,
          motivo: input.motivo,
          atribuidoPorId: identity.user.id,
          version: { increment: 1 }
        },
        create: {
          itemExternoId: itemId,
          lojaId,
          quantidade: input.quantidade,
          motivo: input.motivo,
          atribuidoPorId: identity.user.id
        }
      });
      await tx.compraImportadaItem.update({
        where: { id: itemId },
        data: { version: { increment: 1 } }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId,
        permissionCode: "COMPRAS_IMPORTADAS_ATRIBUIR",
        action: "STORE_ASSIGNMENT_SET",
        entity: "AtribuicaoCompraItem",
        entityId: assignment.id,
        correlationId,
        idempotencyKey: key,
        reason: input.motivo,
        before: current,
        after: assignment,
        origin: ORIGIN
      });
      return assignment;
    }
  });
}

export async function removeAssignment(
  identity: AuthIdentity,
  itemId: string,
  lojaId: string,
  reason: string,
  key?: string
) {
  assertStore(identity, lojaId);
  return idempotentMutation({
    lojaId,
    operation: "REMOVE_EXTERNAL_ITEM_ASSIGNMENT",
    entityId: itemId,
    key,
    payload: { reason },
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "CompraImportadaItem" WHERE id = ${itemId} FOR UPDATE`;
      const assignment = await tx.atribuicaoCompraItem.findUnique({
        where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } }
      });
      if (!assignment) return { removed: false };
      if (assignment.quantidadeMaterializada > 0)
        throw new AppError(409, "already_materialized");
      await tx.atribuicaoCompraItem.delete({ where: { id: assignment.id } });
      await tx.compraImportadaItem.update({
        where: { id: itemId },
        data: { version: { increment: 1 } }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId,
        permissionCode: "COMPRAS_IMPORTADAS_ATRIBUIR",
        action: "STORE_ASSIGNMENT_REMOVED",
        entity: "AtribuicaoCompraItem",
        entityId: assignment.id,
        correlationId,
        idempotencyKey: key,
        reason,
        before: assignment,
        origin: ORIGIN
      });
      return { removed: true };
    }
  });
}

export async function setProductMapping(
  identity: AuthIdentity,
  itemId: string,
  lojaId: string,
  input: ProductMappingInput,
  key?: string
) {
  assertStore(identity, lojaId);
  return idempotentMutation({
    lojaId,
    operation: "SET_EXTERNAL_PRODUCT_MAPPING",
    entityId: itemId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const product = await tx.produto.findFirst({
        where: { id: input.produtoId, lojaId, ativo: true }
      });
      if (!product) throw new AppError(400, "product_store_mismatch");
      const existing = await tx.mapeamentoItemProduto.findUnique({
        where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } }
      });
      if (
        existing &&
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      )
        throw new AppError(409, "concurrent_modification");
      if (
        await tx.materializacaoCompraItem.count({
          where: { itemExternoId: itemId, lojaId }
        })
      )
        throw new AppError(409, "mapping_changed_after_materialization");
      const mapping = await tx.mapeamentoItemProduto.upsert({
        where: { itemExternoId_lojaId: { itemExternoId: itemId, lojaId } },
        update: {
          produtoId: product.id,
          status: "ATIVO",
          revisadoPorId: identity.user.id,
          version: { increment: 1 }
        },
        create: {
          itemExternoId: itemId,
          lojaId,
          produtoId: product.id,
          origem: OrigemMapeamentoExterno.MANUAL,
          revisadoPorId: identity.user.id
        }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId,
        permissionCode: "MAPPING_PRODUTO_GERENCIAR",
        action: "PRODUCT_MAPPING_SET",
        entity: "MapeamentoItemProduto",
        entityId: mapping.id,
        correlationId,
        idempotencyKey: key,
        before: existing,
        after: mapping,
        origin: ORIGIN
      });
      return mapping;
    }
  });
}

export async function setSupplierMapping(
  identity: AuthIdentity,
  merchantId: string,
  lojaId: string,
  input: SupplierMappingInput,
  key?: string
) {
  assertStore(identity, lojaId);
  return idempotentMutation({
    lojaId,
    operation: "SET_EXTERNAL_SUPPLIER_MAPPING",
    entityId: merchantId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      const supplier = await tx.fornecedor.findFirst({
        where: { id: input.fornecedorId, lojaId, ativo: true }
      });
      if (!supplier) throw new AppError(400, "supplier_store_mismatch");
      const existing = await tx.mapeamentoMerchantFornecedor.findUnique({
        where: {
          merchantExternoId_lojaId: { merchantExternoId: merchantId, lojaId }
        }
      });
      if (
        existing &&
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      )
        throw new AppError(409, "concurrent_modification");
      const mapping = await tx.mapeamentoMerchantFornecedor.upsert({
        where: {
          merchantExternoId_lojaId: { merchantExternoId: merchantId, lojaId }
        },
        update: {
          fornecedorId: supplier.id,
          status: "ATIVO",
          revisadoPorId: identity.user.id,
          version: { increment: 1 }
        },
        create: {
          merchantExternoId: merchantId,
          lojaId,
          fornecedorId: supplier.id,
          revisadoPorId: identity.user.id
        }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId,
        permissionCode: "MAPPING_FORNECEDOR_GERENCIAR",
        action: "SUPPLIER_MAPPING_SET",
        entity: "MapeamentoMerchantFornecedor",
        entityId: mapping.id,
        correlationId,
        idempotencyKey: key,
        before: existing,
        after: mapping,
        origin: ORIGIN
      });
      return mapping;
    }
  });
}

export async function materialize(
  identity: AuthIdentity,
  purchaseId: string,
  lojaId: string,
  input: MaterializationInput,
  key?: string
) {
  assertStore(identity, lojaId);
  return idempotentMutation({
    lojaId,
    operation: "MATERIALIZE_EXTERNAL_PURCHASE",
    entityId: purchaseId,
    key,
    payload: input,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "CompraImportada" WHERE id = ${purchaseId} FOR UPDATE`;
      const existing = await tx.materializacaoCompra.findUnique({
        where: {
          compraImportadaId_lojaId: { compraImportadaId: purchaseId, lojaId }
        },
        include: { pedidoCompra: { include: { itens: true } } }
      });
      if (existing) return existing;
      const purchase = await tx.compraImportada.findUnique({
        where: { id: purchaseId },
        include: {
          merchantExterno: true,
          conflitos: { where: { status: "ABERTO" } },
          itens: {
            include: {
              atribuicoes: { where: { lojaId } },
              mapeamentos: {
                where: { lojaId, status: "ATIVO" },
                include: { produto: true }
              }
            }
          }
        }
      });
      if (!purchase) throw new AppError(404, "not_found");
      if (purchase.version !== input.expectedPurchaseVersion)
        throw new AppError(409, "concurrent_modification");
      if (purchase.moeda !== "USD")
        throw new AppError(409, "currency_conversion_required");
      if (purchase.conflitos.length)
        throw new AppError(409, "conflict_requires_resolution");
      if (!purchase.merchantExternoId)
        throw new AppError(409, "supplier_mapping_required");
      const supplierMapping = await tx.mapeamentoMerchantFornecedor.findUnique({
        where: {
          merchantExternoId_lojaId: {
            merchantExternoId: purchase.merchantExternoId,
            lojaId
          }
        }
      });
      if (!supplierMapping || supplierMapping.status !== "ATIVO")
        throw new AppError(409, "supplier_mapping_required");
      const eligible = purchase.itens.flatMap((item) => {
        const assignment = item.atribuicoes[0];
        if (
          !assignment ||
          assignment.quantidade <= assignment.quantidadeMaterializada
        )
          return [];
        const mapping = item.mapeamentos[0];
        if (!mapping) throw new AppError(409, "product_mapping_required");
        return [
          {
            item,
            assignment,
            mapping,
            quantity: assignment.quantidade - assignment.quantidadeMaterializada
          }
        ];
      });
      if (!eligible.length)
        throw new AppError(409, "store_assignment_required");
      const subtotal = eligible.reduce(
        (sum, entry) => sum + Number(entry.item.precoUnitario) * entry.quantity,
        0
      );
      const order = await tx.pedidoCompra.create({
        data: {
          lojaId,
          fornecedorId: supplierMapping.fornecedorId,
          numeroPedido: `EXT-${purchase.id}-${lojaId}`,
          dataCompra: purchase.dataPedido ?? purchase.importadaEm,
          moeda: "USD",
          status: "DRAFT",
          subtotal,
          total: subtotal,
          compraImportadaId: purchase.id,
          statusAtribuicao: StatusAtribuicao.ATRIBUIDA
        }
      });
      const materialization = await tx.materializacaoCompra.create({
        data: {
          compraImportadaId: purchase.id,
          lojaId,
          pedidoCompraId: order.id,
          snapshot: json({
            purchaseId: purchase.id,
            version: purchase.version,
            supplierMappingVersion: supplierMapping.version
          }),
          materializadoPorId: identity.user.id
        }
      });
      for (const entry of eligible) {
        const orderItem = await tx.pedidoCompraItem.create({
          data: {
            pedidoCompraId: order.id,
            lojaId,
            produtoId: entry.mapping.produtoId,
            quantidade: entry.quantity,
            precoUnitario: entry.item.precoUnitario,
            totalItem: Number(entry.item.precoUnitario) * entry.quantity
          }
        });
        await tx.materializacaoCompraItem.create({
          data: {
            materializacaoId: materialization.id,
            lojaId,
            itemExternoId: entry.item.id,
            atribuicaoId: entry.assignment.id,
            pedidoCompraItemId: orderItem.id,
            quantidade: entry.quantity,
            mappingVersion: entry.mapping.version,
            produtoSnapshot: json({
              id: entry.mapping.produto.id,
              codigo: entry.mapping.produto.codigo,
              nome: entry.mapping.produto.nome
            })
          }
        });
        await tx.atribuicaoCompraItem.update({
          where: { id: entry.assignment.id },
          data: {
            quantidadeMaterializada: { increment: entry.quantity },
            version: { increment: 1 }
          }
        });
      }
      await tx.compraImportada.update({
        where: { id: purchase.id },
        data: { version: { increment: 1 } }
      });
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId,
        permissionCode: "COMPRAS_IMPORTADAS_MATERIALIZAR",
        action: "PURCHASE_MATERIALIZED",
        entity: "MaterializacaoCompra",
        entityId: materialization.id,
        correlationId,
        idempotencyKey: key,
        after: materialization,
        origin: ORIGIN
      });
      return tx.materializacaoCompra.findUniqueOrThrow({
        where: { id: materialization.id },
        include: { pedidoCompra: { include: { itens: true } }, itens: true }
      });
    }
  });
}

function actionsFor(identity: AuthIdentity): UnifiedPurchaseAction[] {
  const actions: UnifiedPurchaseAction[] = [];
  if (has(identity, "COMPRAS_IMPORTADAS_ATRIBUIR"))
    actions.push("ASSIGN_TO_STORE", "REMOVE_ASSIGNMENT");
  if (has(identity, "MAPPING_PRODUTO_GERENCIAR"))
    actions.push("SET_PRODUCT_MAPPING", "REMOVE_PRODUCT_MAPPING");
  if (has(identity, "MAPPING_FORNECEDOR_GERENCIAR"))
    actions.push("SET_SUPPLIER_MAPPING");
  if (has(identity, "COMPRAS_IMPORTADAS_MATERIALIZAR"))
    actions.push("MATERIALIZE_STORE_ALLOCATION");
  if (has(identity, "COMPRAS_IMPORTADAS_REVISAR"))
    actions.push("RESOLVE_CONFLICT");
  if (has(identity, "COMPRAS_IMPORTADAS_IMPORTAR"))
    actions.push("CREATE_MANUAL_PURCHASE");
  return actions;
}

export async function listPurchases(
  identity: AuthIdentity,
  input: ListInput
): Promise<UnifiedPurchasePage> {
  const where: Prisma.CompraImportadaWhereInput = {
    ...(input.estado ? { estado: input.estado } : {}),
    ...(input.plataforma ? { plataforma: input.plataforma } : {}),
    ...(input.contaExternaId ? { contaExternaId: input.contaExternaId } : {}),
    ...(input.merchantExternoId
      ? { merchantExternoId: input.merchantExternoId }
      : {}),
    ...(input.referencia
      ? {
          referenciaPesquisavel: {
            contains: input.referencia,
            mode: "insensitive"
          }
        }
      : {}),
    ...(input.from || input.to
      ? { dataPedido: { gte: input.from, lte: input.to } }
      : {}),
    ...(input.lojaId
      ? { itens: { some: { atribuicoes: { some: { lojaId: input.lojaId } } } } }
      : {})
  };
  if (input.lojaId) assertStore(identity, input.lojaId);
  const [total, purchases] = await prisma.$transaction([
    prisma.compraImportada.count({ where }),
    prisma.compraImportada.findMany({
      where,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      orderBy: [{ importadaEm: "desc" }, { id: "asc" }],
      include: {
        contaExterna: true,
        merchantExterno: true,
        conflitos: { where: { status: "ABERTO" } },
        itens: { include: { atribuicoes: true } }
      }
    })
  ]);
  return {
    page: input.page,
    limit: input.limit,
    total,
    items: purchases.map((purchase) => {
      const quantities = purchase.itens.reduce(
        (acc, item) => {
          const assigned = item.atribuicoes.reduce(
            (sum, assignment) => sum + assignment.quantidade,
            0
          );
          const materialized = item.atribuicoes.reduce(
            (sum, assignment) => sum + assignment.quantidadeMaterializada,
            0
          );
          return {
            total: acc.total + itemEligibility(item),
            assigned: acc.assigned + assigned,
            materialized: acc.materialized + materialized
          };
        },
        { total: 0, assigned: 0, materialized: 0 }
      );
      const blockedReasons: UnifiedPurchaseBlockedReason[] = purchase.conflitos
        .length
        ? [
            {
              code: "EXTERNAL_ORDER_CONFLICT",
              message: "Compra possui conflito aberto."
            }
          ]
        : [];
      return {
        id: purchase.id,
        provider: purchase.plataforma,
        account: purchase.contaExterna
          ? {
              id: purchase.contaExterna.id,
              name: purchase.contaExterna.nomeExibicao
            }
          : null,
        merchant: purchase.merchantExterno
          ? {
              id: purchase.merchantExterno.id,
              name: purchase.merchantExterno.nomeOriginal
            }
          : null,
        reference: purchase.referenciaPesquisavel ?? purchase.numeroPedido,
        orderedAt: purchase.dataPedido?.toISOString() ?? null,
        currency: purchase.moeda,
        state: purchase.estado,
        itemCount: purchase.itens.length,
        progress: {
          ...quantities,
          pending: quantities.total - quantities.assigned
        },
        conflictCount: purchase.conflitos.length,
        allowedActions: blockedReasons.length
          ? actionsFor(identity).filter(
              (action) => action !== "MATERIALIZE_STORE_ALLOCATION"
            )
          : actionsFor(identity),
        blockedReasons
      };
    })
  };
}

export async function overview(identity: AuthIdentity) {
  const purchases = await prisma.compraImportada.findMany({
    select: {
      plataforma: true,
      itens: {
        select: {
          quantidade: true,
          quantidadeCancelada: true,
          quantidadeReembolsada: true,
          mapeamentos: { where: { status: "ATIVO" }, select: { id: true } },
          atribuicoes: {
            select: { quantidade: true, quantidadeMaterializada: true }
          }
        }
      },
      conflitos: { where: { status: "ABERTO" }, select: { id: true } }
    }
  });
  const result = {
    totalOrders: purchases.length,
    totalItems: 0,
    unassigned: 0,
    partiallyAssigned: 0,
    fullyAssigned: 0,
    materialized: 0,
    pending: 0,
    conflicts: 0,
    mappingsPending: 0,
    byProvider: {} as Partial<Record<PlataformaCompraExterna, number>>,
    allowedActions: actionsFor(identity)
  };
  for (const purchase of purchases) {
    result.byProvider[purchase.plataforma] =
      (result.byProvider[purchase.plataforma] ?? 0) + 1;
    result.conflicts += purchase.conflitos.length;
    for (const item of purchase.itens) {
      result.totalItems += 1;
      const eligible = itemEligibility(item);
      const assigned = item.atribuicoes.reduce(
        (sum, value) => sum + value.quantidade,
        0
      );
      const materialized = item.atribuicoes.reduce(
        (sum, value) => sum + value.quantidadeMaterializada,
        0
      );
      if (assigned === 0) result.unassigned += 1;
      else if (assigned < eligible) result.partiallyAssigned += 1;
      else result.fullyAssigned += 1;
      if (materialized > 0) result.materialized += 1;
      result.pending += Math.max(0, eligible - assigned);
      if (!item.mapeamentos.length) result.mappingsPending += 1;
    }
  }
  return result;
}

export async function purchaseDetail(identity: AuthIdentity, id: string) {
  const purchase = await prisma.compraImportada.findUnique({
    where: { id },
    include: {
      contaExterna: true,
      merchantExterno: true,
      itens: {
        include: {
          merchantExterno: true,
          atribuicoes: {
            include: { loja: { select: { id: true, nome: true, slug: true } } }
          },
          mapeamentos: {
            include: {
              produto: { select: { id: true, codigo: true, nome: true } },
              loja: { select: { id: true, nome: true } }
            }
          },
          itensMaterializados: true
        }
      },
      materializacoes: { include: { pedidoCompra: true, itens: true } },
      conflitos: true
    }
  });
  if (!purchase) throw new AppError(404, "not_found");
  const history = await historyForPurchase(id);
  return {
    ...purchase,
    allowedActions: actionsFor(identity),
    blockedReasons: purchase.conflitos.some(
      (conflict) => conflict.status === "ABERTO"
    )
      ? [
          {
            code: "EXTERNAL_ORDER_CONFLICT",
            message: "Compra possui conflito aberto."
          }
        ]
      : [],
    history
  };
}

export async function historyForPurchase(
  purchaseId: string,
  page = 1,
  limit = 50
) {
  const related = await prisma.compraImportada.findUnique({
    where: { id: purchaseId },
    select: {
      itens: {
        select: {
          atribuicoes: { select: { id: true } },
          mapeamentos: { select: { id: true } }
        }
      },
      materializacoes: { select: { id: true } },
      conflitos: { select: { id: true } }
    }
  });
  const relatedIds = related
    ? [
        ...related.itens.flatMap((item) =>
          [...item.atribuicoes, ...item.mapeamentos].map((entry) => entry.id)
        ),
        ...related.materializacoes.map((entry) => entry.id),
        ...related.conflitos.map((entry) => entry.id)
      ]
    : [];
  return prisma.auditLog.findMany({
    where: {
      origin: ORIGIN,
      OR: [
        { entity: "CompraImportada", entityId: purchaseId },
        { entityId: { in: relatedIds } }
      ]
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit
  });
}

export async function resolveConflict(
  identity: AuthIdentity,
  conflictId: string,
  reason: string,
  key?: string
) {
  return idempotentMutation({
    lojaId: GLOBAL_SCOPE,
    operation: "RESOLVE_EXTERNAL_PURCHASE_CONFLICT",
    entityId: conflictId,
    key,
    payload: { reason },
    execute: async (tx, correlationId) => {
      const conflict = await tx.conflitoCompra.findUnique({
        where: { id: conflictId }
      });
      if (!conflict) throw new AppError(404, "not_found");
      if (conflict.status === "RESOLVIDO") return conflict;
      const resolved = await tx.conflitoCompra.update({
        where: { id: conflict.id },
        data: {
          status: "RESOLVIDO",
          resolvidoPorId: identity.user.id,
          resolvidoEm: new Date(),
          motivoResolucao: reason
        }
      });
      const openConflicts = await tx.conflitoCompra.count({
        where: {
          compraImportadaId: conflict.compraImportadaId,
          status: "ABERTO"
        }
      });
      if (openConflicts === 0)
        await tx.compraImportada.update({
          where: { id: conflict.compraImportadaId },
          data: { estado: "EM_REVISAO", version: { increment: 1 } }
        });
      await audit(tx, {
        usuarioId: identity.user.id,
        permissionCode: "COMPRAS_IMPORTADAS_REVISAR",
        action: "PURCHASE_CONFLICT_RESOLVED",
        entity: "ConflitoCompra",
        entityId: resolved.id,
        correlationId,
        idempotencyKey: key,
        reason,
        before: conflict,
        after: resolved,
        origin: ORIGIN
      });
      return resolved;
    }
  });
}
