import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { unifiedPurchasesQueryKeys } from "../queryKeys";
import { authHeader } from "../stores/auth";
import type {
  UnifiedPurchaseDetail,
  UnifiedPurchaseFilters,
  UnifiedPurchaseOverview,
  UnifiedPurchasePage
} from "../types/unified-purchases";

const globalHeaders = () => ({ ...authHeader() });
const storeHeaders = (storeId: string, idempotencyKey?: string) => ({
  ...authHeader(),
  "x-store-id": storeId,
  ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
});
const mutationHeaders = (idempotencyKey: string) => ({
  ...authHeader(),
  "idempotency-key": idempotencyKey
});

export function useUnifiedPurchases(
  filters: UnifiedPurchaseFilters,
  enabled = true
) {
  const overview = useQuery<UnifiedPurchaseOverview>({
    queryKey: unifiedPurchasesQueryKeys.overview(),
    enabled,
    queryFn: async () =>
      (
        await api.get("/imported-purchases/overview", {
          headers: globalHeaders()
        })
      ).data
  });
  const list = useQuery<UnifiedPurchasePage>({
    queryKey: unifiedPurchasesQueryKeys.list(filters),
    enabled,
    queryFn: async () =>
      (
        await api.get("/imported-purchases", {
          headers: globalHeaders(),
          params: filters
        })
      ).data
  });
  return { overview, list };
}

export function useUnifiedPurchaseDetail(id: string | null) {
  return useQuery<UnifiedPurchaseDetail>({
    queryKey: unifiedPurchasesQueryKeys.detail(id),
    enabled: Boolean(id),
    queryFn: async () =>
      (await api.get(`/imported-purchases/${id}`, { headers: globalHeaders() }))
        .data
  });
}

export function useUnifiedPurchaseMutations() {
  const client = useQueryClient();
  const invalidate = async (purchaseId?: string) => {
    await client.invalidateQueries({ queryKey: unifiedPurchasesQueryKeys.all });
    if (purchaseId) {
      await client.invalidateQueries({
        queryKey: unifiedPurchasesQueryKeys.detail(purchaseId)
      });
      await client.invalidateQueries({
        queryKey: unifiedPurchasesQueryKeys.history(purchaseId)
      });
    }
  };
  return {
    createAccount: useMutation({
      mutationFn: (input: { payload: object; idempotencyKey: string }) =>
        api.post("/imported-purchases/accounts", input.payload, {
          headers: mutationHeaders(input.idempotencyKey)
        }),
      onSuccess: () => invalidate()
    }),
    createMerchant: useMutation({
      mutationFn: (input: { payload: object; idempotencyKey: string }) =>
        api.post("/imported-purchases/merchants", input.payload, {
          headers: mutationHeaders(input.idempotencyKey)
        }),
      onSuccess: () => invalidate()
    }),
    importPurchase: useMutation({
      mutationFn: (input: { payload: object; idempotencyKey: string }) =>
        api.post("/imported-purchases", input.payload, {
          headers: mutationHeaders(input.idempotencyKey)
        }),
      onSuccess: () => invalidate()
    }),
    createManualPurchase: useMutation({
      mutationFn: (input: {
        payload: object;
        idempotencyKey: string;
        storeId: string;
      }) =>
        api.post("/imported-purchases/manual", input.payload, {
          headers: storeHeaders(input.storeId, input.idempotencyKey)
        }),
      onSuccess: () => invalidate()
    }),
    setAssignment: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        itemId: string;
        storeId: string;
        payload: object;
        idempotencyKey: string;
      }) =>
        api.put(
          `/imported-purchases/items/${input.itemId}/assignments/${input.storeId}`,
          input.payload,
          { headers: storeHeaders(input.storeId, input.idempotencyKey) }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    }),
    removeAssignment: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        itemId: string;
        storeId: string;
        motivo: string;
        idempotencyKey: string;
      }) =>
        api.delete(
          `/imported-purchases/items/${input.itemId}/assignments/${input.storeId}`,
          {
            data: { motivo: input.motivo },
            headers: storeHeaders(input.storeId, input.idempotencyKey)
          }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    }),
    setProductMapping: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        itemId: string;
        storeId: string;
        produtoId: string;
        expectedVersion?: number;
        idempotencyKey: string;
      }) =>
        api.put(
          `/imported-purchases/items/${input.itemId}/product-mappings/${input.storeId}`,
          {
            produtoId: input.produtoId,
            expectedVersion: input.expectedVersion
          },
          { headers: storeHeaders(input.storeId, input.idempotencyKey) }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    }),
    setSupplierMapping: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        merchantId: string;
        storeId: string;
        fornecedorId: string;
        expectedVersion?: number;
        idempotencyKey: string;
      }) =>
        api.put(
          `/imported-purchases/merchants/${input.merchantId}/supplier-mappings/${input.storeId}`,
          {
            fornecedorId: input.fornecedorId,
            expectedVersion: input.expectedVersion
          },
          { headers: storeHeaders(input.storeId, input.idempotencyKey) }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    }),
    materialize: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        storeId: string;
        expectedPurchaseVersion: number;
        idempotencyKey: string;
      }) =>
        api.post(
          `/imported-purchases/${input.purchaseId}/materializations/${input.storeId}`,
          { expectedPurchaseVersion: input.expectedPurchaseVersion },
          { headers: storeHeaders(input.storeId, input.idempotencyKey) }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    }),
    resolveConflict: useMutation({
      mutationFn: (input: {
        purchaseId: string;
        conflictId: string;
        motivo: string;
        idempotencyKey: string;
      }) =>
        api.post(
          `/imported-purchases/conflicts/${input.conflictId}/resolve`,
          { motivo: input.motivo },
          { headers: mutationHeaders(input.idempotencyKey) }
        ),
      onSuccess: (_response, input) => invalidate(input.purchaseId)
    })
  };
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
