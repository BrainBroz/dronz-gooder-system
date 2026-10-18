import { useRef, useState } from "react";
import { Alert, Button, MenuItem, Stack, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { authHeader, useAuthStore } from "../../stores/auth";
import { purchasingQueryKeys } from "../../queryKeys";
import {
  newIdempotencyKey,
  useUnifiedPurchaseMutations
} from "../../hooks/useUnifiedPurchases";
import type { Supplier } from "../../types/purchasing";
import { MutationStatus } from "../ui/MutationStatus";
import { unifiedPurchaseActionPresentation } from "./actionPresentation";

/** Renderizado somente quando o read model autoriza SET_SUPPLIER_MAPPING. */
export function SupplierMappingForm({
  purchaseId,
  merchantId
}: {
  purchaseId: string;
  merchantId: string;
}) {
  const stores = useAuthStore((state) => state.stores);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const submitting = useRef(false);
  const { setSupplierMapping } = useUnifiedPurchaseMutations();
  const suppliers = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(storeId || null),
    enabled: stores.some((store) => store.id === storeId),
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": storeId }
        })
      ).data.items
  });
  const canSubmit =
    stores.some((store) => store.id === storeId) &&
    !suppliers.isFetching &&
    !suppliers.isError &&
    suppliers.data?.some((supplier) => supplier.id === supplierId);

  return (
    <Stack gap={1}>
      <Alert severity="info">
        O merchant precisa estar vinculado a um fornecedor interno da loja para
        materializar.
      </Alert>
      <TextField
        select
        label="Loja do fornecedor"
        value={storeId}
        disabled={setSupplierMapping.isPending}
        onChange={(event) => {
          setStoreId(event.target.value);
          setSupplierId("");
          setSupplierMapping.reset();
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
        disabled={
          suppliers.isFetching ||
          suppliers.isError ||
          setSupplierMapping.isPending
        }
        onChange={(event) => {
          setSupplierId(event.target.value);
          setSupplierMapping.reset();
        }}
      >
        <MenuItem value="">Selecione um fornecedor</MenuItem>
        {(suppliers.data ?? []).map((supplier) => (
          <MenuItem key={supplier.id} value={supplier.id}>
            {supplier.nome}
          </MenuItem>
        ))}
      </TextField>
      {suppliers.isError && (
        <Alert
          severity="error"
          action={
            <Button onClick={() => void suppliers.refetch()}>
              Tentar novamente
            </Button>
          }
        >
          Falha ao carregar fornecedores desta loja.
        </Alert>
      )}
      {suppliers.isSuccess && suppliers.data.length === 0 && (
        <Alert severity="info">
          Cadastre um fornecedor nesta loja em Administração → Fornecedores.
        </Alert>
      )}
      <Button
        disabled={!canSubmit || setSupplierMapping.isPending}
        onClick={() => {
          if (!canSubmit || submitting.current) return;
          submitting.current = true;
          setSupplierMapping.mutate(
            {
              purchaseId,
              merchantId,
              storeId,
              fornecedorId: supplierId,
              idempotencyKey: newIdempotencyKey()
            },
            {
              onSettled: () => {
                submitting.current = false;
              }
            }
          );
        }}
      >
        {unifiedPurchaseActionPresentation.SET_SUPPLIER_MAPPING.label}
      </Button>
      <MutationStatus
        mutation={setSupplierMapping}
        successMessage="Fornecedor mapeado."
      />
    </Stack>
  );
}
