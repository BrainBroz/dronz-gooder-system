import { describe, expect, it } from "vitest";
import { EbayBuyerAdapter } from "../src/modules/marketplace-integrations/ebay-buyer.adapter";
import { normalizedMarketplaceOrderSchema } from "../src/modules/marketplace-integrations/marketplace-integrations.schemas";
import { parseXml, textOf } from "../src/modules/marketplace-integrations/xml";

export const getOrdersXml = (
  orders: string,
  hasMore = false,
  ack = "Success",
  errors = ""
) =>
  `<?xml version="1.0" encoding="UTF-8"?><GetOrdersResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
  `<Ack>${ack}</Ack>${errors}<HasMoreOrders>${hasMore}</HasMoreOrders><OrderArray>${orders}</OrderArray></GetOrdersResponse>`;

export const ebayOrder = (
  id: string,
  opts: { status?: string; trackings?: [string, string][] } = {}
) => `
  <Order><OrderID>${id}</OrderID><OrderStatus>${opts.status ?? "Completed"}</OrderStatus>
    <CreatedTime>2026-10-10T12:00:00.000Z</CreatedTime><LastModifiedTime>2026-10-11T09:00:00.000Z</LastModifiedTime>
    <Total currencyID="USD">35.50</Total><SellerUserID>seller_a</SellerUserID><ShippedTime>2026-10-11T08:00:00.000Z</ShippedTime>
    <TransactionArray>
      <Transaction><OrderLineItemID>${id}-L1</OrderLineItemID><TransactionID>T1</TransactionID>
        <Item><ItemID>111</ItemID><Title>Drone &amp; Cabo</Title></Item>
        <QuantityPurchased>2</QuantityPurchased><TransactionPrice currencyID="USD">15.25</TransactionPrice>
        <ShippingDetails>${(opts.trackings ?? [])
          .map(
            ([carrier, code]) =>
              `<ShipmentTrackingDetails><ShippingCarrierUsed>${carrier}</ShippingCarrierUsed><ShipmentTrackingNumber>${code}</ShipmentTrackingNumber></ShipmentTrackingDetails>`
          )
          .join("")}</ShippingDetails>
      </Transaction>
      <Transaction><TransactionID>T2</TransactionID><Item><ItemID>222</ItemID><Title><![CDATA[Bateria <extra>]]></Title></Item>
        <Variation><SKU>BAT-1</SKU><VariationTitle>Preta</VariationTitle></Variation>
        <QuantityPurchased>1</QuantityPurchased><TransactionPrice currencyID="USD">5.00</TransactionPrice></Transaction>
    </TransactionArray></Order>`;

type Call = { url: string; headers: Record<string, string>; body: string };
export function fakeEbay(
  responses: (string | { status: number; body: string })[],
  tokenStatus = 200
) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = async (
    url: string,
    init: { headers: Record<string, string>; body: string }
  ) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.includes("/identity/"))
      return {
        status: tokenStatus,
        text: async () =>
          JSON.stringify({ access_token: "tok-secret-123", expires_in: 7200 })
      };
    const next = queue.shift() ?? getOrdersXml("");
    return typeof next === "string"
      ? { status: 200, text: async () => next }
      : { status: next.status, text: async () => next.body };
  };
  const secrets = {
    get: async (ref: string) =>
      ref === "env:MARKETPLACE_EBAY_TEST"
        ? JSON.stringify({
            clientId: "cid",
            clientSecret: "csecret",
            refreshToken: "rtok"
          })
        : null
  };
  return { calls, fetchImpl, secrets };
}
const connection = {
  id: "conn-1",
  provider: "EBAY" as const,
  externalIdentifier: "acct",
  secretReference: "env:MARKETPLACE_EBAY_TEST"
};
const NOW = new Date("2026-10-18T12:00:00.000Z");

describe("parser XML do eBay", () => {
  it("lê entidades, CDATA e atributos; recusa DOCTYPE, profundidade excessiva e XML malformado", () => {
    const root = parseXml(
      `<a x="1 &amp; 2"><b>&lt;ok&gt;</b><c><![CDATA[<raw>]]></c></a>`
    );
    expect(root.attrs.x).toBe("1 & 2");
    expect(textOf(root, "b")).toBe("<ok>");
    expect(textOf(root, "c")).toBe("<raw>");
    expect(() =>
      parseXml(
        `<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>`
      )
    ).toThrow("doctype");
    expect(() => parseXml("<a>".repeat(70) + "</a>".repeat(70))).toThrow(
      "deep"
    );
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a><!-- sem fim <b/></a>")).toThrow("unterminated");
    expect(() => parseXml("<a><?pi sem fim</a>")).toThrow("unterminated");
    expect(() => parseXml("<a></a")).toThrow("unterminated");
  });
});

describe("EbayBuyerAdapter (GetOrders buyer)", () => {
  it("renova o token pelo refresh e envia só no header IAF; normaliza pedido, linhas, tracking e cancelamento", async () => {
    const ebay = fakeEbay([
      getOrdersXml(
        ebayOrder("O-1", {
          trackings: [
            ["USPS", "9400"],
            ["UPS", "1Z9"]
          ]
        }) + ebayOrder("O-2", { status: "Cancelled" })
      )
    ]);
    const adapter = new EbayBuyerAdapter(
      ebay.secrets,
      ebay.fetchImpl,
      () => NOW
    );
    const page = await adapter.listOrders(connection, {
      from: new Date("2026-10-17T12:00:00.000Z")
    });
    const token = ebay.calls[0]!;
    expect(token.url).toContain("/identity/v1/oauth2/token");
    expect(token.body).toContain("grant_type=refresh_token");
    const trading = ebay.calls[1]!;
    expect(trading.headers).toMatchObject({
      "X-EBAY-API-CALL-NAME": "GetOrders",
      "X-EBAY-API-IAF-TOKEN": "tok-secret-123",
      "X-EBAY-API-SITEID": "0"
    });
    expect(trading.body).toContain("<OrderRole>Buyer</OrderRole>");
    expect(trading.body).toContain(
      "<ModTimeFrom>2026-10-17T12:00:00.000Z</ModTimeFrom>"
    );
    expect(page.orders).toHaveLength(2);
    for (const order of page.orders)
      expect(normalizedMarketplaceOrderSchema.safeParse(order).success).toBe(
        true
      );
    const [completed, cancelled] = page.orders;
    expect(completed).toMatchObject({
      externalOrderId: "O-1",
      currency: "USD",
      total: 35.5,
      cancelled: false,
      merchant: { name: "seller_a" }
    });
    expect(completed!.items).toEqual([
      expect.objectContaining({
        externalLineId: "O-1-L1",
        title: "Drone & Cabo",
        quantity: 2,
        unitPrice: 15.25,
        cancelledQuantity: 0
      }),
      expect.objectContaining({
        externalLineId: "222-T2",
        title: "Bateria <extra>",
        sku: "BAT-1",
        variation: "Preta",
        quantity: 1
      })
    ]);
    expect(
      completed!.shipments[0]!.packages.map((pkg) => pkg.trackings[0]!.code)
    ).toEqual(["9400", "1Z9"]);
    expect(cancelled).toMatchObject({ cancelled: true });
    expect(
      cancelled!.items.every(
        (item) =>
          item.cancelledQuantity === item.quantity &&
          item.refundedQuantity === 0
      )
    ).toBe(true);
    // Token em cache: nova chamada não renova.
    await adapter.listOrders(connection, {
      from: new Date("2026-10-17T12:00:00.000Z")
    });
    expect(
      ebay.calls.filter((call) => call.url.includes("/identity/"))
    ).toHaveLength(1);
  });

  it("lê a entrega real (ActualDeliveryTime) no pedido ou na transação; sem ela o envio continua só como enviado", async () => {
    const delivery = (time: string) => `<ShippingServiceSelected><ShippingPackageInfo><ActualDeliveryTime>${time}</ActualDeliveryTime></ShippingPackageInfo></ShippingServiceSelected>`;
    const inTransaction = ebayOrder("D-1", { trackings: [["USPS", "94D1"]] }).replace("</QuantityPurchased>", `</QuantityPurchased>${delivery("2026-10-14T16:20:00.000Z")}`);
    const inOrder = ebayOrder("D-2", { trackings: [["UPS", "1ZD2"]] }).replace("<TransactionArray>", `${delivery("2026-10-15T10:00:00.000Z")}<TransactionArray>`);
    const notDelivered = ebayOrder("D-3", { trackings: [["FEDEX", "FDX3"]] });
    const ebay = fakeEbay([getOrdersXml(inTransaction + inOrder + notDelivered)]);
    const adapter = new EbayBuyerAdapter(ebay.secrets, ebay.fetchImpl, () => NOW);
    const page = await adapter.listOrders(connection, { from: new Date("2026-10-10T00:00:00.000Z") });
    for (const order of page.orders) expect(normalizedMarketplaceOrderSchema.safeParse(order).success).toBe(true);
    const [first, second, third] = page.orders.map((order) => order.shipments[0]!);
    expect(first).toMatchObject({ status: "DELIVERED", shippedAt: "2026-10-11T08:00:00.000Z", deliveredAt: "2026-10-14T16:20:00.000Z" });
    expect(second).toMatchObject({ status: "DELIVERED", deliveredAt: "2026-10-15T10:00:00.000Z" });
    expect(third).toMatchObject({ status: "SHIPPED" });
    expect(third).not.toHaveProperty("deliveredAt");
  });

  it("pagina dentro da janela e, ao concluir janela antiga, abre a próxima com sobreposição até agora", async () => {
    const ebay = fakeEbay([
      getOrdersXml(ebayOrder("O-1"), true),
      getOrdersXml(ebayOrder("O-2")),
      getOrdersXml("")
    ]);
    const adapter = new EbayBuyerAdapter(
      ebay.secrets,
      ebay.fetchImpl,
      () => NOW
    );
    const first = await adapter.listOrders(connection, {
      from: new Date("2026-08-01T00:00:00.000Z")
    });
    expect(first.nextCursor).toBeDefined();
    const second = await adapter.listOrders(connection, {
      cursor: first.nextCursor
    });
    expect(ebay.calls.at(-1)!.body).toContain("<PageNumber>2</PageNumber>");
    // Primeira janela = 30 dias; terminou antes de agora, então há próxima janela.
    expect(second.nextCursor).toBeDefined();
    await adapter.listOrders(connection, { cursor: second.nextCursor });
    const body = ebay.calls.at(-1)!.body;
    expect(body).toContain("<PageNumber>1</PageNumber>");
    expect(body).toContain(
      "<ModTimeFrom>2026-08-30T23:00:00.000Z</ModTimeFrom>"
    );
    // Segue abrindo janelas de até 30 dias até alcançar "agora"; a última encerra sem cursor.
    let cursor: string | undefined = (
      await adapter.listOrders(connection, { cursor: second.nextCursor })
    ).nextCursor;
    let windows = 0;
    while (cursor && windows < 5) {
      cursor = (await adapter.listOrders(connection, { cursor })).nextCursor;
      windows += 1;
    }
    expect(cursor).toBeUndefined();
    expect(ebay.calls.at(-1)!.body).toContain(
      `<ModTimeTo>${NOW.toISOString()}</ModTimeTo>`
    );
  });

  it("traduz falhas sem expor credencial", async () => {
    const expired = fakeEbay([
      getOrdersXml(
        "",
        false,
        "Failure",
        "<Errors><ErrorCode>21917053</ErrorCode><ShortMessage>expired</ShortMessage></Errors>"
      )
    ]);
    await expect(
      new EbayBuyerAdapter(
        expired.secrets,
        expired.fetchImpl,
        () => NOW
      ).listOrders(connection, {})
    ).rejects.toMatchObject({ kind: "AUTHORIZATION_EXPIRED" });
    const limited = fakeEbay([
      getOrdersXml(
        "",
        false,
        "Failure",
        "<Errors><ErrorCode>518</ErrorCode></Errors>"
      )
    ]);
    await expect(
      new EbayBuyerAdapter(
        limited.secrets,
        limited.fetchImpl,
        () => NOW
      ).listOrders(connection, {})
    ).rejects.toMatchObject({ kind: "THROTTLED" });
    const down = fakeEbay([{ status: 503, body: "" }]);
    await expect(
      new EbayBuyerAdapter(down.secrets, down.fetchImpl, () => NOW).listOrders(
        connection,
        {}
      )
    ).rejects.toMatchObject({ kind: "THROTTLED" });
    const garbage = fakeEbay(["<html>oops"]);
    await expect(
      new EbayBuyerAdapter(
        garbage.secrets,
        garbage.fetchImpl,
        () => NOW
      ).listOrders(connection, {})
    ).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
    const refused = fakeEbay([], 400);
    const error = await new EbayBuyerAdapter(
      refused.secrets,
      refused.fetchImpl,
      () => NOW
    )
      .listOrders(connection, {})
      .catch((e) => e);
    expect(error).toMatchObject({ kind: "AUTHORIZATION_EXPIRED" });
    expect(String(error.message)).not.toMatch(/rtok|csecret|tok-secret/);
    const missing = fakeEbay([]);
    await expect(
      new EbayBuyerAdapter(
        missing.secrets,
        missing.fetchImpl,
        () => NOW
      ).listOrders(
        { ...connection, secretReference: "env:MARKETPLACE_OTHER" },
        {}
      )
    ).rejects.toMatchObject({ kind: "AUTHORIZATION_EXPIRED" });
  });
});
