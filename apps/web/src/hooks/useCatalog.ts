import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { catalogQueryKeys } from "../queryKeys";
import type { Category, Product } from "../types/catalog";

function useCatalogContext() {
  const { activeStoreId, accessToken } = useAuthStore();
  const enabled = Boolean(activeStoreId && accessToken);
  const headers = () => ({ ...authHeader(), "x-store-id": activeStoreId! });
  return { activeStoreId, enabled, headers };
}

export function useCategories() {
  const { activeStoreId, enabled, headers } = useCatalogContext();
  const categoriesQuery = useQuery<Category[]>({
    queryKey: catalogQueryKeys.categories(activeStoreId),
    enabled,
    queryFn: async () =>
      (await api.get("/categories", { headers: headers() })).data.items ?? []
  });
  return {
    categories: categoriesQuery.data ?? [],
    categoriesError: categoriesQuery.error,
    categoriesLoading: categoriesQuery.isLoading
  };
}

export function useProducts() {
  const { activeStoreId, enabled, headers } = useCatalogContext();
  const productsQuery = useQuery<Product[]>({
    queryKey: catalogQueryKeys.products(activeStoreId),
    enabled,
    queryFn: async () =>
      (await api.get("/products", { headers: headers() })).data.items ?? []
  });
  return {
    products: productsQuery.data ?? [],
    productsError: productsQuery.error,
    productsLoading: productsQuery.isLoading
  };
}
