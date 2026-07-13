-- Unified purchases staging. This migration is additive and keeps the legacy staging columns.
CREATE TYPE "PlataformaCompraExterna" AS ENUM ('AMAZON', 'EBAY', 'WALMART', 'BEST_BUY', 'APPLE', 'OUTRA', 'MANUAL', 'LEGACY_REVIEW');
CREATE TYPE "OrigemCompraExterna" AS ENUM ('API', 'IMPORTACAO_ARQUIVO', 'MANUAL', 'LEGACY');
CREATE TYPE "StatusContaExterna" AS ENUM ('ATIVA', 'INATIVA');
CREATE TYPE "StatusMerchantExterno" AS ENUM ('ATIVO', 'INATIVO', 'EM_REVISAO');
CREATE TYPE "EstadoCompraImportada" AS ENUM ('IMPORTADA', 'EM_REVISAO', 'CANCELADA', 'COM_DIVERGENCIA');
CREATE TYPE "EstrategiaIdentidadeLinha" AS ENUM ('EXTERNAL_LINE_ID', 'FINGERPRINT', 'LEGACY_REVIEW');
CREATE TYPE "StatusLinhaExterna" AS ENUM ('ATIVA', 'CANCELADA', 'COM_DIVERGENCIA');
CREATE TYPE "OrigemMapeamentoExterno" AS ENUM ('MANUAL', 'IMPORTADO');
CREATE TYPE "StatusMapeamentoExterno" AS ENUM ('ATIVO', 'INATIVO');
CREATE TYPE "StatusMaterializacaoCompra" AS ENUM ('CONCLUIDA', 'BLOQUEADA');
CREATE TYPE "TipoConflitoCompra" AS ENUM ('QUANTITY_REDUCED_AFTER_ASSIGNMENT', 'QUANTITY_REDUCED_AFTER_MATERIALIZATION', 'EXTERNAL_ID_COLLISION', 'MAPPING_CHANGED_AFTER_MATERIALIZATION', 'DUPLICATE_EXTERNAL_ORDER', 'STORE_ASSIGNMENT_OVERFLOW', 'PRODUCT_NOT_FOUND', 'PRODUCT_STORE_MISMATCH', 'PAYLOAD_MISMATCH', 'IDEMPOTENCY_CONFLICT');
CREATE TYPE "StatusConflitoCompra" AS ENUM ('ABERTO', 'RESOLVIDO');

CREATE TABLE "ContaExterna" (
  "id" TEXT NOT NULL,
  "plataforma" "PlataformaCompraExterna" NOT NULL,
  "identificadorExterno" TEXT NOT NULL,
  "nomeExibicao" TEXT NOT NULL,
  "status" "StatusContaExterna" NOT NULL DEFAULT 'ATIVA',
  "origemIntegracao" "OrigemCompraExterna" NOT NULL,
  "metadata" JSONB,
  "ultimaSincronizacaoEm" TIMESTAMP(3),
  "ultimoErroSincronizacao" TEXT,
  "criadoPorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContaExterna_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantExterno" (
  "id" TEXT NOT NULL,
  "plataforma" "PlataformaCompraExterna" NOT NULL,
  "externalMerchantId" TEXT,
  "nomeOriginal" TEXT NOT NULL,
  "nomeNormalizado" TEXT NOT NULL,
  "status" "StatusMerchantExterno" NOT NULL DEFAULT 'ATIVO',
  "metadata" JSONB,
  "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantExterno_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CompraImportada"
  ALTER COLUMN "fornecedorId" DROP NOT NULL,
  ADD COLUMN "plataforma" "PlataformaCompraExterna" NOT NULL DEFAULT 'LEGACY_REVIEW',
  ADD COLUMN "contaExternaId" TEXT,
  ADD COLUMN "merchantExternoId" TEXT,
  ADD COLUMN "externalOrderIdOriginal" TEXT,
  ADD COLUMN "externalOrderIdNormalizado" TEXT,
  ADD COLUMN "referenciaPesquisavel" TEXT,
  ADD COLUMN "dataPedido" TIMESTAMP(3),
  ADD COLUMN "statusExterno" TEXT,
  ADD COLUMN "totalExterno" DECIMAL(14,2),
  ADD COLUMN "payloadSnapshot" JSONB,
  ADD COLUMN "payloadHash" TEXT,
  ADD COLUMN "origem" "OrigemCompraExterna" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "estado" "EstadoCompraImportada" NOT NULL DEFAULT 'EM_REVISAO',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "ultimaSincronizacaoEm" TIMESTAMP(3);

ALTER TABLE "CompraImportadaItem"
  ADD COLUMN "externalLineIdOriginal" TEXT,
  ADD COLUMN "externalLineIdNormalizado" TEXT,
  ADD COLUMN "identityFingerprint" TEXT,
  ADD COLUMN "identityDiscriminator" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "identityStrategy" "EstrategiaIdentidadeLinha",
  ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "titulo" TEXT,
  ADD COLUMN "variacao" TEXT,
  ADD COLUMN "skuExterno" TEXT,
  ADD COLUMN "asin" TEXT,
  ADD COLUMN "identificadorOferta" TEXT,
  ADD COLUMN "precoUnitario" DECIMAL(14,2),
  ADD COLUMN "moeda" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "quantidadeCancelada" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quantidadeReembolsada" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "merchantExternoId" TEXT,
  ADD COLUMN "payloadSnapshot" JSONB,
  ADD COLUMN "status" "StatusLinhaExterna" NOT NULL DEFAULT 'ATIVA',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "CompraImportadaItem"
SET "identityFingerprint" = 'legacy:' || "id",
    "identityStrategy" = 'LEGACY_REVIEW',
    "titulo" = 'Item legado em revisao',
    "precoUnitario" = 0
WHERE "identityFingerprint" IS NULL;

ALTER TABLE "CompraImportadaItem"
  ALTER COLUMN "identityFingerprint" SET NOT NULL,
  ALTER COLUMN "identityStrategy" SET NOT NULL,
  ALTER COLUMN "titulo" SET NOT NULL,
  ALTER COLUMN "precoUnitario" SET NOT NULL;

CREATE TABLE "MapeamentoMerchantFornecedor" (
  "id" TEXT NOT NULL, "merchantExternoId" TEXT NOT NULL, "lojaId" TEXT NOT NULL,
  "fornecedorId" TEXT NOT NULL, "origem" "OrigemMapeamentoExterno" NOT NULL DEFAULT 'MANUAL',
  "status" "StatusMapeamentoExterno" NOT NULL DEFAULT 'ATIVO', "version" INTEGER NOT NULL DEFAULT 1,
  "revisadoPorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MapeamentoMerchantFornecedor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MapeamentoItemProduto" (
  "id" TEXT NOT NULL, "itemExternoId" TEXT NOT NULL, "lojaId" TEXT NOT NULL, "produtoId" TEXT NOT NULL,
  "origem" "OrigemMapeamentoExterno" NOT NULL DEFAULT 'MANUAL', "status" "StatusMapeamentoExterno" NOT NULL DEFAULT 'ATIVO',
  "version" INTEGER NOT NULL DEFAULT 1, "revisadoPorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapeamentoItemProduto_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AtribuicaoCompraItem" (
  "id" TEXT NOT NULL, "itemExternoId" TEXT NOT NULL, "lojaId" TEXT NOT NULL, "quantidade" INTEGER NOT NULL,
  "quantidadeMaterializada" INTEGER NOT NULL DEFAULT 0, "version" INTEGER NOT NULL DEFAULT 1,
  "atribuidoPorId" TEXT NOT NULL, "motivo" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AtribuicaoCompraItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AtribuicaoCompraItem_quantidade_check" CHECK ("quantidade" > 0),
  CONSTRAINT "AtribuicaoCompraItem_materializada_check" CHECK ("quantidadeMaterializada" >= 0 AND "quantidadeMaterializada" <= "quantidade")
);
CREATE TABLE "MaterializacaoCompra" (
  "id" TEXT NOT NULL, "compraImportadaId" TEXT NOT NULL, "lojaId" TEXT NOT NULL, "pedidoCompraId" TEXT NOT NULL,
  "status" "StatusMaterializacaoCompra" NOT NULL DEFAULT 'CONCLUIDA', "snapshot" JSONB NOT NULL,
  "materializadoPorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MaterializacaoCompra_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MaterializacaoCompraItem" (
  "id" TEXT NOT NULL, "materializacaoId" TEXT NOT NULL, "lojaId" TEXT NOT NULL, "itemExternoId" TEXT NOT NULL,
  "atribuicaoId" TEXT NOT NULL, "pedidoCompraItemId" TEXT NOT NULL, "quantidade" INTEGER NOT NULL,
  "produtoSnapshot" JSONB NOT NULL, "mappingVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterializacaoCompraItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterializacaoCompraItem_quantidade_check" CHECK ("quantidade" > 0)
);
CREATE TABLE "ConflitoCompra" (
  "id" TEXT NOT NULL, "compraImportadaId" TEXT NOT NULL, "itemExternoId" TEXT,
  "tipo" "TipoConflitoCompra" NOT NULL, "status" "StatusConflitoCompra" NOT NULL DEFAULT 'ABERTO',
  "referencia" TEXT NOT NULL, "payloadAnterior" JSONB, "payloadNovo" JSONB,
  "resolvidoPorId" TEXT, "resolvidoEm" TIMESTAMP(3), "motivoResolucao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConflitoCompra_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CompraImportada" ADD CONSTRAINT "CompraImportada_quantidade_check" CHECK ("quantidade" >= 0);
ALTER TABLE "CompraImportadaItem" ADD CONSTRAINT "CompraImportadaItem_quantidades_check" CHECK ("quantidade" >= 0 AND "quantidadeCancelada" >= 0 AND "quantidadeReembolsada" >= 0 AND "quantidadeCancelada" + "quantidadeReembolsada" <= "quantidade");
ALTER TABLE "CompraImportadaItem" ADD CONSTRAINT "CompraImportadaItem_preco_check" CHECK ("precoUnitario" >= 0);

CREATE UNIQUE INDEX "ContaExterna_plataforma_identificadorExterno_key" ON "ContaExterna"("plataforma", "identificadorExterno");
CREATE INDEX "ContaExterna_status_plataforma_idx" ON "ContaExterna"("status", "plataforma");
CREATE UNIQUE INDEX "MerchantExterno_plataforma_externalMerchantId_key" ON "MerchantExterno"("plataforma", "externalMerchantId");
CREATE INDEX "MerchantExterno_plataforma_nomeNormalizado_idx" ON "MerchantExterno"("plataforma", "nomeNormalizado");
CREATE INDEX "MerchantExterno_status_idx" ON "MerchantExterno"("status");
CREATE UNIQUE INDEX "CompraImportada_external_identity_key" ON "CompraImportada"("plataforma", "contaExternaId", "externalOrderIdNormalizado");
CREATE INDEX "CompraImportada_plataforma_importadaEm_idx" ON "CompraImportada"("plataforma", "importadaEm");
CREATE INDEX "CompraImportada_contaExternaId_importadaEm_idx" ON "CompraImportada"("contaExternaId", "importadaEm");
CREATE INDEX "CompraImportada_merchantExternoId_importadaEm_idx" ON "CompraImportada"("merchantExternoId", "importadaEm");
CREATE INDEX "CompraImportada_estado_importadaEm_idx" ON "CompraImportada"("estado", "importadaEm");
CREATE INDEX "CompraImportada_referenciaPesquisavel_idx" ON "CompraImportada"("referenciaPesquisavel");
CREATE UNIQUE INDEX "CompraImportadaItem_external_line_key" ON "CompraImportadaItem"("compraImportadaId", "externalLineIdNormalizado");
CREATE UNIQUE INDEX "CompraImportadaItem_fingerprint_discriminator_key" ON "CompraImportadaItem"("compraImportadaId", "identityFingerprint", "identityDiscriminator");
CREATE INDEX "CompraImportadaItem_status_createdAt_idx" ON "CompraImportadaItem"("status", "createdAt");
CREATE INDEX "CompraImportadaItem_skuExterno_idx" ON "CompraImportadaItem"("skuExterno");
CREATE UNIQUE INDEX "MerchantFornecedor_merchant_loja_key" ON "MapeamentoMerchantFornecedor"("merchantExternoId", "lojaId");
CREATE INDEX "MerchantFornecedor_loja_status_idx" ON "MapeamentoMerchantFornecedor"("lojaId", "status");
CREATE UNIQUE INDEX "ItemProduto_item_loja_key" ON "MapeamentoItemProduto"("itemExternoId", "lojaId");
CREATE INDEX "ItemProduto_loja_status_idx" ON "MapeamentoItemProduto"("lojaId", "status");
CREATE UNIQUE INDEX "AtribuicaoCompraItem_item_loja_key" ON "AtribuicaoCompraItem"("itemExternoId", "lojaId");
CREATE UNIQUE INDEX "AtribuicaoCompraItem_id_loja_key" ON "AtribuicaoCompraItem"("id", "lojaId");
CREATE INDEX "AtribuicaoCompraItem_loja_updatedAt_idx" ON "AtribuicaoCompraItem"("lojaId", "updatedAt");
CREATE UNIQUE INDEX "MaterializacaoCompra_pedidoCompraId_key" ON "MaterializacaoCompra"("pedidoCompraId");
CREATE UNIQUE INDEX "MaterializacaoCompra_compra_loja_key" ON "MaterializacaoCompra"("compraImportadaId", "lojaId");
CREATE UNIQUE INDEX "MaterializacaoCompra_pedido_loja_key" ON "MaterializacaoCompra"("pedidoCompraId", "lojaId");
CREATE UNIQUE INDEX "MaterializacaoCompra_id_loja_key" ON "MaterializacaoCompra"("id", "lojaId");
CREATE INDEX "MaterializacaoCompra_loja_createdAt_idx" ON "MaterializacaoCompra"("lojaId", "createdAt");
CREATE UNIQUE INDEX "MaterializacaoCompraItem_pedidoCompraItemId_key" ON "MaterializacaoCompraItem"("pedidoCompraItemId");
CREATE UNIQUE INDEX "MaterializacaoCompraItem_materializacao_item_key" ON "MaterializacaoCompraItem"("materializacaoId", "itemExternoId");
CREATE INDEX "MaterializacaoCompraItem_loja_item_idx" ON "MaterializacaoCompraItem"("lojaId", "itemExternoId");
CREATE INDEX "ConflitoCompra_compra_status_idx" ON "ConflitoCompra"("compraImportadaId", "status");
CREATE INDEX "ConflitoCompra_tipo_status_idx" ON "ConflitoCompra"("tipo", "status");

ALTER TABLE "ContaExterna" ADD CONSTRAINT "ContaExterna_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompraImportada" ADD CONSTRAINT "CompraImportada_contaExternaId_fkey" FOREIGN KEY ("contaExternaId") REFERENCES "ContaExterna"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompraImportada" ADD CONSTRAINT "CompraImportada_merchantExternoId_fkey" FOREIGN KEY ("merchantExternoId") REFERENCES "MerchantExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompraImportadaItem" ADD CONSTRAINT "CompraImportadaItem_merchantExternoId_fkey" FOREIGN KEY ("merchantExternoId") REFERENCES "MerchantExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoMerchantFornecedor" ADD CONSTRAINT "MerchantFornecedor_merchant_fkey" FOREIGN KEY ("merchantExternoId") REFERENCES "MerchantExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoMerchantFornecedor" ADD CONSTRAINT "MerchantFornecedor_loja_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoMerchantFornecedor" ADD CONSTRAINT "MerchantFornecedor_fornecedor_loja_fkey" FOREIGN KEY ("fornecedorId", "lojaId") REFERENCES "Fornecedor"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoMerchantFornecedor" ADD CONSTRAINT "MerchantFornecedor_usuario_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoItemProduto" ADD CONSTRAINT "ItemProduto_item_fkey" FOREIGN KEY ("itemExternoId") REFERENCES "CompraImportadaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoItemProduto" ADD CONSTRAINT "ItemProduto_loja_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoItemProduto" ADD CONSTRAINT "ItemProduto_produto_loja_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapeamentoItemProduto" ADD CONSTRAINT "ItemProduto_usuario_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AtribuicaoCompraItem" ADD CONSTRAINT "AtribuicaoCompraItem_item_fkey" FOREIGN KEY ("itemExternoId") REFERENCES "CompraImportadaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AtribuicaoCompraItem" ADD CONSTRAINT "AtribuicaoCompraItem_loja_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AtribuicaoCompraItem" ADD CONSTRAINT "AtribuicaoCompraItem_usuario_fkey" FOREIGN KEY ("atribuidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompra" ADD CONSTRAINT "MaterializacaoCompra_compra_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompra" ADD CONSTRAINT "MaterializacaoCompra_loja_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompra" ADD CONSTRAINT "MaterializacaoCompra_pedido_loja_fkey" FOREIGN KEY ("pedidoCompraId", "lojaId") REFERENCES "PedidoCompra"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompra" ADD CONSTRAINT "MaterializacaoCompra_usuario_fkey" FOREIGN KEY ("materializadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompraItem" ADD CONSTRAINT "MaterializacaoItem_materializacao_loja_fkey" FOREIGN KEY ("materializacaoId", "lojaId") REFERENCES "MaterializacaoCompra"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompraItem" ADD CONSTRAINT "MaterializacaoItem_item_fkey" FOREIGN KEY ("itemExternoId") REFERENCES "CompraImportadaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompraItem" ADD CONSTRAINT "MaterializacaoItem_atribuicao_loja_fkey" FOREIGN KEY ("atribuicaoId", "lojaId") REFERENCES "AtribuicaoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterializacaoCompraItem" ADD CONSTRAINT "MaterializacaoItem_pedidoItem_fkey" FOREIGN KEY ("pedidoCompraItemId") REFERENCES "PedidoCompraItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConflitoCompra" ADD CONSTRAINT "ConflitoCompra_compra_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConflitoCompra" ADD CONSTRAINT "ConflitoCompra_item_fkey" FOREIGN KEY ("itemExternoId") REFERENCES "CompraImportadaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConflitoCompra" ADD CONSTRAINT "ConflitoCompra_resolvidoPor_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
