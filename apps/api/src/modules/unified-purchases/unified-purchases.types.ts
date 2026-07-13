export const unifiedPurchaseActions = [
  "ASSIGN_TO_STORE",
  "REMOVE_ASSIGNMENT",
  "SET_PRODUCT_MAPPING",
  "REMOVE_PRODUCT_MAPPING",
  "SET_SUPPLIER_MAPPING",
  "MATERIALIZE_STORE_ALLOCATION",
  "RESOLVE_CONFLICT",
  "CREATE_MANUAL_PURCHASE"
] as const;

export type UnifiedPurchaseAction = (typeof unifiedPurchaseActions)[number];

export const unifiedPurchaseBlockReasons = [
  "PRODUCT_MAPPING_REQUIRED",
  "SUPPLIER_MAPPING_REQUIRED",
  "STORE_ASSIGNMENT_REQUIRED",
  "INSUFFICIENT_QUANTITY",
  "ALREADY_MATERIALIZED",
  "EXTERNAL_ORDER_CONFLICT",
  "CROSS_STORE_ACCESS",
  "MATERIALIZATION_IN_PROGRESS",
  "CURRENCY_CONVERSION_REQUIRED"
] as const;

export type UnifiedPurchaseBlockReason =
  (typeof unifiedPurchaseBlockReasons)[number];

export type UnifiedPurchaseBlockedReason = {
  code: UnifiedPurchaseBlockReason;
  message: string;
};

export type StagingProgress = {
  total: number;
  assigned: number;
  materialized: number;
  pending: number;
};

export type UnifiedPurchaseListItem = {
  id: string;
  provider: string;
  account: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
  reference: string;
  orderedAt: string | null;
  currency: string;
  state: string;
  itemCount: number;
  progress: StagingProgress;
  conflictCount: number;
  allowedActions: UnifiedPurchaseAction[];
  blockedReasons: UnifiedPurchaseBlockedReason[];
};

export type UnifiedPurchasePage = {
  items: UnifiedPurchaseListItem[];
  page: number;
  limit: number;
  total: number;
};
