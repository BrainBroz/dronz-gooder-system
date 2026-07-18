import { AppError } from "../../lib/app-error";
import type {
  MarketplaceAdapter,
  MarketplaceAdapterRegistry,
  MarketplaceCapability,
  MarketplaceConnectionContext,
  MarketplaceOrderPage,
  NormalizedMarketplaceOrder
} from "./marketplace-integrations.types";

abstract class DisabledMarketplaceAdapter implements MarketplaceAdapter {
  abstract readonly provider: "AMAZON" | "EBAY";
  abstract readonly capabilities: readonly MarketplaceCapability[];

  async authorize(): Promise<never> {
    throw new AppError(409, "marketplace_provider_not_configured");
  }

  async refreshAuthorization(): Promise<never> {
    throw new AppError(409, "marketplace_provider_not_configured");
  }

  async listOrders(
    connection: MarketplaceConnectionContext,
    input: { cursor?: string; from?: Date; to?: Date }
  ): Promise<MarketplaceOrderPage> {
    void connection;
    void input;
    throw new AppError(409, "marketplace_provider_not_configured");
  }

  async getOrder(
    connection: MarketplaceConnectionContext,
    externalOrderId: string
  ): Promise<NormalizedMarketplaceOrder> {
    void connection;
    void externalOrderId;
    throw new AppError(409, "marketplace_provider_not_configured");
  }
}

export type MarketplaceAdapterErrorKind =
  "AUTHORIZATION_EXPIRED" | "THROTTLED" | "PERMANENT" | "INVALID_RESPONSE";

export class MarketplaceAdapterError extends Error {
  constructor(
    readonly kind: MarketplaceAdapterErrorKind,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "MarketplaceAdapterError";
  }
}

export function translateMarketplaceAdapterError(error: unknown) {
  if (error instanceof AppError) return error;
  if (!(error instanceof MarketplaceAdapterError))
    return new AppError(502, "external_provider_error");
  if (error.kind === "AUTHORIZATION_EXPIRED")
    return new AppError(401, "marketplace_authorization_expired");
  if (error.kind === "THROTTLED")
    return new AppError(429, "marketplace_provider_throttled");
  if (error.kind === "INVALID_RESPONSE")
    return new AppError(502, "invalid_marketplace_response");
  return new AppError(502, "marketplace_provider_permanent_error");
}

export class AmazonMarketplaceAdapter extends DisabledMarketplaceAdapter {
  readonly provider = "AMAZON" as const;
  readonly capabilities = [] as const;
}

export class EbayMarketplaceAdapter extends DisabledMarketplaceAdapter {
  readonly provider = "EBAY" as const;
  readonly capabilities = [] as const;
}

export const marketplaceAdapterRegistry: MarketplaceAdapterRegistry = {
  AMAZON: new AmazonMarketplaceAdapter(),
  EBAY: new EbayMarketplaceAdapter()
};
