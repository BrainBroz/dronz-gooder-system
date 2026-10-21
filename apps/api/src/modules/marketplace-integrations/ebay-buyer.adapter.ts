import { AppError } from "../../lib/app-error";
import { MarketplaceAdapterError } from "./marketplace-integrations.adapters";
import type { SecretProvider } from "./marketplace-integrations.secrets";
import type {
  MarketplaceAdapter,
  MarketplaceConnectionContext,
  MarketplaceOrderPage,
  NormalizedMarketplaceItem,
  NormalizedMarketplaceOrder,
  NormalizedMarketplacePackage
} from "./marketplace-integrations.types";
import {
  child,
  childrenOf,
  parseXml,
  textOf,
  XmlParseError,
  type XmlNode
} from "./xml";

// EBAY_BUYER_SPECIFICATION_V1: Trading API GetOrders com OrderRole=Buyer, nível 1423 validado no gate.
export const TRADING_URL = "https://api.ebay.com/ws/api.dll";
export const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const COMPATIBILITY_LEVEL = "1423";
export const SCOPE = "https://api.ebay.com/oauth/api_scope";
const MAX_WINDOW_MS = 30 * 86_400_000;
// Sobreposição ao abrir a próxima janela: capta mudanças gravadas com atraso no eBay.
const OVERLAP_MS = 60 * 60_000;
const AUTH_ERROR_CODES = new Set([
  "931",
  "932",
  "16110",
  "21916984",
  "21917053"
]);
const THROTTLE_ERROR_CODES = new Set(["518", "21919144"]);

type Credentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};
type Cursor = { v: 1; from: string; to: string; page: number; until?: string };
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ status: number; text(): Promise<string> }>;

const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Cursor;
    if (
      cursor.v !== 1 ||
      !Number.isInteger(cursor.page) ||
      cursor.page < 1 ||
      Number.isNaN(Date.parse(cursor.from)) ||
      Number.isNaN(Date.parse(cursor.to))
    )
      throw new Error("invalid");
    return cursor;
  } catch {
    throw new MarketplaceAdapterError("PERMANENT", "invalid ebay cursor");
  }
}
const xmlEscape = (value: string) =>
  value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
const amount = (node: XmlNode | undefined) => {
  const value = Number(node?.text.trim());
  return node && Number.isFinite(value)
    ? { value, currency: node.attrs.currencyID?.toUpperCase() }
    : undefined;
};
const isoOf = (value: string | undefined) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;

export class EbayBuyerAdapter implements MarketplaceAdapter {
  readonly provider = "EBAY" as const;
  readonly capabilities = [
    "LIST_ORDERS",
    "GET_ORDER",
    "LIST_ORDER_ITEMS",
    "LIST_SHIPMENTS",
    "INCREMENTAL_CURSOR"
  ] as const;
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly secrets: SecretProvider,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => Date = () => new Date()
  ) {}

  async authorize(): Promise<never> {
    // Consentimento OAuth é feito fora da API (RuName do eBay); aqui só se usa a credencial referenciada.
    throw new AppError(409, "marketplace_authorization_external");
  }

  async refreshAuthorization(): Promise<never> {
    throw new AppError(409, "marketplace_authorization_external");
  }

  private async credentials(
    connection: MarketplaceConnectionContext
  ): Promise<Credentials> {
    const raw = connection.secretReference
      ? await this.secrets.get(connection.secretReference)
      : null;
    if (!raw)
      throw new MarketplaceAdapterError(
        "AUTHORIZATION_EXPIRED",
        "ebay credential not configured"
      );
    try {
      const value = JSON.parse(raw) as Partial<Credentials>;
      if (!value.clientId || !value.clientSecret || !value.refreshToken)
        throw new Error("incomplete");
      return value as Credentials;
    } catch {
      throw new MarketplaceAdapterError(
        "AUTHORIZATION_EXPIRED",
        "ebay credential malformed"
      );
    }
  }

  private async accessToken(connection: MarketplaceConnectionContext) {
    const cached = this.tokens.get(connection.id);
    if (cached && cached.expiresAt > this.now().getTime() + 60_000)
      return cached.token;
    const credentials = await this.credentials(connection);
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        scope: SCOPE
      }).toString()
    });
    const text = await response.text();
    if (response.status === 400 || response.status === 401)
      throw new MarketplaceAdapterError(
        "AUTHORIZATION_EXPIRED",
        "ebay refresh token rejected"
      );
    if (response.status === 429 || response.status >= 500)
      throw new MarketplaceAdapterError(
        "THROTTLED",
        "ebay identity unavailable"
      );
    let body: { access_token?: string; expires_in?: number };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new MarketplaceAdapterError(
        "INVALID_RESPONSE",
        "ebay token response invalid"
      );
    }
    if (!body.access_token || !body.expires_in)
      throw new MarketplaceAdapterError(
        "INVALID_RESPONSE",
        "ebay token response invalid"
      );
    this.tokens.set(connection.id, {
      token: body.access_token,
      expiresAt: this.now().getTime() + body.expires_in * 1000
    });
    return body.access_token;
  }

  private async call(
    connection: MarketplaceConnectionContext,
    requestBody: string
  ) {
    const token = await this.accessToken(connection);
    const response = await this.fetchImpl(TRADING_URL, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetOrders",
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml; charset=utf-8"
      },
      body: `<?xml version="1.0" encoding="utf-8"?><GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">${requestBody}</GetOrdersRequest>`
    });
    if (response.status === 401 || response.status === 403) {
      this.tokens.delete(connection.id);
      throw new MarketplaceAdapterError(
        "AUTHORIZATION_EXPIRED",
        "ebay authorization rejected"
      );
    }
    if (response.status === 429 || response.status >= 500)
      throw new MarketplaceAdapterError(
        "THROTTLED",
        "ebay trading unavailable"
      );
    let root: XmlNode;
    try {
      root = parseXml(await response.text());
    } catch (error) {
      throw new MarketplaceAdapterError(
        "INVALID_RESPONSE",
        error instanceof XmlParseError ? error.message : "ebay xml invalid"
      );
    }
    const ack = textOf(root, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      const codes = childrenOf(root, "Errors").map(
        (error) => textOf(error, "ErrorCode") ?? ""
      );
      if (codes.some((code) => AUTH_ERROR_CODES.has(code))) {
        this.tokens.delete(connection.id);
        throw new MarketplaceAdapterError(
          "AUTHORIZATION_EXPIRED",
          "ebay token invalid"
        );
      }
      if (codes.some((code) => THROTTLE_ERROR_CODES.has(code)))
        throw new MarketplaceAdapterError(
          "THROTTLED",
          "ebay call limit reached"
        );
      throw new MarketplaceAdapterError(
        ack ? "PERMANENT" : "INVALID_RESPONSE",
        `ebay ack ${ack ?? "missing"} (${codes.filter(Boolean).join(",") || "sem código"})`
      );
    }
    return root;
  }

  async listOrders(
    connection: MarketplaceConnectionContext,
    input: { cursor?: string; from?: Date; to?: Date }
  ): Promise<MarketplaceOrderPage> {
    const now = this.now();
    const cursor: Cursor = input.cursor
      ? decodeCursor(input.cursor)
      : (() => {
          const until = (input.to ?? now).toISOString();
          const from =
            input.from ?? new Date(Date.parse(until) - MAX_WINDOW_MS);
          return {
            v: 1,
            from: from.toISOString(),
            to: new Date(
              Math.min(Date.parse(until), from.getTime() + MAX_WINDOW_MS)
            ).toISOString(),
            page: 1,
            ...(input.to ? { until } : {})
          };
        })();
    const root = await this.call(
      connection,
      `<OrderRole>Buyer</OrderRole><DetailLevel>ReturnAll</DetailLevel>` +
        `<ModTimeFrom>${cursor.from}</ModTimeFrom><ModTimeTo>${cursor.to}</ModTimeTo>` +
        `<Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${cursor.page}</PageNumber></Pagination>`
    );
    const orders = childrenOf(child(root, "OrderArray"), "Order").map((order) =>
      this.normalize(order)
    );
    let next: Cursor | undefined;
    if (textOf(root, "HasMoreOrders") === "true")
      next = { ...cursor, page: cursor.page + 1 };
    else {
      // Janela concluída: abre a próxima a partir do fim da anterior (com sobreposição) até o limite pedido.
      const limit = cursor.until ? Date.parse(cursor.until) : now.getTime();
      const windowEnd = Date.parse(cursor.to);
      if (windowEnd < limit - 60_000) {
        const from = windowEnd - OVERLAP_MS;
        next = {
          ...cursor,
          from: new Date(from).toISOString(),
          to: new Date(Math.min(limit, from + MAX_WINDOW_MS)).toISOString(),
          page: 1
        };
      }
    }
    return { orders, ...(next ? { nextCursor: encodeCursor(next) } : {}) };
  }

  /** Foto principal de cada anúncio (Trading GetItem, só PictureDetails); falha de um item não derruba os demais. */
  async fetchItemImages(
    connection: MarketplaceConnectionContext,
    itemIds: string[]
  ): Promise<Record<string, string>> {
    const token = await this.accessToken(connection);
    const found: Record<string, string> = {};
    for (let index = 0; index < itemIds.length; index += 5)
      await Promise.all(
        itemIds.slice(index, index + 5).map(async (id) => {
          try {
            const response = await this.fetchImpl(TRADING_URL, {
              method: "POST",
              headers: {
                "X-EBAY-API-CALL-NAME": "GetItem",
                "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
                "X-EBAY-API-SITEID": "0",
                "X-EBAY-API-IAF-TOKEN": token,
                "Content-Type": "text/xml; charset=utf-8"
              },
              body: `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${xmlEscape(id)}</ItemID><DetailLevel>ReturnAll</DetailLevel><OutputSelector>PictureDetails</OutputSelector></GetItemRequest>`
            });
            if (response.status !== 200) return;
            const url = textOf(child(child(parseXml(await response.text()), "Item"), "PictureDetails"), "PictureURL");
            if (url?.startsWith("https://")) found[id] = url;
          } catch {
            // sem foto não bloqueia a compra
          }
        })
      );
    return found;
  }

  async getOrder(
    connection: MarketplaceConnectionContext,
    externalOrderId: string
  ): Promise<NormalizedMarketplaceOrder> {
    const root = await this.call(
      connection,
      `<OrderRole>Buyer</OrderRole><DetailLevel>ReturnAll</DetailLevel><OrderIDArray><OrderID>${xmlEscape(externalOrderId)}</OrderID></OrderIDArray>`
    );
    const order = child(child(root, "OrderArray"), "Order");
    if (!order) throw new AppError(404, "marketplace_order_not_found");
    return this.normalize(order);
  }

  // Tradução isolada no adapter: o domínio nunca vê nomes de campos XML.
  normalize(order: XmlNode): NormalizedMarketplaceOrder {
    const orderId = textOf(order, "OrderID");
    const createdAt = isoOf(textOf(order, "CreatedTime"));
    if (!orderId || !createdAt)
      throw new MarketplaceAdapterError(
        "INVALID_RESPONSE",
        "ebay order without id or date"
      );
    const updatedAt =
      isoOf(textOf(order, "LastModifiedTime")) ??
      isoOf(textOf(child(order, "CheckoutStatus"), "LastModifiedTime")) ??
      createdAt;
    const status = textOf(order, "OrderStatus");
    const cancelled =
      status === "Cancelled" ||
      textOf(order, "CancelStatus") === "CancelComplete";
    const total =
      amount(child(order, "Total")) ?? amount(child(order, "AmountPaid"));
    const transactions = childrenOf(
      child(order, "TransactionArray"),
      "Transaction"
    );
    const items: NormalizedMarketplaceItem[] = transactions.map(
      (transaction) => {
        const item = child(transaction, "Item");
        const variation = child(transaction, "Variation");
        const price = amount(child(transaction, "TransactionPrice"));
        const quantity = Number(textOf(transaction, "QuantityPurchased"));
        const itemId = textOf(item, "ItemID");
        const transactionId = textOf(transaction, "TransactionID");
        const lineId =
          textOf(transaction, "OrderLineItemID") ??
          (itemId && transactionId ? `${itemId}-${transactionId}` : undefined);
        if (!Number.isInteger(quantity) || quantity < 1 || !price?.currency)
          throw new MarketplaceAdapterError(
            "INVALID_RESPONSE",
            "ebay transaction without quantity or price"
          );
        return {
          ...(lineId ? { externalLineId: lineId } : {}),
          title: textOf(item, "Title") ?? itemId ?? "Item eBay",
          ...(textOf(variation, "VariationTitle")
            ? { variation: textOf(variation, "VariationTitle") }
            : {}),
          ...((textOf(variation, "SKU") ?? textOf(item, "SKU"))
            ? { sku: textOf(variation, "SKU") ?? textOf(item, "SKU") }
            : {}),
          ...(itemId ? { offerId: itemId } : {}),
          quantity,
          // Cancelamento do pedido torna toda a quantidade inelegível; reembolso é valor, não quantidade.
          cancelledQuantity: cancelled ? quantity : 0,
          refundedQuantity: 0,
          unitPrice: price.value,
          currency: price.currency
        };
      }
    );
    if (!items.length)
      throw new MarketplaceAdapterError(
        "INVALID_RESPONSE",
        "ebay order without transactions"
      );
    const packages = new Map<string, NormalizedMarketplacePackage>();
    for (const transaction of transactions)
      for (const tracking of childrenOf(
        child(transaction, "ShippingDetails"),
        "ShipmentTrackingDetails"
      )) {
        const code = textOf(tracking, "ShipmentTrackingNumber");
        if (!code) continue;
        const carrier = textOf(tracking, "ShippingCarrierUsed");
        const id = `${carrier ?? "SEM_TRANSPORTADORA"}:${code}`;
        if (!packages.has(id))
          packages.set(id, {
            externalPackageId: id,
            ...(carrier ? { carrier } : {}),
            trackings: [{ code, ...(carrier ? { carrier } : {}), updatedAt }]
          });
      }
    const shippedAt = isoOf(textOf(order, "ShippedTime"));
    const seller =
      textOf(order, "SellerUserID") ??
      textOf(child(transactions[0], "Item"), "Seller") ??
      undefined;
    return {
      externalOrderId: orderId,
      reference: textOf(order, "ExtendedOrderID") ?? orderId,
      orderedAt: createdAt,
      updatedAt,
      currency: total?.currency ?? items[0]!.currency,
      ...(total ? { total: total.value } : {}),
      ...(status ? { externalStatus: status } : {}),
      cancelled,
      ...(seller
        ? { merchant: { externalMerchantId: seller, name: seller } }
        : {}),
      items,
      shipments:
        packages.size || shippedAt
          ? [
              {
                externalShipmentId: orderId,
                ...(shippedAt ? { status: "SHIPPED", shippedAt } : {}),
                updatedAt,
                packages: [...packages.values()]
              }
            ]
          : []
    };
  }
}
