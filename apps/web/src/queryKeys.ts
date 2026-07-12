export const catalogQueryKeys = {
  categories: (storeId: string | null) => ["categories", storeId] as const,
  products: (storeId: string | null) => ["products", storeId] as const
};
export const purchasingQueryKeys = {
  suppliers: (storeId: string | null) => ["suppliers", storeId] as const,
  orders: (storeId: string | null) => ["purchase-orders", storeId] as const
};
export const logisticsQueryKeys = {
  travelers: (id: string | null) => ["travelers", id] as const,
  trips: (id: string | null) => ["trips", id] as const,
  suitcases: (id: string | null) => ["suitcases", id] as const,
  suitcaseWeight: (storeId: string | null, malaId: string | null) =>
    ["suitcase-weight", storeId, malaId] as const
};
export const inventoryQueryKeys = {
  stock: (id: string | null) => ["inventory", id] as const,
  receiving: (id: string | null) => ["receiving", id] as const,
  movements: (id: string | null) => ["inventory-movements", id] as const
};
export const financeQueryKeys = {
  payments: (id: string | null) => ["finance-payments", id] as const
};
export const dashboardQueryKeys = {
  summary: (id: string | null) => ["dashboard", id] as const
};
export const reportQueryKeys = {
  report: (
    id: string | null,
    type: string,
    from?: Date | string,
    to?: Date | string,
    status?: string
  ) => [
    "report",
    id,
    type,
    typeof from === "string" ? from : from?.toISOString(),
    typeof to === "string" ? to : to?.toISOString(),
    status
  ] as const
};
