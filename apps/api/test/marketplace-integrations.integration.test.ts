import { createHash } from "node:crypto";
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
let recordMarketplaceEvidence: typeof import("../src/modules/marketplace-integrations/buyer-evidence.service").recordMarketplaceEvidence;
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
  ({ recordMarketplaceEvidence } =
    await import("../src/modules/marketplace-integrations/buyer-evidence.service"));
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
  const candidateWhere = {
    contaExterna: { identificadorExterno: { startsWith: "batch8-" } }
  };
  await prisma.buyerApprovalDecision.deleteMany({
    where: { candidate: candidateWhere }
  });
  await prisma.buyerReconciliationConflict.deleteMany({
    where: { candidate: candidateWhere }
  });
  await prisma.buyerEvidenceLink.deleteMany({
    where: { candidate: candidateWhere }
  });
  await prisma.buyerPurchaseCandidate.deleteMany({ where: candidateWhere });
  await prisma.buyerEvidenceItem.deleteMany({
    where: { evidence: { conexaoMarketplace: { identificadorExterno: { startsWith: "batch8-" } } } }
  });
  await prisma.buyerEvidence.deleteMany({
    where: { conexaoMarketplace: { identificadorExterno: { startsWith: "batch8-" } } }
  });
  const purchases = await prisma.compraImportada.findMany({
    where: { contaExterna: { identificadorExterno: { startsWith: "batch8-" } } },
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
  await prisma.mapeamentoItemProduto.deleteMany({
    where: { itemExterno: { compraImportadaId: { in: purchaseIds } } }
  });
  await prisma.mapeamentoMerchantFornecedor.deleteMany({
    where: { merchantExterno: { externalMerchantId: { startsWith: "merchant-batch8" } } }
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

async function syncOrderWithShipment(
  fixture: Awaited<ReturnType<typeof connectionFixture>>,
  externalOrderId: string,
  shipment: NonNullable<Order["shipments"]>[number],
  idempotencyKey: string
) {
  const identity = await getAuthenticatedUser(fixture.userId);
  const marketplaceOrder = order(externalOrderId, { shipments: [shipment] });
  const adapter = new FakeAdapter("AMAZON", [
    { orders: [marketplaceOrder], nextCursor: `cursor-${idempotencyKey}` },
    { orders: [] }
  ]);
  const result = await syncConnection(
    identity,
    fixture.connectionId,
    { replay: false },
    idempotencyKey,
    disabledRegistry(adapter)
  );
  expect(result.status).toBe("SUCCEEDED");
  return result;
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

async function approveCandidate(
  fixture: Awaited<ReturnType<typeof connectionFixture>>,
  externalOrderId: string
) {
  const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
    where: {
      externalOrderIdNormalized: externalOrderId,
      currentEvidence: { conexaoMarketplaceId: fixture.connectionId }
    }
  });
  expect(await prisma.compraImportada.count({
    where: { conexaoMarketplaceId: fixture.connectionId }
  })).toBe(0);
  const response = await request(fixture.app)
    .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
    .set(bearer(fixture.token))
    .set("idempotency-key", `batch8-approve-${candidate.id}`)
    .send({ decision: "APROVAR", expectedVersion: candidate.version });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    id: candidate.id,
    status: "APROVADA",
    version: candidate.version + 1
  });
  return response.body as { id: string; purchaseId: string; version: number };
}

describe("marketplace integration foundation", () => {
  it("preserva evidência normalizada sem duplicar replay ou depender da ordem dos itens", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "evidence-replay");
    const identity = await getAuthenticatedUser(fixture.userId);
    const original = order("batch8-evidence-1", {
      items: [
        order("batch8-evidence-1").items[0],
        { ...order("batch8-evidence-2").items[0], externalLineId: "line-second" }
      ]
    });
    const sync = (payload: Order, key: string) => syncConnection(
      identity,
      fixture.connectionId,
      { replay: true },
      key,
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }]))
    );
    expect((await sync(original, "batch8-evidence-first")).status).toBe("SUCCEEDED");
    const replay = await sync({ ...original, items: [...original.items].reverse() },
      "batch8-evidence-replay");
    expect(replay).toMatchObject({ status: "SUCCEEDED", conflitos: 0 });
    const evidence = await prisma.buyerEvidence.findMany({
      where: { conexaoMarketplaceId: fixture.connectionId },
      include: { items: true }
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      source: "EBAY_BUYER_API",
      version: 1,
      externalOrderIdNormalized: "batch8-evidence-1",
      dataClassification: "DADOS_COMERCIAIS_NORMALIZADOS"
    });
    expect(evidence[0].items.map((item) => item.externalLineId).sort())
      .toEqual(["line-batch8-evidence-1", "line-second"]);
    expect((evidence[0].normalizedPayload as { items: unknown[] }).items).toHaveLength(2);
    expect(JSON.stringify(evidence[0].normalizedPayload)).not.toContain("secretReference");
    expect(await prisma.buyerPurchaseCandidate.count({
      where: { currentEvidenceId: evidence[0].id }
    })).toBe(1);
    expect(await prisma.compraImportada.count({
      where: { conexaoMarketplaceId: fixture.connectionId }
    })).toBe(0);
    expect(await prisma.auditLog.count({
      where: { entity: "BuyerEvidence", entityId: evidence[0].id,
        action: "BUYER_EVIDENCE_RECORDED" }
    })).toBe(1);
  });

  it("versiona mudança externa sem sobrescrever a evidência original", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "evidence-version");
    const identity = await getAuthenticatedUser(fixture.userId);
    const first = order("batch8-version-1");
    const second = order("batch8-version-1", {
      updatedAt: "2026-07-14T11:00:00.000Z",
      cancelled: true,
      externalStatus: "CANCELLED"
    });
    const results = [];
    for (const [payload, key] of [
      [first, "batch8-version-first"],
      [second, "batch8-version-second"]
    ] as const) {
      results.push(await syncConnection(identity, fixture.connectionId,
        { replay: true }, key,
        disabledRegistry(new FakeAdapter("AMAZON", [{ orders: [payload] }]))
      ));
    }
    expect(results.map((result) => result.status))
      .toEqual(["SUCCEEDED", "SUCCEEDED"]);
    const evidence = await prisma.buyerEvidence.findMany({
      where: { conexaoMarketplaceId: fixture.connectionId },
      orderBy: { version: "asc" }
    });
    expect(evidence.map((row) => row.version)).toEqual([1, 2]);
    expect((evidence[0].normalizedPayload as { cancelled: boolean }).cancelled).toBe(false);
    expect((evidence[1].normalizedPayload as { cancelled: boolean }).cancelled).toBe(true);
    expect(evidence[0].payloadHash).not.toBe(evidence[1].payloadHash);
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { currentEvidence: { conexaoMarketplaceId: fixture.connectionId } }
    });
    expect(candidate).toMatchObject({
      currentEvidenceId: evidence[1].id,
      status: "CANCELADA",
      version: 2,
      compraImportadaId: null
    });
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.body).toMatchObject({
      allowedActions: ["VIEW"], blockedReasons: ["CANCELLED"]
    });
    const approval = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-cancelled-approval")
      .send({ decision: "APROVAR", expectedVersion: 2 });
    expect(approval.status).toBe(409);
  });

  it("não cria conflito por datas ISO equivalentes", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "same-instant");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-same-instant";
    const sync = (payload: Order, key: string) => syncConnection(
      identity, fixture.connectionId, { replay: true }, key,
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }]))
    );
    expect((await sync(order(externalOrderId), "batch8-same-instant-1")).status)
      .toBe("SUCCEEDED");
    expect((await sync(order(externalOrderId, {
      orderedAt: "2026-07-13T10:00:00Z",
      updatedAt: "2026-07-13T12:00:00.000Z"
    }), "batch8-same-instant-2")).status).toBe("SUCCEEDED");
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    expect(candidate.status).toBe("AGUARDANDO_APROVACAO");
    expect(await prisma.buyerReconciliationConflict.count({
      where: { candidateId: candidate.id }
    })).toBe(0);
    expect(await prisma.buyerEvidence.count({
      where: { externalEvidenceId: externalOrderId }
    })).toBe(2);
    const approved = await approveCandidate(fixture, externalOrderId);
    expect((await sync(order(externalOrderId, {
      orderedAt: "2026-07-13T10:00:00Z",
      updatedAt: "2026-07-13T11:00:00Z"
    }), "batch8-same-instant-3")).status).toBe("SUCCEEDED");
    expect(await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
      where: { id: candidate.id }
    })).toMatchObject({ status: "APROVADA", version: approved.version });
    expect(await prisma.buyerEvidence.count({
      where: { externalEvidenceId: externalOrderId }
    })).toBe(2);
    expect(await prisma.buyerReconciliationConflict.count({
      where: { candidateId: candidate.id }
    })).toBe(0);
  });

  it("não bloqueia compra aprovada por grafia de data legada equivalente", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "legacy-date-format");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-legacy-date-format";
    const source = order(externalOrderId);
    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-legacy-date-initial",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [source] }]))
    )).status).toBe("SUCCEEDED");
    const approved = await approveCandidate(fixture, externalOrderId);
    const evidence = await prisma.buyerEvidence.findFirstOrThrow({
      where: { externalEvidenceId: externalOrderId }
    });
    const legacy = { ...source, orderedAt: "2026-07-13T10:00:00Z" };
    await prisma.buyerEvidence.update({
      where: { id: evidence.id },
      data: {
        normalizedPayload: legacy,
        payloadHash: createHash("sha256").update(JSON.stringify(legacy)).digest("hex")
      }
    });
    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-legacy-date-replay",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [source] }]))
    )).status).toBe("SUCCEEDED");
    expect(await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
      where: { id: approved.id }
    })).toMatchObject({ status: "APROVADA", version: approved.version });
    expect(await prisma.buyerEvidence.count({
      where: { externalEvidenceId: externalOrderId }
    })).toBe(1);
    expect(await prisma.buyerReconciliationConflict.count({
      where: { candidateId: approved.id }
    })).toBe(0);
  });

  it("bloqueia aprovação da primeira evidência com moedas divergentes", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "mixed-currency");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-mixed-currency";
    const source = order(externalOrderId);
    const mixed = order(externalOrderId, {
      items: [{ ...source.items[0], currency: "BRL" }]
    });
    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-mixed-currency-sync",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [mixed] }]))
    )).status).toBe("SUCCEEDED");
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    expect(candidate.status).toBe("COM_DIVERGENCIA");
    expect(await prisma.buyerReconciliationConflict.findFirstOrThrow({
      where: { candidateId: candidate.id }
    })).toMatchObject({ type: "CURRENCY", referenceEvidenceId: null });
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.body.allowedActions).not.toContain("APPROVE");
    const approval = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-mixed-currency-approve")
      .send({ decision: "APROVAR", expectedVersion: candidate.version });
    expect(approval.status).toBe(409);
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(0);
  });

  it("rejeita linhas oficiais duplicadas e não oferece aprovação a candidato legado", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "duplicate-lines");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-duplicate-lines";
    const source = order(externalOrderId);
    const duplicate = order(externalOrderId, {
      items: [source.items[0], { ...source.items[0], title: "Outra linha" }]
    });
    const rejected = await syncConnection(identity, fixture.connectionId,
      { replay: true }, "batch8-duplicate-lines-sync",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [duplicate] }])));
    expect(rejected).toMatchObject({ status: "PARTIALLY_SUCCEEDED", conflitos: 1 });
    expect(await prisma.buyerEvidence.count({
      where: { externalEvidenceId: externalOrderId }
    })).toBe(0);

    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-duplicate-lines-valid",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [source] }]))
    )).status).toBe("SUCCEEDED");
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    await prisma.buyerEvidence.update({
      where: { id: candidate.currentEvidenceId },
      data: { normalizedPayload: duplicate }
    });
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.status).toBe(200);
    expect(detail.body.allowedActions).not.toContain("APPROVE");
    expect(detail.body.blockedReasons).toContain("DUPLICATE_EXTERNAL_LINE_ID");
    const approval = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-duplicate-lines-approve")
      .send({ decision: "APROVAR", expectedVersion: candidate.version });
    expect(approval.status).toBe(409);
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(0);
  });

  it("marca quantidade e moeda divergentes antes da aprovação sem perder evidências", async () => {
    for (const kind of ["quantity", "currency"] as const) {
      const fixture = await connectionFixture("EBAY", "SHARED", `buyer-divergence-${kind}`);
      const identity = await getAuthenticatedUser(fixture.userId);
      const externalOrderId = `batch8-divergence-${kind}`;
      const original = order(externalOrderId);
      const changed = order(externalOrderId, kind === "quantity"
        ? { items: [{ ...original.items[0], quantity: 4 }] }
        : { currency: "BRL", items: [{ ...original.items[0], currency: "BRL" }],
          updatedAt: "2026-07-14T11:00:00.000Z" });
      for (const [payload, key] of [
        [original, `batch8-${kind}-first`],
        [changed, `batch8-${kind}-second`]
      ] as const) {
        const run = await syncConnection(identity, fixture.connectionId,
          { replay: true }, key,
          disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }])));
        expect(run.status).toBe("SUCCEEDED");
      }
      const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
        where: { externalOrderIdNormalized: externalOrderId },
        include: { evidenceLinks: { orderBy: { createdAt: "asc" } } }
      });
      expect(candidate.status).toBe("COM_DIVERGENCIA");
      expect(candidate.evidenceLinks.map((link) => link.type))
        .toEqual(["MATCHED", "CONFLICTING"]);
      const conflicts = await prisma.buyerReconciliationConflict.findMany({
        where: { candidateId: candidate.id }
      });
      expect(conflicts.map((conflict) => conflict.type).sort())
        .toEqual(kind === "quantity" ? ["ITEMS", "QUANTITY"] : ["CURRENCY", "ITEMS"]);
      for (const conflict of conflicts) {
        expect(conflict).toMatchObject({
          status: "ABERTO",
          referenceEvidenceId: candidate.evidenceLinks[0].evidenceId,
          evidenceId: candidate.evidenceLinks[1].evidenceId
        });
      }
      const conflictPage = await request(fixture.app)
        .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}/conflicts`)
        .query({ page: 1, limit: 1 })
        .set(bearer(fixture.token));
      expect(conflictPage.status).toBe(200);
      expect(conflictPage.body).toMatchObject({
        page: 1, limit: 1, total: conflicts.length
      });
      expect(conflictPage.body.items).toHaveLength(1);
      if (conflicts.length > 1) {
        const secondPage = await request(fixture.app)
          .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}/conflicts`)
          .query({ page: 2, limit: 1 })
          .set(bearer(fixture.token));
        expect(secondPage.status).toBe(200);
        expect(secondPage.body.items).toHaveLength(1);
        expect(secondPage.body.items[0].id).not.toBe(conflictPage.body.items[0].id);
      }
      const conflictAudit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "BUYER_CONFLICT_DETECTED", entityId: candidate.id }
      });
      expect(conflictAudit.afterData).toMatchObject({
        evidenceId: candidate.evidenceLinks[1].evidenceId,
        types: kind === "quantity" ? ["ITEMS", "QUANTITY"] : ["CURRENCY", "ITEMS"]
      });
      expect(JSON.stringify(conflictAudit.afterData)).not.toContain(externalOrderId);
      expect(await prisma.auditLog.count({
        where: { action: "BUYER_CONFLICTS_LISTED", entityId: candidate.id }
      })).toBe(conflicts.length > 1 ? 2 : 1);
      const evidenceDetails = await Promise.all(candidate.evidenceLinks.map((link) =>
        request(fixture.app)
          .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}/evidence/${link.evidenceId}`)
          .set(bearer(fixture.token))
      ));
      expect(evidenceDetails.map((response) => response.status)).toEqual([200, 200]);
      expect(evidenceDetails.map((response) => response.body.type))
        .toEqual(["MATCHED", "CONFLICTING"]);
      expect(evidenceDetails.map((response) => response.body.order.items[0].quantity))
        .toEqual([original.items[0].quantity, changed.items[0].quantity]);
      expect(evidenceDetails.map((response) => response.body.order.currency))
        .toEqual([original.currency, changed.currency]);
      const accessLogs = await prisma.auditLog.findMany({
        where: {
          action: "BUYER_EVIDENCE_VIEWED",
          entityId: { in: candidate.evidenceLinks.map((link) => link.evidenceId) }
        }
      });
      expect(accessLogs).toHaveLength(2);
      for (const log of accessLogs) {
        expect(log.usuarioId).toBe(fixture.userId);
        expect(log.permissionCode).toBe("BUYER_INGESTION_VISUALIZAR");
        expect(log.afterData).toMatchObject({ candidateId: candidate.id });
        expect(JSON.stringify(log.afterData)).not.toContain(externalOrderId);
      }
      const detail = await request(fixture.app)
        .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
        .set(bearer(fixture.token));
      expect(detail.body).toMatchObject({
        allowedActions: ["VIEW", "REJECT"],
        blockedReasons: ["MATERIAL_DIVERGENCE"]
      });
      const approval = await request(fixture.app)
        .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
        .set(bearer(fixture.token))
        .set("idempotency-key", `batch8-${kind}-approve`)
        .send({ decision: "APROVAR", expectedVersion: candidate.version });
      expect(approval.status).toBe(409);
      const rejection = await request(fixture.app)
        .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
        .set(bearer(fixture.token))
        .set("idempotency-key", `batch8-${kind}-reject`)
        .send({ decision: "REJEITAR", expectedVersion: candidate.version,
          reason: "Divergência material confirmada" });
      expect(rejection.status).toBe(200);
      expect(rejection.body.status).toBe("REJEITADA");
      const followUp = await syncConnection(identity, fixture.connectionId,
        { replay: true }, `batch8-${kind}-follow-up`,
        disabledRegistry(new FakeAdapter("EBAY", [{ orders: [{
          ...changed, updatedAt: "2026-07-14T12:00:00.000Z"
        }] }])));
      expect(followUp.status).toBe("SUCCEEDED");
      const afterFollowUp = await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
        where: { id: candidate.id }
      });
      expect(afterFollowUp.status).toBe("REJEITADA");
      expect(await prisma.buyerReconciliationConflict.count({
        where: { candidateId: candidate.id }
      })).toBe(conflicts.length);
      const reopenedApproval = await request(fixture.app)
        .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
        .set(bearer(fixture.token))
        .set("idempotency-key", `batch8-${kind}-reopened-approve`)
        .send({ decision: "APROVAR", expectedVersion: afterFollowUp.version });
      expect(reopenedApproval.status).toBe(409);
      expect(await prisma.compraImportada.count({
        where: { externalOrderIdNormalizado: externalOrderId }
      })).toBe(0);
    }
  });

  it("bloqueia aprovação quando evidência material divergente chega fora de ordem", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-late-divergence");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-late-divergence";
    const latest = order(externalOrderId, {
      updatedAt: "2026-07-14T12:00:00.000Z",
      items: [{ ...order(externalOrderId).items[0], quantity: 4 }]
    });
    const late = order(externalOrderId);
    const first = await syncConnection(identity, fixture.connectionId,
      { replay: true }, "batch8-late-divergence-first",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [latest] }])));
    expect(first.status).toBe("SUCCEEDED");
    const before = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    const second = await syncConnection(identity, fixture.connectionId,
      { replay: true }, "batch8-late-divergence-second",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [late] }])));
    expect(second.status).toBe("SUCCEEDED");
    const candidate = await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
      where: { id: before.id }, include: { evidenceLinks: true }
    });
    expect(candidate.currentEvidenceId).toBe(before.currentEvidenceId);
    expect(candidate.status).toBe("COM_DIVERGENCIA");
    expect(candidate.evidenceLinks.map((link) => link.type).sort())
      .toEqual(["CONFLICTING", "MATCHED"]);
    const recordedConflicts = await prisma.buyerReconciliationConflict.findMany({
      where: { candidateId: candidate.id }
    });
    expect(recordedConflicts.map((conflict) => conflict.type).sort())
      .toEqual(["ITEMS", "QUANTITY"]);
    expect(recordedConflicts.every((conflict) =>
      conflict.referenceEvidenceId === before.currentEvidenceId)).toBe(true);
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.body).toMatchObject({
      allowedActions: ["VIEW", "REJECT"],
      blockedReasons: ["MATERIAL_DIVERGENCE"]
    });
    const approval = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-late-divergence-approve")
      .send({ decision: "APROVAR", expectedVersion: candidate.version });
    expect(approval.status).toBe(409);
  });

  it("preserva cancelamento mais recente quando chega um snapshot ativo atrasado", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-late-event");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-late-event";
    for (const [payload, key] of [
      [order(externalOrderId, {
        updatedAt: "2026-07-14T12:00:00.000Z", cancelled: true
      }), "batch8-late-cancel"],
      [order(externalOrderId, {
        updatedAt: "2026-07-14T11:00:00.000Z"
      }), "batch8-late-active"]
    ] as const) {
      const result = await syncConnection(identity, fixture.connectionId,
        { replay: true }, key,
        disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }])));
      expect(result.status).toBe("SUCCEEDED");
    }
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId },
      include: { currentEvidence: true, evidenceLinks: true }
    });
    expect(candidate).toMatchObject({ status: "CANCELADA", version: 2 });
    expect(candidate.currentEvidence.sourceOccurredAt.toISOString())
      .toBe("2026-07-14T12:00:00.000Z");
    expect(candidate.evidenceLinks).toHaveLength(2);
    expect(await prisma.buyerReconciliationConflict.findFirstOrThrow({
      where: { candidateId: candidate.id }
    })).toMatchObject({ type: "CANCELLATION_CHANGED", status: "ABERTO" });
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.body.allowedActions).not.toContain("APPROVE");
    const approval = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-late-approve")
      .send({ decision: "APROVAR", expectedVersion: candidate.version });
    expect(approval.status).toBe(409);
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(0);
  });

  it("preserva cancelamento recente com quantidades divergentes em ambas as ordens", async () => {
    for (const cancelFirst of [true, false]) {
      const suffix = cancelFirst ? "cancel-first" : "active-first";
      const fixture = await connectionFixture("EBAY", "SHARED", `buyer-cancel-${suffix}`);
      const identity = await getAuthenticatedUser(fixture.userId);
      const externalOrderId = `batch8-cancel-${suffix}`;
      const originalItem = order(externalOrderId).items[0];
      const cancelled = order(externalOrderId, {
        updatedAt: "2026-07-14T12:00:00.000Z",
        cancelled: true,
        items: [{ ...originalItem, quantity: 4 }]
      });
      const active = order(externalOrderId, {
        updatedAt: "2026-07-14T11:00:00.000Z",
        items: [{ ...originalItem, quantity: 3 }]
      });
      const snapshots = cancelFirst ? [cancelled, active] : [active, cancelled];
      for (const [index, payload] of snapshots.entries()) {
        const run = await syncConnection(identity, fixture.connectionId,
          { replay: true }, `batch8-cancel-${suffix}-${index}`,
          disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }])));
        expect(run.status).toBe("SUCCEEDED");
      }
      const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
        where: { externalOrderIdNormalized: externalOrderId },
        include: { currentEvidence: true, evidenceLinks: true }
      });
      expect(candidate.status).toBe("CANCELADA");
      expect(candidate.currentEvidence.sourceOccurredAt.toISOString())
        .toBe("2026-07-14T12:00:00.000Z");
      expect(candidate.evidenceLinks.map((link) => link.type).sort())
        .toEqual(["CONFLICTING", "MATCHED"]);
      const detail = await request(fixture.app)
        .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
        .set(bearer(fixture.token));
      expect(detail.body).toMatchObject({
        allowedActions: ["VIEW"],
        blockedReasons: ["CANCELLED"]
      });
      const approval = await request(fixture.app)
        .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
        .set(bearer(fixture.token))
        .set("idempotency-key", `batch8-cancel-${suffix}-approve`)
        .send({ decision: "APROVAR", expectedVersion: candidate.version });
      expect(approval.status).toBe(409);
    }
  });

  it("não aprova retroativamente compra legada já criada pela fundação antiga", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-legacy");
    const connection = await prisma.conexaoMarketplace.findUniqueOrThrow({
      where: { id: fixture.connectionId }
    });
    const externalOrderId = "batch8-buyer-legacy";
    const legacy = await prisma.compraImportada.create({
      data: {
        numeroPedido: externalOrderId,
        quantidade: 1,
        plataforma: "EBAY",
        contaExternaId: connection.contaExternaId,
        externalOrderIdNormalizado: externalOrderId,
        conexaoMarketplaceId: connection.id
      }
    });
    const identity = await getAuthenticatedUser(fixture.userId);
    await syncConnection(identity, fixture.connectionId, { replay: false },
      "batch8-buyer-legacy-sync",
      disabledRegistry(new FakeAdapter("EBAY", [
        { orders: [order(externalOrderId)] }
      ])));
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    expect(candidate.compraImportadaId).toBe(legacy.id);
    const result = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-legacy-approve")
      .send({ decision: "APROVAR", expectedVersion: candidate.version });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("legacy_purchase_requires_review");
    expect(await prisma.compraImportada.findMany({
      where: { externalOrderIdNormalizado: externalOrderId }, select: { id: true }
    })).toEqual([{ id: legacy.id }]);
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id }
    })).toBe(0);
    const detail = await request(fixture.app)
      .get(`/imported-purchases/${legacy.id}`).set(bearer(fixture.token));
    expect(detail.body.allowedActions).not.toContain("MATERIALIZE_STORE_ALLOCATION");
    expect(detail.body.blockedReasons).toContainEqual(expect.objectContaining({
      code: "BUYER_EVIDENCE_REVIEW_REQUIRED"
    }));
    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-buyer-legacy-cancel",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [order(externalOrderId, {
        updatedAt: "2026-07-14T12:00:00.000Z",
        cancelled: true
      })] }]))
    )).status).toBe("SUCCEEDED");
    expect(await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
      where: { id: candidate.id }, select: { compraImportadaId: true, status: true }
    })).toEqual({ compraImportadaId: legacy.id, status: "COM_DIVERGENCIA" });
    const materialize = await request(fixture.app)
      .post(`/imported-purchases/${legacy.id}/materializations/${fixture.dronz.id}`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-legacy-materialize")
      .send({ expectedPurchaseVersion: legacy.version });
    expect(materialize.status).toBe(409);
    expect(materialize.body.error).toBe("buyer_evidence_review_required");
    expect(await prisma.materializacaoCompra.count({ where: { compraImportadaId: legacy.id } }))
      .toBe(0);
  });

  it("vincula importação externa posterior ao candidato sem criar aprovação fictícia", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-late-legacy");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-buyer-late-legacy";
    expect((await syncConnection(identity, fixture.connectionId, { replay: true },
      "batch8-buyer-late-legacy-sync",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [order(externalOrderId)] }]))
    )).status).toBe("SUCCEEDED");
    const account = await prisma.conexaoMarketplace.findUniqueOrThrow({
      where: { id: fixture.connectionId }, select: { contaExternaId: true }
    });
    const imported = await request(fixture.app)
      .post("/imported-purchases")
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-late-legacy-import")
      .send({
        plataforma: "EBAY",
        contaExternaId: account.contaExternaId,
        externalOrderId,
        referencia: externalOrderId,
        dataPedido: "2026-07-14T10:00:00.000Z",
        moeda: "USD",
        origem: "API",
        itens: [{ titulo: "Legacy item", quantidade: 1, precoUnitario: 10, moeda: "USD" }]
      });
    expect(imported.status).toBe(201);
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    expect(candidate).toMatchObject({
      compraImportadaId: imported.body.id,
      status: "AGUARDANDO_APROVACAO",
      version: 2
    });
    expect(await prisma.buyerApprovalDecision.count({ where: { candidateId: candidate.id } }))
      .toBe(0);
    const detail = await request(fixture.app)
      .get(`/imported-purchases/${imported.body.id}`).set(bearer(fixture.token));
    expect(detail.body.allowedActions).not.toContain("ASSIGN_TO_STORE");
    expect(detail.body.allowedActions).not.toContain("MATERIALIZE_STORE_ALLOCATION");
    const list = await request(fixture.app)
      .get("/imported-purchases").set(bearer(fixture.token));
    expect(list.body.items.find((entry: { id: string }) => entry.id === imported.body.id)
      .allowedActions).not.toContain("ASSIGN_TO_STORE");
    const importedItem = await prisma.compraImportadaItem.findFirstOrThrow({
      where: { compraImportadaId: imported.body.id }
    });
    const assign = await request(fixture.app)
      .put(`/imported-purchases/items/${importedItem.id}/assignments/${fixture.dronz.id}`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-late-legacy-assign")
      .send({ quantidade: 1, expectedVersion: importedItem.version });
    expect(assign.status).toBe(409);
    expect(assign.body.error).toBe("buyer_evidence_review_required");
    expect(await prisma.atribuicaoCompraItem.count({ where: { itemExternoId: importedItem.id } }))
      .toBe(0);
    const blocked = await request(fixture.app)
      .post(`/imported-purchases/${imported.body.id}/materializations/${fixture.dronz.id}`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-late-legacy-materialize")
      .send({ expectedPurchaseVersion: imported.body.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("buyer_evidence_review_required");
  });

  it("exige decisão humana para criar compra e mostra ações da versão atual", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-approval");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-buyer-approval";
    const sync = await syncConnection(
      identity, fixture.connectionId, { replay: false },
      "batch8-buyer-approval-sync",
      disabledRegistry(new FakeAdapter("EBAY", [
        { orders: [order(externalOrderId)] }
      ]))
    );
    expect(sync).toMatchObject({ status: "SUCCEEDED", criados: 1 });
    const list = await request(fixture.app)
      .get("/integrations/marketplaces/buyer-candidates")
      .set(bearer(fixture.token));
    expect(list.status).toBe(200);
    const candidate = list.body.items.find(
      (entry: { externalOrderId: string }) => entry.externalOrderId === externalOrderId
    );
    expect(candidate).toMatchObject({
      status: "AGUARDANDO_APROVACAO",
      version: 1,
      purchaseId: null,
      allowedActions: ["VIEW", "APPROVE", "REJECT"],
      blockedReasons: []
    });
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(0);
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.status).toBe(200);
    expect(detail.body.evidenceVersions).toHaveLength(1);

    const approved = await approveCandidate(fixture, externalOrderId);
    const purchase = await prisma.compraImportada.findUniqueOrThrow({
      where: { id: approved.purchaseId }, include: { itens: true }
    });
    expect(purchase).toMatchObject({
      plataforma: "EBAY",
      contaExternaId: candidate.account.id,
      externalOrderIdNormalizado: externalOrderId,
      conexaoMarketplaceId: fixture.connectionId
    });
    expect(purchase.itens).toHaveLength(1);
    const approvedDetail = await request(fixture.app)
      .get(`/imported-purchases/${purchase.id}`).set(bearer(fixture.token));
    expect(approvedDetail.body.allowedActions).toContain("ASSIGN_TO_STORE");
    const assigned = await request(fixture.app)
      .put(`/imported-purchases/items/${purchase.itens[0].id}/assignments/${fixture.dronz.id}`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-buyer-approved-assign")
      .send({ quantidade: 2, expectedVersion: purchase.itens[0].version });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ lojaId: fixture.dronz.id, quantidade: 2 });
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id, decision: "APROVAR" }
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: "BUYER_CANDIDATE_APPROVED", entityId: candidate.id }
    })).toBe(1);
  });

  it("bloqueia materialização após cancelamento externo de compra aprovada", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-cancel-after-approval");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-cancel-after-approval";
    const sync = (payload: Order, key: string) => syncConnection(
      identity, fixture.connectionId, { replay: true }, key,
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }]))
    );
    expect((await sync(order(externalOrderId), "batch8-cancel-initial")).status)
      .toBe("SUCCEEDED");
    const approved = await approveCandidate(fixture, externalOrderId);
    const purchase = await prisma.compraImportada.findUniqueOrThrow({
      where: { id: approved.purchaseId }, include: { itens: true }
    });
    const product = await prisma.produto.findFirstOrThrow({
      where: { lojaId: fixture.dronz.id, ativo: true }
    });
    const supplier = await prisma.fornecedor.findFirstOrThrow({
      where: { lojaId: fixture.dronz.id, ativo: true }
    });
    await prisma.atribuicaoCompraItem.create({ data: {
      itemExternoId: purchase.itens[0].id, lojaId: fixture.dronz.id,
      quantidade: 2, atribuidoPorId: fixture.userId
    } });
    await prisma.mapeamentoItemProduto.create({ data: {
      itemExternoId: purchase.itens[0].id, lojaId: fixture.dronz.id,
      produtoId: product.id, revisadoPorId: fixture.userId
    } });
    await prisma.mapeamentoMerchantFornecedor.create({ data: {
      merchantExternoId: purchase.merchantExternoId!, lojaId: fixture.dronz.id,
      fornecedorId: supplier.id, revisadoPorId: fixture.userId
    } });
    const before = await request(fixture.app)
      .get(`/imported-purchases/${purchase.id}`).set(bearer(fixture.token));
    expect(before.body.allowedActions).toContain("MATERIALIZE_STORE_ALLOCATION");

    expect((await sync(order(externalOrderId, {
      updatedAt: "2026-07-14T12:00:00.000Z", cancelled: true
    }), "batch8-cancel-later")).status).toBe("SUCCEEDED");
    const after = await request(fixture.app)
      .get(`/imported-purchases/${purchase.id}`).set(bearer(fixture.token));
    expect(after.body.allowedActions).not.toContain("MATERIALIZE_STORE_ALLOCATION");
    expect(after.body.blockedReasons).toContainEqual(expect.objectContaining({
      code: "BUYER_EVIDENCE_REVIEW_REQUIRED"
    }));
    const blocked = await request(fixture.app)
      .post(`/imported-purchases/${purchase.id}/materializations/${fixture.dronz.id}`)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-cancel-materialize")
      .send({ expectedPurchaseVersion: purchase.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("buyer_evidence_review_required");
    expect(await prisma.pedidoCompra.count({
      where: { compraImportadaId: purchase.id }
    })).toBe(0);
    expect((await prisma.compraImportada.findUniqueOrThrow({
      where: { id: purchase.id }
    })).payloadSnapshot).toMatchObject({ cancelled: false });
  });

  it("rejeita candidato com motivo, preserva evidência e não cria compra", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "buyer-reject");
    const identity = await getAuthenticatedUser(fixture.userId);
    await syncConnection(identity, fixture.connectionId, { replay: false },
      "batch8-buyer-reject-sync",
      disabledRegistry(new FakeAdapter("AMAZON", [
        { orders: [order("batch8-buyer-reject")] }
      ])));
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: "batch8-buyer-reject" }
    });
    const endpoint = `/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`;
    const withoutReason = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-reject-no-reason")
      .send({ decision: "REJEITAR", expectedVersion: 1 });
    expect(withoutReason.status).toBe(400);
    const rejected = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token))
      .set("idempotency-key", "batch8-reject-with-reason")
      .send({ decision: "REJEITAR", expectedVersion: 1, reason: "Compra pessoal" });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      status: "REJEITADA", allowedActions: ["VIEW"], purchaseId: null
    });
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: "batch8-buyer-reject" }
    })).toBe(0);
    expect(await prisma.buyerEvidence.count({
      where: { externalOrderIdNormalized: "batch8-buyer-reject" }
    })).toBe(1);
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id, reason: "Compra pessoal" }
    })).toBe(1);
  });

  it("nega acesso global a usuário local sem permissão buyer", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-rbac");
    const identity = await getAuthenticatedUser(fixture.userId);
    await syncConnection(identity, fixture.connectionId, { replay: false },
      "batch8-buyer-rbac-sync",
      disabledRegistry(new FakeAdapter("EBAY", [
        { orders: [order("batch8-buyer-rbac")] }
      ])));
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: "batch8-buyer-rbac" }
    });
    const token = await scopedUser(fixture,
      ["INTEGRACAO_MARKETPLACE_VISUALIZAR"], [fixture.dronz.id]);
    const list = await request(fixture.app)
      .get("/integrations/marketplaces/buyer-candidates")
      .set(bearer(token));
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(token));
    const evidence = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}/evidence/${candidate.currentEvidenceId}`)
      .set(bearer(token));
    const conflicts = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}/conflicts`)
      .set(bearer(token));
    const approve = await request(fixture.app)
      .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
      .set(bearer(token))
      .set("idempotency-key", "batch8-buyer-rbac-approve")
      .send({ decision: "APROVAR", expectedVersion: 1 });
    expect([list.status, detail.status, evidence.status, conflicts.status, approve.status])
      .toEqual([403, 403, 403, 403, 403]);
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id }
    })).toBe(0);
  });

  it("só revela evidência vinculada ao candidato solicitado", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-evidence-scope");
    const identity = await getAuthenticatedUser(fixture.userId);
    const firstOrderId = "batch8-evidence-scope-first";
    const secondOrderId = "batch8-evidence-scope-second";
    const run = await syncConnection(identity, fixture.connectionId,
      { replay: true }, "batch8-evidence-scope-sync",
      disabledRegistry(new FakeAdapter("EBAY", [{
        orders: [order(firstOrderId), order(secondOrderId)]
      }])));
    expect(run.status).toBe("SUCCEEDED");
    const first = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: firstOrderId }
    });
    const second = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: secondOrderId }
    });
    const path = `/integrations/marketplaces/buyer-candidates/${first.id}/evidence/`;
    const linked = await request(fixture.app)
      .get(`${path}${first.currentEvidenceId}`)
      .set(bearer(fixture.token));
    expect(linked.status).toBe(200);
    expect(linked.body.order.externalOrderId).toBe(firstOrderId);
    expect(linked.body).not.toHaveProperty("secretReference");
    const foreign = await request(fixture.app)
      .get(`${path}${second.currentEvidenceId}`)
      .set(bearer(fixture.token));
    expect(foreign.status).toBe(404);
    const list = await request(fixture.app)
      .get("/integrations/marketplaces/buyer-candidates")
      .set(bearer(fixture.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((candidate: { id: string }) => candidate.id))
      .toContain(first.id);
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${first.id}`)
      .set(bearer(fixture.token));
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(first.id);
    const accessLogs = await prisma.auditLog.findMany({
      where: {
        usuarioId: fixture.userId,
        action: { in: ["BUYER_CANDIDATES_LISTED", "BUYER_CANDIDATE_VIEWED"] }
      }
    });
    expect(accessLogs.map((log) => log.action).sort())
      .toEqual(["BUYER_CANDIDATES_LISTED", "BUYER_CANDIDATE_VIEWED"]);
    for (const log of accessLogs) {
      expect(log.permissionCode).toBe("BUYER_INGESTION_VISUALIZAR");
      expect(JSON.stringify(log.afterData)).not.toContain(firstOrderId);
    }
    setAuditFailureForTests((entry) =>
      ["BUYER_CANDIDATES_LISTED", "BUYER_CANDIDATE_VIEWED", "BUYER_EVIDENCE_VIEWED"]
        .includes(entry.action));
    try {
      const withoutAudit = await request(fixture.app)
        .get(`${path}${first.currentEvidenceId}`)
        .set(bearer(fixture.token));
      expect(withoutAudit.status).toBe(500);
      expect(withoutAudit.body).not.toHaveProperty("order");
      const listWithoutAudit = await request(fixture.app)
        .get("/integrations/marketplaces/buyer-candidates")
        .set(bearer(fixture.token));
      expect(listWithoutAudit.status).toBe(500);
      expect(listWithoutAudit.body).not.toHaveProperty("items");
      const detailWithoutAudit = await request(fixture.app)
        .get(`/integrations/marketplaces/buyer-candidates/${first.id}`)
        .set(bearer(fixture.token));
      expect(detailWithoutAudit.status).toBe(500);
      expect(detailWithoutAudit.body).not.toHaveProperty("order");
    } finally {
      setAuditFailureForTests();
    }
  });

  it("rejeita versão stale e chave reutilizada com payload diferente", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-version");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-buyer-version";
    for (const [payload, key] of [
      [order(externalOrderId), "batch8-buyer-version-first"],
      [order(externalOrderId, { updatedAt: "2026-07-14T11:00:00.000Z" }),
        "batch8-buyer-version-second"]
    ] as const) {
      await syncConnection(identity, fixture.connectionId, { replay: true }, key,
        disabledRegistry(new FakeAdapter("EBAY", [{ orders: [payload] }])));
    }
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    expect(candidate.version).toBe(2);
    const endpoint = `/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`;
    const stale = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token)).set("idempotency-key", "batch8-buyer-version-stale")
      .send({ decision: "APROVAR", expectedVersion: 1 });
    expect(stale.status).toBe(409);
    const body = { decision: "APROVAR", expectedVersion: 2 };
    const approved = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token)).set("idempotency-key", "batch8-buyer-version-ok")
      .send(body);
    expect(approved.status).toBe(200);
    const replay = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token)).set("idempotency-key", "batch8-buyer-version-ok")
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.decisionId).toBe(approved.body.decisionId);
    const mismatch = await request(fixture.app).post(endpoint)
      .set(bearer(fixture.token)).set("idempotency-key", "batch8-buyer-version-ok")
      .send({ ...body, reason: "Outro payload" });
    expect(mismatch.status).toBe(409);
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(1);
  });

  it("serializa duas aprovações concorrentes sem duplicar compra", async () => {
    const fixture = await connectionFixture("AMAZON", "SHARED", "buyer-concurrent");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-buyer-concurrent";
    await syncConnection(identity, fixture.connectionId, { replay: false },
      "batch8-buyer-concurrent-sync",
      disabledRegistry(new FakeAdapter("AMAZON", [
        { orders: [order(externalOrderId)] }
      ])));
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    const endpoint = `/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`;
    const decisions = await Promise.all(["first", "second"].map((suffix) =>
      request(fixture.app).post(endpoint)
        .set(bearer(fixture.token))
        .set("idempotency-key", `batch8-buyer-concurrent-${suffix}`)
        .send({ decision: "APROVAR", expectedVersion: 1 })
    ));
    expect(decisions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(1);
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id }
    })).toBe(1);
  });

  it("faz rollback da aprovação, compra e merchant se auditoria crítica falhar", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "buyer-audit");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-buyer-audit";
    await syncConnection(identity, fixture.connectionId, { replay: false },
      "batch8-buyer-audit-sync",
      disabledRegistry(new FakeAdapter("EBAY", [
        { orders: [order(externalOrderId)] }
      ])));
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    setAuditFailureForTests((entry) => entry.action === "BUYER_CANDIDATE_APPROVED");
    try {
      const result = await request(fixture.app)
        .post(`/integrations/marketplaces/buyer-candidates/${candidate.id}/decision`)
        .set(bearer(fixture.token))
        .set("idempotency-key", "batch8-buyer-audit-approve")
        .send({ decision: "APROVAR", expectedVersion: 1 });
      expect(result.status).toBe(500);
    } finally {
      setAuditFailureForTests();
    }
    expect(await prisma.compraImportada.count({
      where: { externalOrderIdNormalizado: externalOrderId }
    })).toBe(0);
    expect(await prisma.merchantExterno.count({
      where: { externalMerchantId: `merchant-${externalOrderId}` }
    })).toBe(0);
    expect(await prisma.buyerApprovalDecision.count({
      where: { candidateId: candidate.id }
    })).toBe(0);
    expect(await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
      where: { id: candidate.id }, select: { status: true, version: true }
    })).toEqual({ status: "AGUARDANDO_APROVACAO", version: 1 });
  });

  it("reverte evidência e itens se a auditoria crítica falhar", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "evidence-audit");
    const identity = await getAuthenticatedUser(fixture.userId);
    setAuditFailureForTests((entry) => entry.action === "BUYER_EVIDENCE_RECORDED");
    try {
      const result = await syncConnection(identity, fixture.connectionId,
        { replay: false }, "batch8-evidence-audit",
        disabledRegistry(new FakeAdapter("EBAY", [{ orders: [order("batch8-audit-evidence")] }]))
      );
      expect(result.status).toBe("PARTIALLY_SUCCEEDED");
      expect(result.falhas).toBe(1);
      expect(await prisma.buyerEvidence.count({
        where: { conexaoMarketplaceId: fixture.connectionId }
      })).toBe(0);
      expect(await prisma.compraImportada.count({
        where: { conexaoMarketplaceId: fixture.connectionId }
      })).toBe(0);
    } finally {
      setAuditFailureForTests();
    }
  });

  it("não avança o cursor além de uma página com evidência não persistida", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "cursor-retry");
    const identity = await getAuthenticatedUser(fixture.userId);
    const firstId = "batch8-cursor-first";
    const failedId = "batch8-cursor-failed";
    const laterId = "batch8-cursor-later";
    const adapter = new FakeAdapter("EBAY", [
      { orders: [order(firstId)], nextCursor: "cursor-page-2" },
      { orders: [order(failedId)], nextCursor: "cursor-page-3" },
      { orders: [order(laterId)] }
    ]);
    setAuditFailureForTests((entry) => entry.action === "BUYER_EVIDENCE_RECORDED" &&
      JSON.stringify(entry.after).includes(failedId));
    try {
      const partial = await syncConnection(identity, fixture.connectionId,
        { replay: false }, "batch8-cursor-partial", disabledRegistry(adapter));
      expect(partial).toMatchObject({
        status: "PARTIALLY_SUCCEEDED", falhas: 1, cursorFinal: "cursor-page-2"
      });
      expect(adapter.calls.map((call) => call.cursor))
        .toEqual([undefined, "cursor-page-2"]);
      expect(await prisma.conexaoMarketplace.findUniqueOrThrow({
        where: { id: fixture.connectionId }, select: { cursorSincronizacao: true }
      })).toEqual({ cursorSincronizacao: "cursor-page-2" });
      expect(await prisma.buyerEvidence.count({
        where: { externalOrderIdNormalized: { in: [failedId, laterId] } }
      })).toBe(0);
    } finally {
      setAuditFailureForTests();
    }
    const retry = new FakeAdapter("EBAY", [
      { orders: [order(failedId)], nextCursor: "cursor-page-3" },
      { orders: [order(laterId)] }
    ]);
    const recovered = await syncConnection(identity, fixture.connectionId,
      { replay: false }, "batch8-cursor-recovered", disabledRegistry(retry));
    expect(recovered.status).toBe("SUCCEEDED");
    expect(retry.calls.map((call) => call.cursor))
      .toEqual(["cursor-page-2", "cursor-page-3"]);
    expect(await prisma.buyerEvidence.count({
      where: { externalOrderIdNormalized: { in: [firstId, failedId, laterId] } }
    })).toBe(3);
  });

  it("reverte evidência e conflito se a auditoria da divergência falhar", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "conflict-audit");
    const identity = await getAuthenticatedUser(fixture.userId);
    const externalOrderId = "batch8-conflict-audit";
    const original = order(externalOrderId);
    const first = await syncConnection(identity, fixture.connectionId,
      { replay: true }, "batch8-conflict-audit-first",
      disabledRegistry(new FakeAdapter("EBAY", [{ orders: [original] }])));
    expect(first.status).toBe("SUCCEEDED");
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId }
    });
    setAuditFailureForTests((entry) => entry.action === "BUYER_CONFLICT_DETECTED");
    try {
      const changed = order(externalOrderId, {
        updatedAt: "2026-07-14T11:00:00.000Z",
        items: [{ ...original.items[0], quantity: 4 }]
      });
      const second = await syncConnection(identity, fixture.connectionId,
        { replay: true }, "batch8-conflict-audit-second",
        disabledRegistry(new FakeAdapter("EBAY", [{ orders: [changed] }])));
      expect(second.status).toBe("PARTIALLY_SUCCEEDED");
      expect(second.falhas).toBe(1);
      expect(await prisma.buyerReconciliationConflict.count({
        where: { candidateId: candidate.id }
      })).toBe(0);
      expect(await prisma.buyerEvidence.count({
        where: { externalOrderIdNormalized: externalOrderId }
      })).toBe(1);
      expect(await prisma.buyerPurchaseCandidate.findUniqueOrThrow({
        where: { id: candidate.id }, select: { status: true, version: true }
      })).toEqual({ status: "AGUARDANDO_APROVACAO", version: 1 });
    } finally {
      setAuditFailureForTests();
    }
  });

  it("trata grafias Unicode equivalentes como replay da mesma evidência", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "evidence-unicode");
    const connection = await prisma.conexaoMarketplace.findUniqueOrThrow({
      where: { id: fixture.connectionId }
    });
    const original = order("batch8-unicode-Ç");
    const decomposed = order("batch8-unicode-Ç".normalize("NFD"));
    const input = {
      provider: "EBAY" as const,
      accountId: connection.contaExternaId,
      connectionId: fixture.connectionId,
      actorId: fixture.userId,
      correlationId: "batch8-unicode-correlation"
    };
    const first = await recordMarketplaceEvidence({ ...input, order: original });
    const replay = await recordMarketplaceEvidence({ ...input, order: decomposed });
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ id: first.id, version: 1, created: false });
    expect(await prisma.buyerEvidence.count({
      where: { conexaoMarketplaceId: fixture.connectionId }
    })).toBe(1);
  });

  it("retry concorrente da mesma evidência retorna a única versão persistida", async () => {
    const fixture = await connectionFixture("EBAY", "SHARED", "evidence-concurrent");
    const payload = {
      provider: "EBAY" as const,
      accountId: (await prisma.conexaoMarketplace.findUniqueOrThrow({
        where: { id: fixture.connectionId }
      })).contaExternaId,
      connectionId: fixture.connectionId,
      order: order("batch8-concurrent-evidence"),
      actorId: fixture.userId,
      correlationId: "batch8-evidence-concurrent"
    };
    const results = await Promise.all([
      recordMarketplaceEvidence(payload),
      recordMarketplaceEvidence(payload)
    ]);
    expect(results.map((result) => result.id)).toEqual([results[0].id, results[0].id]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await prisma.buyerEvidence.count({
      where: { conexaoMarketplaceId: fixture.connectionId }
    })).toBe(1);
  });

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

    await approveCandidate(fixture, "batch8-unicode-Ç-01");

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
    const candidates = await prisma.buyerPurchaseCandidate.findMany({
      where: { externalOrderIdNormalized: "SAME-ORDER-ID" }
    });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.provider))).toEqual(
      new Set(["AMAZON", "EBAY"])
    );
    expect(candidates.every((candidate) => candidate.compraImportadaId === null))
      .toBe(true);
    const evidence = await prisma.buyerEvidence.findMany({
      where: { externalEvidenceId: "SAME-ORDER-ID" }
    });
    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map((row) => row.source)))
      .toEqual(new Set(["AMAZON_BUSINESS_API", "EBAY_BUYER_API"]));
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
    const candidates = await prisma.buyerPurchaseCandidate.findMany({
      where: {
        currentEvidence: {
          conexaoMarketplaceId: { in: [first.connectionId, second.connectionId] }
        }
      }
    });
    expect(candidates).toHaveLength(3);
    expect(
      candidates.filter(
        (candidate) => candidate.externalOrderIdNormalized === "Case-Order"
      )
    ).toHaveLength(2);
    expect(
      candidates.some(
        (candidate) => candidate.externalOrderIdNormalized === "case-order"
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
    await approveCandidate(fixture, "batch8-shared-order");
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
    await approveCandidate(fixture, "batch8-dedicated-order");
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

describe("evidência de tracking após aprovação humana", () => {
  it("ressincronização parcial preserva a nova evidência sem alterar tracking aprovado", async () => {
    const fixture = await connectionFixture(
      "AMAZON",
      "SHARED",
      `track-partial-${Date.now()}`
    );
    const externalOrderId = `batch8-track-partial-${Date.now()}`;

    await syncOrderWithShipment(
      fixture,
      externalOrderId,
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
              }
            ]
          }
        ]
      },
      `batch8-track-partial-sync1-${Date.now()}`
    );
    await approveCandidate(fixture, externalOrderId);

    // ressincronização posterior só relata o tracking atual — não repete
    // OLD-CODE no payload, como um marketplace real faria
    await syncOrderWithShipment(
      fixture,
      externalOrderId,
      {
        externalShipmentId: "shipment-1",
        status: "SHIPPED",
        updatedAt: "2026-07-13T13:00:00.000Z",
        packages: [
          {
            externalPackageId: "package-1",
            carrier: "UPS",
            trackings: [
              {
                code: "NEW-CODE",
                carrier: "UPS",
                replacesCode: "OLD-CODE",
                updatedAt: "2026-07-13T13:00:00.000Z"
              }
            ]
          }
        ]
      },
      `batch8-track-partial-sync2-${Date.now()}`
    );

    const purchase = await prisma.compraImportada.findFirstOrThrow({
      where: { externalOrderIdOriginal: externalOrderId },
      include: {
        enviosExternos: { include: { pacotes: { include: { trackings: true } } } }
      }
    });
    const trackings = purchase.enviosExternos[0].pacotes.flatMap(
      (externalPackage) => externalPackage.trackings
    );
    expect(trackings).toMatchObject([{ codigo: "OLD-CODE", ativo: true }]);
    const candidate = await prisma.buyerPurchaseCandidate.findFirstOrThrow({
      where: { externalOrderIdNormalized: externalOrderId },
      include: { evidenceLinks: true }
    });
    expect(candidate.status).toBe("COM_DIVERGENCIA");
    expect(candidate.evidenceLinks).toHaveLength(2);
    expect(await prisma.buyerReconciliationConflict.findFirstOrThrow({
      where: { candidateId: candidate.id }
    })).toMatchObject({ type: "POST_APPROVAL_EVIDENCE", status: "ABERTO" });
    const detail = await request(fixture.app)
      .get(`/integrations/marketplaces/buyer-candidates/${candidate.id}`)
      .set(bearer(fixture.token));
    expect(detail.body).toMatchObject({
      allowedActions: ["VIEW"],
      blockedReasons: ["NEW_EVIDENCE_REQUIRES_RECONCILIATION"]
    });
    expect(await prisma.buyerEvidence.count({
      where: { externalOrderIdNormalized: externalOrderId }
    })).toBe(2);
  });

  it("payload atrasado não reativa tracking substituído nem altera o histórico aprovado", async () => {
    const fixture = await connectionFixture(
      "AMAZON",
      "SHARED",
      `track-late-${Date.now()}`
    );
    const externalOrderId = `batch8-track-late-${Date.now()}`;

    await syncOrderWithShipment(
      fixture,
      externalOrderId,
      {
        externalShipmentId: "shipment-1",
        status: "SHIPPED",
        updatedAt: "2026-07-13T13:00:00.000Z",
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
          }
        ]
      },
      `batch8-track-late-sync1-${Date.now()}`
    );
    await approveCandidate(fixture, externalOrderId);

    // evento atrasado sobre o código antigo chega depois — não pode
    // reativá-lo nem apagar a linhagem já registrada em NEW-CODE
    await syncOrderWithShipment(
      fixture,
      externalOrderId,
      {
        externalShipmentId: "shipment-1",
        status: "SHIPPED",
        updatedAt: "2026-07-13T12:30:00.000Z",
        packages: [
          {
            externalPackageId: "package-1",
            carrier: "UPS",
            trackings: [
              {
                code: "OLD-CODE",
                carrier: "UPS",
                status: "IN_TRANSIT_STALE",
                updatedAt: "2026-07-13T12:30:00.000Z"
              }
            ]
          }
        ]
      },
      `batch8-track-late-sync2-${Date.now()}`
    );

    const purchase = await prisma.compraImportada.findFirstOrThrow({
      where: { externalOrderIdOriginal: externalOrderId },
      include: {
        enviosExternos: { include: { pacotes: { include: { trackings: true } } } }
      }
    });
    const trackings = purchase.enviosExternos[0].pacotes.flatMap(
      (externalPackage) => externalPackage.trackings
    );
    const oldRow = trackings.find((tracking) => tracking.codigo === "OLD-CODE")!;
    const newRow = trackings.find((tracking) => tracking.codigo === "NEW-CODE")!;
    expect(oldRow.ativo).toBe(false);
    expect(newRow.ativo).toBe(true);
    expect(newRow.substituiTrackingId).toBe(oldRow.id);
    expect(oldRow.statusExterno).not.toBe("IN_TRANSIT_STALE");
    expect(await prisma.buyerEvidence.count({
      where: { externalOrderIdNormalized: externalOrderId }
    })).toBe(2);
  });

  it("reprocessar a mesma sincronização não altera o histórico de tracking", async () => {
    const fixture = await connectionFixture(
      "AMAZON",
      "SHARED",
      `track-idem-${Date.now()}`
    );
    const externalOrderId = `batch8-track-idem-${Date.now()}`;
    const shipment: NonNullable<Order["shipments"]>[number] = {
      externalShipmentId: "shipment-1",
      status: "SHIPPED",
      updatedAt: "2026-07-13T13:00:00.000Z",
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
        }
      ]
    };

    await syncOrderWithShipment(
      fixture,
      externalOrderId,
      shipment,
      `batch8-track-idem-sync1-${Date.now()}`
    );
    await approveCandidate(fixture, externalOrderId);
    const before = await prisma.compraImportada.findFirstOrThrow({
      where: { externalOrderIdOriginal: externalOrderId },
      include: {
        enviosExternos: { include: { pacotes: { include: { trackings: true } } } }
      }
    });
    const beforeTrackings = before.enviosExternos[0].pacotes
      .flatMap((externalPackage) => externalPackage.trackings)
      .map((tracking) => ({
        id: tracking.id,
        codigo: tracking.codigo,
        ativo: tracking.ativo,
        substituiTrackingId: tracking.substituiTrackingId
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    // reprocessa exatamente o mesmo payload, como um replay de poll/webhook
    await syncOrderWithShipment(
      fixture,
      externalOrderId,
      shipment,
      `batch8-track-idem-sync2-${Date.now()}`
    );
    const after = await prisma.compraImportada.findFirstOrThrow({
      where: { externalOrderIdOriginal: externalOrderId },
      include: {
        enviosExternos: { include: { pacotes: { include: { trackings: true } } } }
      }
    });
    const afterTrackings = after.enviosExternos[0].pacotes
      .flatMap((externalPackage) => externalPackage.trackings)
      .map((tracking) => ({
        id: tracking.id,
        codigo: tracking.codigo,
        ativo: tracking.ativo,
        substituiTrackingId: tracking.substituiTrackingId
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    expect(afterTrackings).toEqual(beforeTrackings);
  });
});
