import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useAuthStore, authHeader } from "../stores/auth";
import { api } from "../api/client";
import { reportQueryKeys } from "../queryKeys";

export type ReportType =
  | "purchase-orders"
  | "purchase-items"
  | "logistics"
  | "suitcase-weight"
  | "inventory"
  | "movements"
  | "payments"
  | "receiving"
  | "costs"
  | "markup";

export interface ReportFilters {
  from?: Date;
  to?: Date;
  status?: string;
}

export function useReport(
  type: ReportType,
  filters: ReportFilters = {}
): UseQueryResult<unknown[], Error> {
  const store = useAuthStore((s) => s.activeStoreId);

  return useQuery({
    queryKey: reportQueryKeys.report(store, type, filters.from, filters.to, filters.status),
    enabled: !!store,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.from) params.append("from", filters.from.toISOString());
      if (filters.to) params.append("to", filters.to.toISOString());
      if (filters.status) params.append("status", filters.status);

      const response = await api.get(`/analytics/reports/${type}`, {
        headers: { ...authHeader(), "x-store-id": store },
        params: Object.fromEntries(params)
      });
      return response.data;
    }
  });
}
