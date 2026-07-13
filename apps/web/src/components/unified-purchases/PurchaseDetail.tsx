import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ContentCard } from "../ui/ContentCard";
import { MutationStatus } from "../ui/MutationStatus";
import { unifiedPurchaseActionPresentation } from "./actionPresentation";
import {
  newIdempotencyKey,
  useUnifiedPurchaseDetail,
  useUnifiedPurchaseMutations
} from "../../hooks/useUnifiedPurchases";
import { catalogQueryKeys, purchasingQueryKeys } from "../../queryKeys";
import { authHeader, useAuthStore } from "../../stores/auth";
import type { Product } from "../../types/catalog";
import type { Supplier } from "../../types/purchasing";
import type {
  UnifiedPurchaseAction,
  UnifiedPurchaseDetail,
  UnifiedPurchaseItemDetail
} from "../../types/unified-purchases";

function hasAction(
  detail: UnifiedPurchaseDetail,
  action: UnifiedPurchaseAction
) {
  return detail.allowedActions.includes(action);
}

export function BlockingReasons({
  reasons
}: {
  reasons: Array<{ code: string; message: string }>;
}) {
  if (!reasons.length) return null;
  return (
    <Stack gap={1} aria-label="Bloqueios da compra">
      {reasons.map((reason) => (
        <Alert key={reason.code} severity="warning">
          <strong>{reason.code}</strong>: {reason.message}
        </Alert>
      ))}
    </Stack>
  );
}

function ItemActions({
  purchase,
  item
}: {
  purchase: UnifiedPurchaseDetail;
  item: UnifiedPurchaseItemDetail;
}) {
  const stores = useAuthStore((state) => state.stores);
  const [storeId, setStoreId] = React.useState(stores[0]?.id ?? "");
  const [quantity, setQuantity] = React.useState(1);
  const [reason, setReason] = React.useState("Ajuste operacional");
  const [productId, setProductId] = React.useState("");
  const mutations = useUnifiedPurchaseMutations();
  const products = useQuery<Product[]>({
    queryKey: catalogQueryKeys.products(storeId || null),
    enabled: Boolean(storeId) && hasAction(purchase, "SET_PRODUCT_MAPPING"),
    queryFn: async () =>
      (
        await api.get("/products", {
          headers: { ...authHeader(), "x-store-id": storeId }
        })
      ).data.items
  });
  const assignment = item.atribuicoes.find((entry) => entry.lojaId === storeId);
  const mapping = item.mapeamentos.find((entry) => entry.lojaId === storeId);
  return (
    <Stack gap={2}>
      <TextField
        select
        label="Loja da ação"
        value={storeId}
        onChange={(event) => {
          setStoreId(event.target.value);
          setProductId("");
        }}
      >
        {stores.map((store) => (
          <MenuItem key={store.id} value={store.id}>
            {store.nome}
          </MenuItem>
        ))}
      </TextField>
      {hasAction(purchase, "ASSIGN_TO_STORE") && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          gap={1}
          alignItems="center"
        >
          <TextField
            label="Quantidade atribuída"
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
          <TextField
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            disabled={!storeId || mutations.setAssignment.isPending}
            onClick={() =>
              mutations.setAssignment.mutate({
                purchaseId: purchase.id,
                itemId: item.id,
                storeId,
                payload: {
                  quantidade: quantity,
                  expectedVersion: item.version,
                  motivo: reason
                },
                idempotencyKey: newIdempotencyKey()
              })
            }
          >
            {unifiedPurchaseActionPresentation.ASSIGN_TO_STORE.label}
          </Button>
        </Stack>
      )}
      {hasAction(purchase, "REMOVE_ASSIGNMENT") && assignment && (
        <Button
          color="warning"
          disabled={mutations.removeAssignment.isPending}
          onClick={() =>
            mutations.removeAssignment.mutate({
              purchaseId: purchase.id,
              itemId: item.id,
              storeId,
              motivo: reason,
              idempotencyKey: newIdempotencyKey()
            })
          }
        >
          {unifiedPurchaseActionPresentation.REMOVE_ASSIGNMENT.label}
        </Button>
      )}
      {hasAction(purchase, "SET_PRODUCT_MAPPING") && (
        <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
          <TextField
            select
            label="Produto interno"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            sx={{ minWidth: 260 }}
          >
            {(products.data ?? []).map((product) => (
              <MenuItem key={product.id} value={product.id}>
                {product.codigo} — {product.nome}
              </MenuItem>
            ))}
          </TextField>
          <Button
            disabled={!productId || mutations.setProductMapping.isPending}
            onClick={() =>
              mutations.setProductMapping.mutate({
                purchaseId: purchase.id,
                itemId: item.id,
                storeId,
                produtoId: productId,
                expectedVersion: mapping?.version,
                idempotencyKey: newIdempotencyKey()
              })
            }
          >
            {unifiedPurchaseActionPresentation.SET_PRODUCT_MAPPING.label}
          </Button>
        </Stack>
      )}
      <MutationStatus
        mutation={mutations.setAssignment}
        successMessage="Atribuição atualizada."
      />
      <MutationStatus
        mutation={mutations.removeAssignment}
        successMessage="Atribuição removida."
      />
      <MutationStatus
        mutation={mutations.setProductMapping}
        successMessage="Produto mapeado."
      />
    </Stack>
  );
}

export function PurchaseDetail({
  id,
  onClose
}: {
  id: string;
  onClose: () => void;
}) {
  const detail = useUnifiedPurchaseDetail(id);
  const stores = useAuthStore((state) => state.stores);
  const mutations = useUnifiedPurchaseMutations();
  const [storeId, setStoreId] = React.useState(stores[0]?.id ?? "");
  const [supplierId, setSupplierId] = React.useState("");
  const [reason, setReason] = React.useState("Conflito revisado manualmente");
  const suppliers = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(storeId || null),
    enabled:
      Boolean(storeId) &&
      Boolean(detail.data?.allowedActions.includes("SET_SUPPLIER_MAPPING")),
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": storeId }
        })
      ).data.items
  });
  if (detail.isLoading)
    return (
      <ContentCard>
        <CircularProgress aria-label="Carregando detalhe da compra" />
      </ContentCard>
    );
  if (detail.isError || !detail.data)
    return (
      <Alert
        severity="error"
        action={
          <Button onClick={() => void detail.refetch()}>
            Tentar novamente
          </Button>
        }
      >
        Não foi possível carregar o detalhe.
      </Alert>
    );
  const purchase = detail.data;
  return (
    <ContentCard>
      <Stack gap={3}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Box>
            <Typography variant="h5">
              {purchase.referenciaPesquisavel ?? purchase.numeroPedido}
            </Typography>
            <Typography color="text.secondary">
              {purchase.plataforma} ·{" "}
              {purchase.contaExterna?.nomeExibicao ?? "Conta não informada"} ·{" "}
              {purchase.moeda}
            </Typography>
          </Box>
          <Button onClick={onClose}>Fechar detalhe</Button>
        </Stack>
        <BlockingReasons reasons={purchase.blockedReasons} />
        {purchase.itens.map((item) => (
          <ContentCard
            key={item.id}
            title={item.titulo}
            description={`${item.quantidade} unidade(s) · ${item.moeda} ${item.precoUnitario}`}
          >
            <Stack gap={2}>
              <Typography variant="body2">
                SKU: {item.skuExterno ?? "não informado"} · Linha externa:{" "}
                {item.externalLineIdOriginal ?? "fingerprint do backend"}
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {item.atribuicoes.map((assignment) => (
                  <Chip
                    key={assignment.id}
                    label={`${assignment.loja.nome}: ${assignment.quantidade} atribuída(s), ${assignment.quantidadeMaterializada} materializada(s)`}
                  />
                ))}
                {!item.atribuicoes.length && (
                  <Chip label="Sem atribuição" variant="outlined" />
                )}
                {item.mapeamentos.map((mapping) => (
                  <Chip
                    color="success"
                    key={mapping.id}
                    label={`${mapping.loja.nome}: ${mapping.produto.nome}`}
                  />
                ))}
              </Stack>
              <ItemActions purchase={purchase} item={item} />
            </Stack>
          </ContentCard>
        ))}
        {purchase.merchantExternoId &&
          hasAction(purchase, "SET_SUPPLIER_MAPPING") && (
            <ContentCard title="Mapping de fornecedor interno">
              <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
                <TextField
                  select
                  label="Loja"
                  value={storeId}
                  onChange={(event) => {
                    setStoreId(event.target.value);
                    setSupplierId("");
                  }}
                >
                  {stores.map((store) => (
                    <MenuItem key={store.id} value={store.id}>
                      {store.nome}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Fornecedor"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  sx={{ minWidth: 240 }}
                >
                  {(suppliers.data ?? []).map((supplier) => (
                    <MenuItem key={supplier.id} value={supplier.id}>
                      {supplier.nome}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  disabled={
                    !supplierId || mutations.setSupplierMapping.isPending
                  }
                  onClick={() =>
                    mutations.setSupplierMapping.mutate({
                      purchaseId: purchase.id,
                      merchantId: purchase.merchantExternoId!,
                      storeId,
                      fornecedorId: supplierId,
                      idempotencyKey: newIdempotencyKey()
                    })
                  }
                >
                  {unifiedPurchaseActionPresentation.SET_SUPPLIER_MAPPING.label}
                </Button>
              </Stack>
              <MutationStatus
                mutation={mutations.setSupplierMapping}
                successMessage="Fornecedor mapeado."
              />
            </ContentCard>
          )}
        {hasAction(purchase, "MATERIALIZE_STORE_ALLOCATION") && (
          <ContentCard
            title="Materialização por loja"
            description="O backend revalida atribuições, mappings, conflitos, versão e idempotência."
          >
            <Stack direction="row" gap={1} flexWrap="wrap">
              {stores.map((store) => (
                <Button
                  key={store.id}
                  variant="outlined"
                  disabled={mutations.materialize.isPending}
                  onClick={() =>
                    mutations.materialize.mutate({
                      purchaseId: purchase.id,
                      storeId: store.id,
                      expectedPurchaseVersion: purchase.version,
                      idempotencyKey: newIdempotencyKey()
                    })
                  }
                >
                  Materializar {store.nome}
                </Button>
              ))}
            </Stack>
            <MutationStatus
              mutation={mutations.materialize}
              successMessage="Materialização concluída."
            />
          </ContentCard>
        )}
        {purchase.conflitos.length > 0 && (
          <ContentCard title="Conflitos">
            <Stack gap={2}>
              {purchase.conflitos.map((conflict) => (
                <Stack key={conflict.id} gap={1}>
                  <Typography>
                    {conflict.tipo} · {conflict.status}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {conflict.referencia}
                  </Typography>
                  {conflict.status === "ABERTO" &&
                    hasAction(purchase, "RESOLVE_CONFLICT") && (
                      <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
                        <TextField
                          label="Motivo da resolução"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                        <Button
                          disabled={
                            reason.length < 5 ||
                            mutations.resolveConflict.isPending
                          }
                          onClick={() =>
                            mutations.resolveConflict.mutate({
                              purchaseId: purchase.id,
                              conflictId: conflict.id,
                              motivo: reason,
                              idempotencyKey: newIdempotencyKey()
                            })
                          }
                        >
                          {
                            unifiedPurchaseActionPresentation.RESOLVE_CONFLICT
                              .label
                          }
                        </Button>
                      </Stack>
                    )}
                </Stack>
              ))}
            </Stack>
            <MutationStatus
              mutation={mutations.resolveConflict}
              successMessage="Conflito resolvido."
            />
          </ContentCard>
        )}
        <ContentCard title="Pedidos operacionais materializados">
          {purchase.materializacoes.map((materialization) => (
            <Typography key={materialization.id}>
              {materialization.pedidoCompra.numeroPedido} ·{" "}
              {materialization.status}
            </Typography>
          ))}
          {!purchase.materializacoes.length && (
            <Typography color="text.secondary">
              Nenhum pedido operacional materializado.
            </Typography>
          )}
        </ContentCard>
        <ContentCard title="Histórico">
          {purchase.history.map((entry) => (
            <Typography key={entry.id} variant="body2">
              {new Date(entry.createdAt).toLocaleString("pt-BR")} ·{" "}
              {entry.action} · {entry.reason ?? "sem motivo informado"}
            </Typography>
          ))}
          {!purchase.history.length && (
            <Typography color="text.secondary">
              Nenhum evento registrado.
            </Typography>
          )}
        </ContentCard>
      </Stack>
    </ContentCard>
  );
}
