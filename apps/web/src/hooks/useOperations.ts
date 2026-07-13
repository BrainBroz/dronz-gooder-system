import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import type {
  CheckpointCandidate,
  DefinitiveCandidate,
  MiamiCandidate,
  OperationsOverview,
  ReceivingCandidate,
  ReceivingDetail
} from "../types/operations";

export const operationsKeys = {
  all: (storeId: string | null) => ["operations", storeId] as const,
  overview: (storeId: string | null) => ["operations", storeId, "overview"] as const,
  candidates: (storeId: string | null, stage: string) => ["operations", storeId, stage, "candidates"] as const,
  detail: (storeId: string | null, stage: string, id: string | null) => ["operations", storeId, stage, "detail", id] as const
};

const useTransport = () => {
  const storeId = useAuthStore((state) => state.activeStoreId);
  return { storeId, headers: { ...authHeader(), "x-store-id": storeId } };
};

export function useOperationsOverview() {
  const { storeId, headers } = useTransport();
  return useQuery<OperationsOverview>({
    queryKey: operationsKeys.overview(storeId), enabled: Boolean(storeId),
    queryFn: async () => (await api.get<OperationsOverview>("/operations/overview", { headers })).data
  });
}

export function useOperationCandidates(stage: "miami" | "paraguay" | "brazil" | "receiving" | "definitive-entry", enabled = true) {
  const { storeId, headers } = useTransport();
  return useQuery<MiamiCandidate[] | CheckpointCandidate[] | ReceivingCandidate[] | DefinitiveCandidate[]>({
    queryKey: operationsKeys.candidates(storeId, stage), enabled: Boolean(storeId) && enabled,
    queryFn: async () => (await api.get(`/operations/${stage}/candidates`, { headers })).data
  });
}

export function useOperationDetail(stage: "miami/items" | "paraguay" | "brazil" | "receiving" | "definitive-entry", id: string | null) {
  const { storeId, headers } = useTransport();
  return useQuery<MiamiCandidate | CheckpointCandidate | ReceivingDetail | DefinitiveCandidate>({
    queryKey: operationsKeys.detail(storeId, stage, id), enabled: Boolean(storeId && id),
    queryFn: async () => (await api.get(`/operations/${stage}/${id}`, { headers })).data
  });
}

export function useOperationalMutation() {
  const { storeId, headers } = useTransport();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; body: object }) =>
      (await api.post(input.url, input.body, { headers: { ...headers, "idempotency-key": crypto.randomUUID() } })).data,
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.all(storeId) })
  });
}
