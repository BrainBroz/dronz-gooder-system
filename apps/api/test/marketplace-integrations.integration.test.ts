import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";
process.env.NODE_ENV = "test";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
let getAuthenticatedUser: typeof import("../src/modules/auth/auth.service").getAuthenticatedUser;
let createConnection: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.service").createConnection;
let syncConnection: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.service").syncConnection;
let connectionAllowsStore: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.service").connectionAllowsStore;
let AmazonMarketplaceAdapter: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.adapters").AmazonMarketplaceAdapter;
let EbayMarketplaceAdapter: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.adapters").EbayMarketplaceAdapter;
let MarketplaceAdapterError: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.adapters").MarketplaceAdapterError;
let translateMarketplaceAdapterError: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.adapters").translateMarketplaceAdapterError;
let EnvironmentSecretProvider: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.secrets").EnvironmentSecretProvider;
let setAuditFailureForTests: typeof import("../src/modules/operations/operations.persistence").setAuditFailureForTests;

type Adapter =
  import("../src/modules/marketplace-integrations/marketplace-integrations.types").MarketplaceAdapter;
type Order =
  import("../src/modules/marketplace-integrations/marketplace-integrations.types").NormalizedMarketplaceOrder;
type OrderPage =
  import("../src/modules/marketplace-integrations/marketplace-integrations.types").MarketplaceOrderPage;

class FakeAdapter implements Adapter {
  readonly capabilities = [
    "LIST_ORDERS",
    "GET_ORDER",
    "LIST_ORDER_ITEMS",
    "LIST_SHIPMENTS",
    "INCREMENTAL_CURSOR"
  ] as const;
  calls: Array<{ cursor?: string; from?: Date; to?: Date }> = [];

  constructor(
    readonly provider: "AMAZON" | "EBAY",
    private readonly pages: OrderPage[],
    private readonly pause?: { entered: () => void; release: Promise<void> },
    private readonly failure?: Error
  ) {}

  async authorize(): Promise<never> {
    throw new Error("not used by foundation tests");
  }

  async refreshAuthorization(): Promise<never> {
    throw new Error("not used by foundation tests");
  }

  async listOrders(
    _connection: Parameters<Adapter["listOrders"]>[0],
    input: Parameters<Adapter["listOrders"]>[1]
  ) {
    this.calls.push(input);
    if (this.pause) {
      this.pause.entered();
      await this.pause.release;
    }
    if (this.failure) throw this.failure;
    return this.pages[this.calls.length - 1] ?? { orders: [] };
  }

  async getOrder(
    _connection: Parameters<Adapter["getOrder"]>[0],
    externalOrderId: string
  ) {
    const order = this.pages
      .flatMap((page) => page.orders)
      .find((item) => item.externalOrderId === externalOrderId);
    if (!order) throw new Error("order not found");
    return order;
  }
}

const disabledRegistry = (adapter: Adapter) => ({
  AMAZON:
    adapter.provider === "AMAZON" ? adapter : new FakeAdapter("AMAZON", []),
  EBAY: adapter.provider === "EBAY" ? adapter : new FakeAdapter("EBAY", [])
});

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  ({ getAuthenticatedUser } = await import("../src/modules/auth/auth.service"));
  ({ createConnection, syncConnection, connectionAllowsStore } =
    await import("../src/modules/marketplace-integrations/marketplace-integrations.service"));
  ({ setAuditFailureForTests } =
    await import("../src/modules/operations/operations.persistence"));
  ({
    AmazonMarketplaceAdapter,
    EbayMarketplaceAdapter,
    MarketplaceAdapterError,
    translateMarketplaceAdapterError
  } =
    await import("../src/modules/marketplace-integrations/marketplace-integrations.adapters"));
  ({ EnvironmentSecretProvider } =
    await import("../src/modules/marketplace-integrations/marketplace-integrations.secrets"));
});

async function cleanup() {
  const purchases = await prisma.compraImportada.findMany({
    where: { conexaoMarketplaceId: { not: null } },
    select: { id: true }
  });
  const purchaseIds = purchases.map((purchase) => purchase.id);
  await prisma.auditLog.deleteMany({
    where: { origin: "API_MARKETPLACE_INTEGRATIONS" }
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { idempotencyKey: { startsWith: "batch8-" } }
  });
  await prisma.eventoTrackingExterno.deleteMany({
    where: {
      tracking: {
        pacote: { envio: { compraImportadaId: { in: purchaseIds } } }
      }
    }
  });
  await prisma.trackingExterno.deleteMany({
    where: { pacote: { envio: { compraImportadaId: { in: purchaseIds } } } }
  });
  await prisma.pacoteExterno.deleteMany({
    where: { envio: { compraImportadaId: { in: purchaseIds } } }
  });
  await prisma.envioExterno.deleteMany({
    where: { compraImportadaId: { in: purchaseIds } }
  });
  await prisma.atribuicaoCompraItem.deleteMany({
    where: { itemExterno: { compraImportadaId: { in: purchaseIds } } }
  });
  await prisma.compraImportadaItem.deleteMany({
    where: { compraImportadaId: { in: purchaseIds } }
  });
  await prisma.conflitoCompra.deleteMany({
    where: { compraImportadaId: { in: purchaseIds } }
  });
  await prisma.compraImportada.deleteMany({
    where: { id: { in: purchaseIds } }
  });
  await prisma.execucaoSincronizacao.deleteMany({
    where: { conexao: { identificadorExterno: { startsWith: "batch8-" } } }
  });
  await prisma.conexaoMarketplace.deleteMany({
    where: { identificadorExterno: { startsWith: "batch8-" } }
  });
  await prisma.contaExterna.deleteMany({
    where: { identificadorExterno: { startsWith: "batch8-" } }
  });
  await prisma.merchantExterno.deleteMany({
    where: { externalMerchantId: { startsWith: "merchant-batch8" } }
  });
  await prisma.usuario.deleteMany({
    where: { email: { startsWith: "batch8-scoped-" } }
  });
  await prisma.perfil.deleteMany({
    where: { code: { startsWith: "BATCH8_SCOPED_" } }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function session() {
  const app = createApp();
  const response = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  expect(response.status).toBe(200);
  return {
    app,
    token: response.body.accessToken as string,
    userId: response.body.user.id as string,
    dronz: response.body.stores.find(
      (store: { slug: string }) => store.slug === "dronz"
    ) as { id: string },
    gooder: response.body.stores.find(
      (store: { slug: string }) => store.slug === "gooder"
    ) as { id: string }
  };
}

async function connectionFixture(
  provider: "AMAZON" | "EBAY" = "AMAZON",
  scope: "SHARED" | "STORE_DEDICATED" = "SHARED",
  suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  dedicatedStore: "dronz" | "gooder" = "dronz"
) {
  const current = await session();
  const account = await request(current.app)
    .post("/imported-purchases/accounts")
    .set(bearer(current.token))
    .set("idempotency-key", `batch8-account-${suffix}`)
    .send({
      plataforma: provider,
      identificadorExterno: `batch8-account-${suffix}`,
      nomeExibicao: `${provider} ${suffix}`,
      origemIntegracao: "API"
    });
  expect(account.status).toBe(201);
  const response = await request(current.app)
    .post("/integrations/marketplaces/connections")
    .set(bearer(current.token))
    .set("idempotency-key", `batch8-connection-${suffix}`)
    .send({
      provider,
      contaExternaId: account.body.id,
      nome: `Conexão ${provider}`,
      identificadorExterno: `batch8-connection-${suffix}`,
      escopo: scope,
      lojaPermitidaId:
        scope === "STORE_DEDICATED" ? current[dedicatedStore].id : undefined,
      secretReference: `env:MARKETPLACE_${provider}_${suffix
        .replace(/[^A-Za-z0-9]/g, "_")
        .toUpperCase()}`
    });
  expect(response.status).toBe(201);
  await prisma.conexaoMarketplace.update({
    where: { id: response.body.id },
    data: {
      status: "ACTIVE",
      capabilities: [
        "LIST_ORDERS",
        "GET_ORDER",
        "LIST_ORDER_ITEMS",
        "LIST_SHIPMENTS",
        "INCREMENTAL_CURSOR"
      ]
    }
  });
  return { ...current, connectionId: response.body.id as string };
}

async function scopedUser(
  currentSession: Awaited<ReturnType<typeof session>>,
  permissionCodes: string[],
  storeIds: string[],
  suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
) {
  const permissions = await prisma.permissao.findMany({
    where: { code: { in: permissionCodes } }
  });
  const profile = await prisma.perfil.create({
    data: {
      code: `BATCH8_SCOPED_${suffix}`,
      name: `Batch8 Scoped ${suffix}`,
      permissoes: {
        create: permissions.map((permission) => ({
          permissaoId: permission.id
        }))
      }
    }
  });
  const seededAdmin = await prisma.usuario.findUniqueOrThrow({
    where: { email: "admin@example.com" },
    select: { passwordHash: true }
  });
  const email = `batch8-scoped-${suffix}@example.com`;
  await prisma.usuario.create({
    data: {
      name: `Batch8 Scoped ${suffix}`,
      email,
      passwordHash: seededAdmin.passwordHash,
      lojas: { create: storeIds.map((lojaId) => ({ lojaId })) },
      perfis: { create: { perfilId: profile.id } }
    }
  });
  const login = await request(currentSession.app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

function order(externalOrderId: string, overrides: Partial<Order> = {}): Order {
  return {
    externalOrderId,
    reference: externalOrderId,
    orderedAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T11:00:00.000Z",
    currency: "USD",
    total: 50,
    externalStatus: "OPEN",
    cancelled: false,
    merchant: {
      externalMerchantId: `merchant-${externalOrderId}`,
      name: "Loja Externa"
    },
    items: [
      {
        externalLineId: `line-${externalOrderId}`,
        title: "Produto externo",
        sku: `sku-${externalOrderId}`,
        quantity: 5,
        cancelledQuantity: 1,
        refundedQuantity: 1,
        unitPrice: 10,
        currency: "USD"
      }
    ],
    shipments: [],
    ...overrides
  };
}

describe("marketplace integration foundation", () => {
  it("mantém adapters reais desabilitados e segredos fora do contrato", async () => {
    const amazon = new AmazonMarketplaceAdapter();
    const ebay = new EbayMarketplaceAdapter();
    await expect(
      amazon.listOrders(
        { id: "x", provider: "AMAZON", externalIdentifier: "x" },
        {}
      )
    ).rejects.toMatchObject({ code: "marketplace_provider_not_configured" });
    await expect(
      ebay.listOrders(
        { id: "x", provider: "EBAY", externalIdentifier: "x" },
        {}
      )
    ).rejects.toMatchObject({ code: "marketplace_provider_not_configured" });

    process.env.MARKETPLACE_TEST_ONLY = "secret-value";
    const secrets = new EnvironmentSecretProvider();
    await expect(secrets.get("env:MARKETPLACE_TEST_ONLY")).resolves.toBe(
      "secret-value"
    );
    await expect(secrets.get("env:OTHER_SECRET")).resolves.toBeNull();
    expect(
      translateMarketplaceAdapterError(
        new MarketplaceAdapterError("AUTHORIZATION_EXPIRED", "expired")
      )
    ).toMatchObject({ code: "marketplace_authorization_expired", status: 401 });
    expect(
      translateMarketplaceAdapterError(
        new MarketplaceAdapterError("THROTTLED", "slow down", 1000)
      )
    ).toMatchObject({ code: "marketplace_provider_throttled", status: 429 });
    expect(
      translateMarketplaceAdapterError(
        new MarketplaceAdapterError("PERMANENT", "provider failure")
      )
    ).toMatchObject({
      code: "marketplace_provider_permanent_error",
      status: 502
    });
    delete process.env.MARKETPLACE_TEST_ONLY;
  });

  it("cria conexões compartilhadas e dedicadas sem expor referência secreta", async () => {
    const shared = await connectionFixture("AMAZON", "SHARED", "shared-safe");
    const amazonDronz = await connectionFixture(
      "AMAZON",
      "STORE_DEDICATED",
      "amazon-dronz-safe"
    );
    const amazonGooder = await connectionFixture(
      "AMAZON",
      "STORE_DEDICATED",
      "amazon-gooder-safe",
      "gooder"
    );
    const ebayShared = await connectionFixture(
      "EBAY",
      "SHARED",
      "ebay-shared-safe"
    );
    const dedicated = await connectionFixture(
      "EBAY",
      "STORE_DEDICATED",
      "dedicated-safe"
    );
    const ebayGooder = await connectionFixture(
      "EBAY",
      "STORE_DEDICATED",
      "ebay-gooder-safe",
      "gooder"
    );
    const list = await request(shared.app)
      .get("/integrations/marketplaces/connections")
      .set(bearer(shared.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(6);
    const serialized = JSON.stringify(list.body);
    expect(serialized).not.toContain("secretReference");
    expect(serialized).not.toContain("MARKETPLACE_AMAZON_SHARED_SAFE");
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: shared.connectionId, scope: "SHARED" }),
        expect.objectContaining({ id: amazonDronz.connectionId }),
        expect.objectContaining({
          id: amazonGooder.connectionId,
          allowedStore: expect.objectContaining({ id: shared.gooder.id })
        }),
        expect.objectContaining({
          id: ebayShared.connectionId,
          scope: "SHARED"
        }),
        expect.objectContaining({
          id: dedicated.connectionId,
          scope: "STORE_DEDICATED",
          allowedStore: expect.objectContaining({ id: dedicated.dronz.id })
        }),
        expect.objectContaining({ id: ebayGooder.connectionId })
      ])
    );
    expect(
      connectionAllowsStore(
        { escopo: "SHARED", lojaPermitidaId: null },
        shared.gooder.id
      )
    ).toBe(true);
    expect(
      connectionAllowsStore(
        { escopo: "STORE_DEDICATED", lojaPermitidaId: dedicated.dronz.id },
        dedicated.gooder.id
      )
    ).toBe(false);
    await expect(
      prisma.conexaoMarketplace.update({
        where: { id: dedicated.connectionId },
        data: { escopo: "SHARED" }
      })
    ).rejects.toBeDefined();
  });

  it("reverte criação quando a auditoria crítica falha", async () => {
    const current = await session();
    const account = await request(current.app)
      .post("/imported-purchases/accounts")
      .set(bearer(current.token))
      .set("idempotency-key", "batch8-audit-account")
      .send({
        plataforma: "AMAZON",
        identificadorExterno: "batch8-audit-account",
        nomeExibicao: "Audit account",
        origemIntegracao: "API"
      });
    expect(account.status).toBe(201);
    const identity = await getAuthenticatedUser(current.userId);
    setAuditFailureForTests(
      (auditInput) => auditInput.action === "MARKETPLACE_CONNECTION_CREATED"
    );
    try {
      await expect(
        createConnection(
          identity,
          {
            provider: "AMAZON",
            contaExternaId: account.body.id,
            nome: "Rollback connection",
            identificadorExterno: "batch8-audit-rollback",
            escopo: "SHARED"
          },
          "batch8-audit-rollback",
          disabledRegistry(new FakeAdapter("AMAZON", []))
        )
      ).rejects.toThrow("forced audit failure");
    } finally {
      setAuditFailureForTests();
    }
    expect(
      await prisma.conexaoMarketplace.count({
        where: { identificadorExterno: "batch8-audit-rollback" }
      })
    ).toBe(0);
  });

  it("sincroniza pedido, cancelamento, reembolso, pacotes e múltiplos trackings", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "sync-amazon");
    const marketplaceOrder = order("batch8-unicode-Ç-01", {
      shipments: [
        {
          externalShipmentId: "shipment-1",
          status: "SHIPPED",
          updatedAt: "2026-07-13T12:00:00.000Z",
          packages: [
            {
              externalPackageId: "package-1",
              carrier: "UPS",
              trackings: [
                {
                  code: "OLD-CODE",
                  carrier: "UPS",
                  updatedAt: "2026-07-13T12:00:00.000Z"
                },
                {
                  code: "NEW-CODE",
                  carrier: "UPS",
                  replacesCode: "OLD-CODE",
                  updatedAt: "2026-07-13T13:00:00.000Z"
                }
              ]
            },
            {
              externalPackageId: "package-2",
              trackings: []
            }
          ]
        }
      ]
    });
    const adapter = new FakeAdapter("AMAZON", [
      { orders: [marketplaceOrder], nextCursor: "cursor-1" },
      { orders: [] }
    ]);
    const identity = await getAuthenticatedUser(fixture.userId);
    const result = await syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-sync-amazon",
      disabledRegistry(adapter)
    );
    expect(result.status).toBe("SUCCEEDED");
    expect(result.processados).toBe(1);
    expect(result.cursorFinal).toBe("cursor-1");
    expect(adapter.calls.map((call) => call.cursor)).toEqual([
      undefined,
      "cursor-1"
    ]);

    const purchase = await prisma.compraImportada.findFirstOrThrow({
      where: { conexaoMarketplaceId: fixture.connectionId },
      include: {
        itens: true,
        enviosExternos: {
          include: { pacotes: { include: { trackings: true } } }
        }
      }
    });
    expect(purchase.externalOrderIdOriginal).toBe("batch8-unicode-Ç-01");
    expect(purchase.itens[0]).toMatchObject({
      quantidade: 5,
      quantidadeCancelada: 1,
      quantidadeReembolsada: 1
    });
    expect(purchase.enviosExternos[0].pacotes).toHaveLength(2);
    const trackings = purchase.enviosExternos[0].pacotes.flatMap(
      (externalPackage) => externalPackage.trackings
    );
    expect(trackings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: "OLD-CODE", ativo: false }),
        expect.objectContaining({ codigo: "NEW-CODE", ativo: true })
      ])
    );
  });

  it("isola a identidade do mesmo pedido por provider e conta", async () => {
    const amazon = await connectionFixture("AMAZON", "SHARED", "same-amazon");
    const ebay = await connectionFixture("EBAY", "SHARED", "same-ebay");
    const amazonIdentity = await getAuthenticatedUser(amazon.userId);
    const ebayIdentity = await getAuthenticatedUser(ebay.userId);
    await syncConnection(
      amazonIdentity,
      amazon.connectionId,
      { replay: false },
      "batch8-same-amazon",
      disabledRegistry(
        new FakeAdapter("AMAZON", [{ orders: [order("SAME-ORDER-ID")] }])
      )
    );
    await syncConnection(
      ebayIdentity,
      ebay.connectionId,
      { replay: false },
      "batch8-same-ebay",
      disabledRegistry(
        new FakeAdapter("EBAY", [{ orders: [order("SAME-ORDER-ID")] }])
      )
    );
    const purchases = await prisma.compraImportada.findMany({
      where: { externalOrderIdNormalizado: "SAME-ORDER-ID" }
    });
    expect(purchases).toHaveLength(2);
    expect(new Set(purchases.map((purchase) => purchase.plataforma))).toEqual(
      new Set(["AMAZON", "EBAY"])
    );
  });

  it("isola a mesma referência em duas contas do mesmo provider e preserva case", async () => {
    const first = await connectionFixture("AMAZON", "SHARED", "account-one");
    const second = await connectionFixture("AMAZON", "SHARED", "account-two");
    const identity = await getAuthenticatedUser(first.userId);
    await syncConnection(
      identity,
      first.connectionId,
      { replay: false },
      "batch8-account-one-sync",
      disabledRegistry(
        new FakeAdapter("AMAZON", [
          { orders: [order("Case-Order"), order("case-order")] }
        ])
      )
    );
    await syncConnection(
      identity,
      second.connectionId,
      { replay: false },
      "batch8-account-two-sync",
      disabledRegistry(
        new FakeAdapter("AMAZON", [{ orders: [order("Case-Order")] }])
      )
    );
    const purchases = await prisma.compraImportada.findMany({
      where: {
        conexaoMarketplaceId: { in: [first.connectionId, second.connectionId] }
      }
    });
    expect(purchases).toHaveLength(3);
    expect(
      purchases.filter(
        (purchase) => purchase.externalOrderIdNormalizado === "Case-Order"
      )
    ).toHaveLength(2);
    expect(
      purchases.some(
        (purchase) => purchase.externalOrderIdNormalizado === "case-order"
      )
    ).toBe(true);
  });

  it("permite split Dronz/Gooder apenas em conexão compartilhada", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "shared-split");
    const identity = await getAuthenticatedUser(fixture.userId);
    await syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-shared-import",
      disabledRegistry(
        new FakeAdapter("EBAY", [{ orders: [order("batch8-shared-order")] }])
      )
    );
    let item = await prisma.compraImportadaItem.findFirstOrThrow({
      where: { compraImportada: { conexaoMarketplaceId: fixture.connectionId } }
    });
    const dronz = await request(fixture.app)
      .put(
        `/imported-purchases/items/${item.id}/assignments/${fixture.dronz.id}`
      )
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-shared-dronz")
      .send({ quantidade: 1, expectedVersion: item.version });
    expect(dronz.status).toBe(200);
    item = await prisma.compraImportadaItem.findUniqueOrThrow({
      where: { id: item.id }
    });
    const gooder = await request(fixture.app)
      .put(
        `/imported-purchases/items/${item.id}/assignments/${fixture.gooder.id}`
      )
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-shared-gooder")
      .send({ quantidade: 1, expectedVersion: item.version });
    expect(gooder.status).toBe(200);
    const assignments = await prisma.atribuicaoCompraItem.findMany({
      where: { itemExternoId: item.id }
    });
    expect(new Set(assignments.map((assignment) => assignment.lojaId))).toEqual(
      new Set([fixture.dronz.id, fixture.gooder.id])
    );
  });

  it("rejeita resposta normalizada inválida antes de persistir dados", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "invalid-page");
    const identity = await getAuthenticatedUser(fixture.userId);
    const invalidOrder = order("batch8-invalid-order", {
      updatedAt: "invalid-date"
    });
    await expect(
      syncConnection(
        identity,
        fixture.connectionId,
        { replay: false },
        "batch8-invalid-response",
        disabledRegistry(
          new FakeAdapter("AMAZON", [{ orders: [invalidOrder] }])
        )
      )
    ).rejects.toMatchObject({ code: "invalid_marketplace_response" });
    expect(
      await prisma.compraImportada.count({
        where: { conexaoMarketplaceId: fixture.connectionId }
      })
    ).toBe(0);
  });

  it("faz retry idempotente e rejeita a mesma chave com janela diferente", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "idempotent");
    const adapter = new FakeAdapter("AMAZON", [{ orders: [] }]);
    const identity = await getAuthenticatedUser(fixture.userId);
    const first = await syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-idempotent-sync",
      disabledRegistry(adapter)
    );
    const replay = await syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-idempotent-sync",
      disabledRegistry(adapter)
    );
    expect(replay.id).toBe(first.id);
    expect(adapter.calls).toHaveLength(1);
    await expect(
      syncConnection(
        identity,
        fixture.connectionId,
        { replay: true },
        "batch8-idempotent-sync",
        disabledRegistry(adapter)
      )
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("protege sincronização concorrente da mesma conexão", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "concurrent");
    const identity = await getAuthenticatedUser(fixture.userId);
    let notifyEntered = () => undefined;
    const entered = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    let releaseFirst = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstAdapter = new FakeAdapter("AMAZON", [{ orders: [] }], {
      entered: notifyEntered,
      release
    });
    const secondAdapter = new FakeAdapter("AMAZON", [{ orders: [] }]);
    const first = syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-concurrent-one",
      disabledRegistry(firstAdapter)
    );
    await entered;
    const second = syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-concurrent-two",
      disabledRegistry(secondAdapter)
    );
    const secondResult = await second.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    );
    releaseFirst();
    const firstResult = await first.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    );
    const results = [firstResult, secondResult];
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "marketplace_sync_in_progress" })
    });
  });

  it("registra falha sanitizada, histórico e auditoria sem segredos", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "failed-sync");
    const identity = await getAuthenticatedUser(fixture.userId);
    const adapter = new FakeAdapter(
      "EBAY",
      [],
      undefined,
      new Error("provider leaked credential=forbidden")
    );
    await expect(
      syncConnection(
        identity,
        fixture.connectionId,
        { replay: false },
        "batch8-failed-sync",
        disabledRegistry(adapter)
      )
    ).rejects.toMatchObject({ code: "external_provider_error" });

    const history = await request(fixture.app)
      .get(
        `/integrations/marketplaces/connections/${fixture.connectionId}/sync-runs`
      )
      .set(bearer(fixture.token));
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({
      status: "FAILED",
      erroSanitizado: "external_provider_error"
    });
    expect(JSON.stringify(history.body)).not.toContain("forbidden");
    const audits = await prisma.auditLog.findMany({
      where: { entityId: history.body.items[0].id }
    });
    expect(audits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "MARKETPLACE_SYNC_STARTED",
        "MARKETPLACE_SYNC_FAILED"
      ])
    );
    expect(JSON.stringify(audits)).not.toContain("forbidden");
  });

  it("não permite atribuir uma conexão dedicada à outra loja", async () => {
    const fixture = await connectionFixture(
      "AMAZON",
      "STORE_DEDICATED",
      "dedicated-assignment"
    );
    const identity = await getAuthenticatedUser(fixture.userId);
    await syncConnection(
      identity,
      fixture.connectionId,
      { replay: false },
      "batch8-dedicated-import",
      disabledRegistry(
        new FakeAdapter("AMAZON", [
          { orders: [order("batch8-dedicated-order")] }
        ])
      )
    );
    const item = await prisma.compraImportadaItem.findFirstOrThrow({
      where: { compraImportada: { conexaoMarketplaceId: fixture.connectionId } }
    });
    const response = await request(fixture.app)
      .put(
        `/imported-purchases/items/${item.id}/assignments/${fixture.gooder.id}`
      )
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-dedicated-wrong-store")
      .send({ quantidade: 1, expectedVersion: item.version });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "marketplace_connection_store_mismatch"
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: "MARKETPLACE_STORE_ASSIGNMENT_REJECTED",
          entityId: item.id,
          lojaId: fixture.gooder.id
        }
      })
    ).toBe(1);
  });
});

describe("visibilidade de conexões SHARED por RBAC (correção Codex)", () => {
  it("usuário restrito a uma loja continua vendo conexões SHARED mesmo filtrando por lojaId", async () => {
    const shared = await connectionFixture(
      "AMAZON",
      "SHARED",
      `shared-vis-${Date.now()}`
    );
    const dedicated = await connectionFixture(
      "EBAY",
      "STORE_DEDICATED",
      `dedic-dronz-${Date.now()}`,
      "dronz"
    );
    const token = await scopedUser(
      shared,
      ["INTEGRACAO_MARKETPLACE_VISUALIZAR"],
      [shared.dronz.id]
    );
    const response = await request(shared.app)
      .get("/integrations/marketplaces/connections")
      .query({ lojaId: shared.dronz.id })
      .set(bearer(token));
    expect(response.status).toBe(200);
    const ids = response.body.map((connection: { id: string }) => connection.id);
    expect(ids).toContain(shared.connectionId);
    expect(ids).toContain(dedicated.connectionId);
  });

  it("gestor Dronz não recebe conexão dedicada exclusiva da Gooder", async () => {
    const base = await connectionFixture(
      "AMAZON",
      "SHARED",
      `base-${Date.now()}`
    );
    const gooderOnly = await connectionFixture(
      "EBAY",
      "STORE_DEDICATED",
      `dedic-gooder-${Date.now()}`,
      "gooder"
    );
    const token = await scopedUser(
      base,
      ["INTEGRACAO_MARKETPLACE_VISUALIZAR"],
      [base.dronz.id]
    );
    const response = await request(base.app)
      .get("/integrations/marketplaces/connections")
      .set(bearer(token));
    expect(response.status).toBe(200);
    const ids = response.body.map((connection: { id: string }) => connection.id);
    expect(ids).toContain(base.connectionId);
    expect(ids).not.toContain(gooderOnly.connectionId);
  });

  it("não confia em lojaId de uma loja à qual o usuário não pertence", async () => {
    const base = await connectionFixture(
      "AMAZON",
      "SHARED",
      `notrust-${Date.now()}`
    );
    const token = await scopedUser(
      base,
      ["INTEGRACAO_MARKETPLACE_VISUALIZAR"],
      [base.dronz.id]
    );
    const response = await request(base.app)
      .get("/integrations/marketplaces/connections")
      .query({ lojaId: base.gooder.id })
      .set(bearer(token));
    expect(response.status).toBe(403);
  });
});
