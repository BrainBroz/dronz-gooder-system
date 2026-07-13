export const marketplaceCapabilities = [
  "LIST_ORDERS",
  "GET_ORDER",
  "LIST_ORDER_ITEMS",
  "LIST_SHIPMENTS",
  "INCREMENTAL_CURSOR"
] as const;

export type MarketplaceCapability = (typeof marketplaceCapabilities)[number];

export const marketplaceActions = [
  "VIEW_CONNECTION",
  "MANAGE_CONNECTION",
  "SYNC_CONNECTION",
  "VIEW_SYNC_HISTORY",
  "REPROCESS_SYNC"
] as const;

export type MarketplaceAction = (typeof marketplaceActions)[number];

export const marketplaceBlockReasons = [
  "NOT_CONFIGURED",
  "CONNECTION_INACTIVE",
  "AUTHORIZATION_EXPIRED",
  "SYNC_IN_PROGRESS",
  "STORE_SCOPE_MISMATCH",
  "PROVIDER_ACCESS_UNAVAILABLE"
] as const;

export type MarketplaceBlockReason = (typeof marketplaceBlockReasons)[number];

export type MarketplaceBlockedReason = {
  code: MarketplaceBlockReason;
  message: string;
};

export type NormalizedMarketplaceItem = {
  externalLineId?: string;
  title: string;
  sku?: string;
  asin?: string;
  offerId?: string;
  variation?: string;
  quantity: number;
  cancelledQuantity: number;
  refundedQuantity: number;
  unitPrice: number;
  currency: string;
};

export type NormalizedMarketplaceTracking = {
  code: string;
  carrier?: string;
  status?: string;
  createdAt?: string;
  updatedAt: string;
  replacesCode?: string;
};

export type NormalizedMarketplacePackage = {
  externalPackageId: string;
  carrier?: string;
  trackings: NormalizedMarketplaceTracking[];
};

export type NormalizedMarketplaceShipment = {
  externalShipmentId: string;
  status?: string;
  shippedAt?: string;
  updatedAt: string;
  packages: NormalizedMarketplacePackage[];
};

export type NormalizedMarketplaceOrder = {
  externalOrderId: string;
  reference: string;
  orderedAt: string;
  updatedAt: string;
  currency: string;
  total?: number;
  externalStatus?: string;
  cancelled: boolean;
  merchant?: {
    externalMerchantId?: string;
    name: string;
  };
  items: NormalizedMarketplaceItem[];
  shipments: NormalizedMarketplaceShipment[];
};

export type MarketplaceOrderPage = {
  orders: NormalizedMarketplaceOrder[];
  nextCursor?: string;
};

export type MarketplaceConnectionContext = {
  id: string;
  provider: "AMAZON" | "EBAY";
  externalIdentifier: string;
  region?: string;
  marketplace?: string;
  cursor?: string;
  secretReference?: string;
};

export interface MarketplaceAdapter {
  readonly provider: "AMAZON" | "EBAY";
  readonly capabilities: readonly MarketplaceCapability[];
  authorize(): Promise<never>;
  refreshAuthorization(): Promise<never>;
  listOrders(
    connection: MarketplaceConnectionContext,
    input: { cursor?: string; from?: Date; to?: Date }
  ): Promise<MarketplaceOrderPage>;
  getOrder(
    connection: MarketplaceConnectionContext,
    externalOrderId: string
  ): Promise<NormalizedMarketplaceOrder>;
}

export type MarketplaceAdapterRegistry = Readonly<
  Record<"AMAZON" | "EBAY", MarketplaceAdapter>
>;

export type MarketplaceConnectionReadModel = {
  id: string;
  provider: "AMAZON" | "EBAY";
  account: { id: string; name: string; externalIdentifier: string };
  name: string;
  externalIdentifier: string;
  region: string | null;
  marketplace: string | null;
  scope: "SHARED" | "STORE_DEDICATED";
  allowedStore: { id: string; slug: string; name: string } | null;
  status:
    | "NOT_CONFIGURED"
    | "ACTIVE"
    | "INACTIVE"
    | "AUTHORIZATION_EXPIRED"
    | "ERROR";
  secretConfigured: boolean;
  capabilities: MarketplaceCapability[];
  authorizedAt: string | null;
  authorizationExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  version: number;
  allowedActions: MarketplaceAction[];
  blockedReasons: MarketplaceBlockedReason[];
};
