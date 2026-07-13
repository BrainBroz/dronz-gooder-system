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

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
let setAuditFailureForTests: typeof import("../src/modules/operations/operations.persistence").setAuditFailureForTests;

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  ({ setAuditFailureForTests } = await import("../src/modules/operations/operations.persistence"));
});

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: { origin: "API_COMPRAS_UNIFICADAS" }
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { operation: { contains: "EXTERNAL" } }
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { operation: { contains: "MATERIALIZE" } }
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { operation: { contains: "MANUAL" } }
  });
  await prisma.materializacaoCompraItem.deleteMany();
  await prisma.materializacaoCompra.deleteMany();
  await prisma.pedidoCompraItem.deleteMany({
    where: { pedido: { numeroPedido: { startsWith: "EXT-" } } }
  });
  await prisma.pedidoCompra.deleteMany({
    where: { numeroPedido: { startsWith: "EXT-" } }
  });
  await prisma.atribuicaoCompraItem.deleteMany();
  await prisma.mapeamentoItemProduto.deleteMany();
  await prisma.mapeamentoMerchantFornecedor.deleteMany();
  await prisma.conflitoCompra.deleteMany();
  await prisma.compraImportadaItem.deleteMany({
    where: {
      compraImportada: { externalOrderIdOriginal: { startsWith: "batch5-" } }
    }
  });
  await prisma.compraImportada.deleteMany({
    where: { externalOrderIdOriginal: { startsWith: "batch5-" } }
  });
  await prisma.compraImportada.deleteMany({
    where: {
      origem: "MANUAL",
      referenciaPesquisavel: { startsWith: "BATCH5-" }
    }
  });
  await prisma.contaExterna.deleteMany({
    where: { identificadorExterno: { startsWith: "batch5-" } }
  });
  await prisma.merchantExterno.deleteMany({
    where: { nomeNormalizado: { startsWith: "batch5-" } }
  });
  await prisma.produto.deleteMany({
    where: { slug: { startsWith: "batch5-" } }
  });
  await prisma.categoria.deleteMany({
    where: { slug: { startsWith: "batch5-" } }
  });
  await prisma.fornecedor.deleteMany({
    where: { nome: { startsWith: "Batch5" } }
  });
  await prisma.usuario.deleteMany({
    where: { email: { startsWith: "batch5-" } }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function auth() {
  const app = createApp();
  const response = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  expect(response.status).toBe(200);
  return {
    app,
    token: response.body.accessToken as string,
    dronz: response.body.stores.find(
      (store: { slug: string }) => store.slug === "dronz"
    ) as { id: string },
    gooder: response.body.stores.find(
      (store: { slug: string }) => store.slug === "gooder"
    ) as { id: string }
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixtures() {
  const session = await auth();
  const suffix = Date.now();
  const [catD, catG] = await Promise.all([
    prisma.categoria.create({
      data: {
        lojaId: session.dronz.id,
        nome: "Batch5 D",
        slug: `batch5-d-${suffix}`
      }
    }),
    prisma.categoria.create({
      data: {
        lojaId: session.gooder.id,
        nome: "Batch5 G",
        slug: `batch5-g-${suffix}`
      }
    })
  ]);
  const [productD, productG, supplierD, supplierG] = await Promise.all([
    prisma.produto.create({
      data: {
        lojaId: session.dronz.id,
        categoriaId: catD.id,
        codigo: 900000 + (suffix % 10000),
        nome: "Batch5 Produto D",
        slug: `batch5-product-d-${suffix}`,
        precoVenda: 0,
        markup: 25
      }
    }),
    prisma.produto.create({
      data: {
        lojaId: session.gooder.id,
        categoriaId: catG.id,
        codigo: 910000 + (suffix % 10000),
        nome: "Batch5 Produto G",
        slug: `batch5-product-g-${suffix}`,
        precoVenda: 0,
        markup: 25
      }
    }),
    prisma.fornecedor.create({
      data: {
        lojaId: session.dronz.id,
        nome: `Batch5 Supplier D ${suffix}`,
        ativo: true
      }
    }),
    prisma.fornecedor.create({
      data: {
        lojaId: session.gooder.id,
        nome: `Batch5 Supplier G ${suffix}`,
        ativo: true
      }
    })
  ]);
  return { ...session, productD, productG, supplierD, supplierG };
}

async function createStaging() {
  const f = await fixtures();
  const account = await request(f.app)
    .post("/imported-purchases/accounts")
    .set(bearer(f.token))
    .set("idempotency-key", "batch5-account-key")
    .send({
      plataforma: "AMAZON",
      identificadorExterno: "batch5-account",
      nomeExibicao: "Conta Batch 5",
      origemIntegracao: "API"
    });
  const merchant = await request(f.app)
    .post("/imported-purchases/merchants")
    .set(bearer(f.token))
    .set("idempotency-key", "batch5-merchant-key")
    .send({
      plataforma: "AMAZON",
      externalMerchantId: "batch5-merchant",
      nome: "  Batch5   Merchant  "
    });
  expect(account.status).toBe(201);
  expect(merchant.status).toBe(201);
  const payload = {
    plataforma: "AMAZON",
    contaExternaId: account.body.id,
    merchantExternoId: merchant.body.id,
    externalOrderId: "batch5-order",
    referencia: "BATCH5-ORDER",
    dataPedido: "2026-07-12T12:00:00.000Z",
    moeda: "USD",
    origem: "API",
    itens: [
      {
        externalLineId: "line-1",
        titulo: "Produto externo",
        quantidade: 5,
        precoUnitario: 10,
        moeda: "USD"
      }
    ]
  };
  const purchase = await request(f.app)
    .post("/imported-purchases")
    .set(bearer(f.token))
    .set("idempotency-key", "batch5-import-key")
    .send(payload);
  expect(purchase.status).toBe(201);
  const detail = await request(f.app)
    .get(`/imported-purchases/${purchase.body.id}`)
    .set(bearer(f.token));
  expect(detail.status).toBe(200);
  return {
    ...f,
    account: account.body,
    merchant: merchant.body,
    purchase: detail.body,
    payload
  };
}

describe("unified purchases backend", () => {
  it("cadastra conta e merchant sem aceitar credenciais e reaplica idempotência", async () => {
    const f = await fixtures();
    const accountPayload = {
      plataforma: "AMAZON",
      identificadorExterno: "batch5-account",
      nomeExibicao: "Conta",
      origemIntegracao: "API"
    };
    const first = await request(f.app)
      .post("/imported-purchases/accounts")
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-account-key")
      .send(accountPayload);
    const replay = await request(f.app)
      .post("/imported-purchases/accounts")
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-account-key")
      .send(accountPayload);
    const conflict = await request(f.app)
      .post("/imported-purchases/accounts")
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-account-key")
      .send({ ...accountPayload, nomeExibicao: "Outra" });
    const secret = await request(f.app)
      .post("/imported-purchases/accounts")
      .set(bearer(f.token))
      .send({ ...accountPayload, password: "forbidden" });
    expect(first.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(conflict.status).toBe(409);
    expect(secret.status).toBe(400);
    expect(JSON.stringify(first.body)).not.toContain("password");
  });

  it("importa pedido idempotente e detecta payload divergente", async () => {
    const f = await createStaging();
    const replay = await request(f.app)
      .post("/imported-purchases")
      .set(bearer(f.token))
      .send(f.payload);
    const conflict = await request(f.app)
      .post("/imported-purchases")
      .set(bearer(f.token))
      .send({
        ...f.payload,
        itens: [{ ...f.payload.itens[0], quantidade: 4 }]
      });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(f.purchase.id);
    expect(conflict.status).toBe(409);
    expect(
      await prisma.compraImportada.count({
        where: { externalOrderIdOriginal: "batch5-order" }
      })
    ).toBe(1);
    const persistedConflict = await prisma.conflitoCompra.findFirst({
      where: {
        compraImportadaId: f.purchase.id,
        tipo: "PAYLOAD_MISMATCH",
        status: "ABERTO"
      }
    });
    expect(persistedConflict).not.toBeNull();
    const resolved = await request(f.app)
      .post(`/imported-purchases/conflicts/${persistedConflict!.id}/resolve`)
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-resolve-key")
      .send({ motivo: "Payload divergente revisado operacionalmente" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("RESOLVIDO");
  });

  it("divide 5 unidades em Dronz 2, Gooder 2 e saldo pendente 1 sem overflow", async () => {
    const f = await createStaging();
    const item = f.purchase.itens[0] as { id: string; version: number };
    const dronz = await request(f.app)
      .put(`/imported-purchases/items/${item.id}/assignments/${f.dronz.id}`)
      .set(bearer(f.token))
      .send({ quantidade: 2, expectedVersion: item.version });
    const gooder = await request(f.app)
      .put(`/imported-purchases/items/${item.id}/assignments/${f.gooder.id}`)
      .set(bearer(f.token))
      .send({ quantidade: 2, expectedVersion: item.version + 1 });
    const overflow = await request(f.app)
      .put(`/imported-purchases/items/${item.id}/assignments/${f.gooder.id}`)
      .set(bearer(f.token))
      .send({ quantidade: 4, expectedVersion: item.version + 2 });
    expect(dronz.status).toBe(200);
    expect(gooder.status).toBe(200);
    expect(overflow.status).toBe(409);
    const detail = await request(f.app)
      .get(`/imported-purchases/${f.purchase.id}`)
      .set(bearer(f.token));
    const assignments = detail.body.itens[0].atribuicoes as {
      quantidade: number;
    }[];
    expect(
      assignments.reduce((sum, assignment) => sum + assignment.quantidade, 0)
    ).toBe(4);
    const listed = await request(f.app)
      .get("/imported-purchases")
      .set(bearer(f.token));
    const row = listed.body.items.find(
      (entry: { id: string }) => entry.id === f.purchase.id
    );
    expect(row.progress).toEqual({
      total: 5,
      assigned: 4,
      materialized: 0,
      pending: 1
    });
  });

  it("materializa Dronz e Gooder independentemente, preserva origem e retry não duplica", async () => {
    const f = await createStaging();
    const item = f.purchase.itens[0] as { id: string; version: number };
    await request(f.app)
      .put(`/imported-purchases/items/${item.id}/assignments/${f.dronz.id}`)
      .set(bearer(f.token))
      .send({ quantidade: 2, expectedVersion: item.version });
    await request(f.app)
      .put(`/imported-purchases/items/${item.id}/assignments/${f.gooder.id}`)
      .set(bearer(f.token))
      .send({ quantidade: 2, expectedVersion: item.version + 1 });
    await request(f.app)
      .put(
        `/imported-purchases/items/${item.id}/product-mappings/${f.dronz.id}`
      )
      .set(bearer(f.token))
      .send({ produtoId: f.productD.id });
    await request(f.app)
      .put(
        `/imported-purchases/items/${item.id}/product-mappings/${f.gooder.id}`
      )
      .set(bearer(f.token))
      .send({ produtoId: f.productG.id });
    await request(f.app)
      .put(
        `/imported-purchases/merchants/${f.merchant.id}/supplier-mappings/${f.dronz.id}`
      )
      .set(bearer(f.token))
      .send({ fornecedorId: f.supplierD.id });
    await request(f.app)
      .put(
        `/imported-purchases/merchants/${f.merchant.id}/supplier-mappings/${f.gooder.id}`
      )
      .set(bearer(f.token))
      .send({ fornecedorId: f.supplierG.id });
    const current = await prisma.compraImportada.findUniqueOrThrow({
      where: { id: f.purchase.id }
    });
    const d = await request(f.app)
      .post(
        `/imported-purchases/${f.purchase.id}/materializations/${f.dronz.id}`
      )
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-mat-d")
      .send({ expectedPurchaseVersion: current.version });
    const replay = await request(f.app)
      .post(
        `/imported-purchases/${f.purchase.id}/materializations/${f.dronz.id}`
      )
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-mat-d")
      .send({ expectedPurchaseVersion: current.version });
    const afterD = await prisma.compraImportada.findUniqueOrThrow({
      where: { id: f.purchase.id }
    });
    const g = await request(f.app)
      .post(
        `/imported-purchases/${f.purchase.id}/materializations/${f.gooder.id}`
      )
      .set(bearer(f.token))
      .send({ expectedPurchaseVersion: afterD.version });
    expect(d.status).toBe(201);
    expect(replay.body.id).toBe(d.body.id);
    expect(g.status).toBe(201);
    expect(d.body.pedidoCompra.itens[0].quantidade).toBe(2);
    expect(g.body.pedidoCompra.itens[0].quantidade).toBe(2);
    expect(
      await prisma.materializacaoCompra.count({
        where: { compraImportadaId: f.purchase.id }
      })
    ).toBe(2);
    expect(
      await prisma.estoque.count({
        where: { produtoId: { in: [f.productD.id, f.productG.id] } }
      })
    ).toBe(0);
  });

  it("impede produto e materialização cross-store", async () => {
    const f = await createStaging();
    const item = f.purchase.itens[0] as { id: string; version: number };
    const wrongProduct = await request(f.app)
      .put(
        `/imported-purchases/items/${item.id}/product-mappings/${f.dronz.id}`
      )
      .set(bearer(f.token))
      .send({ produtoId: f.productG.id });
    const unknownStore = await request(f.app)
      .put(
        `/imported-purchases/items/${item.id}/assignments/cly0000000000000000000000`
      )
      .set(bearer(f.token))
      .send({ quantidade: 1, expectedVersion: item.version });
    expect(wrongProduct.status).toBe(400);
    expect(unknownStore.status).toBe(403);
  });

  it("serializa atribuições concorrentes e conserva a quantidade", async () => {
    const f = await createStaging();
    const item = f.purchase.itens[0] as { id: string; version: number };
    const [dronz, gooder] = await Promise.all([
      request(f.app)
        .put(`/imported-purchases/items/${item.id}/assignments/${f.dronz.id}`)
        .set(bearer(f.token))
        .send({ quantidade: 4, expectedVersion: item.version }),
      request(f.app)
        .put(`/imported-purchases/items/${item.id}/assignments/${f.gooder.id}`)
        .set(bearer(f.token))
        .send({ quantidade: 4, expectedVersion: item.version })
    ]);
    expect([dronz.status, gooder.status].sort()).toEqual([200, 409]);
    const assignments = await prisma.atribuicaoCompraItem.findMany({
      where: { itemExternoId: item.id }
    });
    expect(
      assignments.reduce((sum, assignment) => sum + assignment.quantidade, 0)
    ).toBe(4);
  });

  it("cria compra manual idempotente com loja, produto e auditoria validados", async () => {
    const f = await fixtures();
    const merchant = await request(f.app)
      .post("/imported-purchases/merchants")
      .set(bearer(f.token))
      .send({
        plataforma: "MANUAL",
        externalMerchantId: "batch5-manual-merchant",
        nome: "Batch5 Manual Merchant"
      });
    const payload = {
      referencia: "BATCH5-MANUAL",
      lojaId: f.dronz.id,
      merchantExternoId: merchant.body.id,
      dataPedido: "2026-07-12T12:00:00.000Z",
      moeda: "USD",
      itens: [
        {
          externalLineId: "manual-line",
          titulo: "Manual",
          quantidade: 1,
          precoUnitario: 20,
          moeda: "USD",
          produtoId: f.productD.id
        }
      ]
    };
    const first = await request(f.app)
      .post("/imported-purchases/manual")
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-manual-key")
      .send(payload);
    const replay = await request(f.app)
      .post("/imported-purchases/manual")
      .set(bearer(f.token))
      .set("idempotency-key", "batch5-manual-key")
      .send(payload);
    expect(first.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(first.body.origem).toBe("MANUAL");
    expect(
      await prisma.auditLog.count({
        where: {
          entity: "CompraImportada",
          entityId: first.body.id,
          action: "MANUAL_PURCHASE_CREATED"
        }
      })
    ).toBe(1);
  });

  it("nega staging global sem autenticação", async () => {
    const response = await request(createApp()).get("/imported-purchases");
    expect(response.status).toBe(401);
  });

  it("nega staging global a usuário local sem permissão global", async () => {
    const session = await auth();
    const profile = await prisma.perfil.upsert({
      where: { code: "BATCH5_LOCAL" },
      update: {},
      create: { code: "BATCH5_LOCAL", name: "Batch5 Local" }
    });
    const seededAdmin = await prisma.usuario.findUniqueOrThrow({
      where: { email: "admin@example.com" },
      select: { passwordHash: true }
    });
    const user = await prisma.usuario.create({
      data: {
        name: "Batch5 Local",
        email: `batch5-${Date.now()}@example.com`,
        passwordHash: seededAdmin.passwordHash,
        lojas: { create: { lojaId: session.dronz.id } },
        perfis: { create: { perfilId: profile.id } }
      }
    });
    const login = await request(session.app)
      .post("/auth/login")
      .send({ email: user.email, password: "change-me" });
    const response = await request(session.app)
      .get("/imported-purchases")
      .set(bearer(login.body.accessToken));
    expect(login.status).toBe(200);
    expect(response.status).toBe(403);
  });

  it("faz rollback integral quando a auditoria obrigatória falha", async () => {
    const session = await auth();
    setAuditFailureForTests(
      (entry) => entry.action === "EXTERNAL_ACCOUNT_UPSERTED"
    );
    try {
      const response = await request(session.app)
        .post("/imported-purchases/accounts")
        .set(bearer(session.token))
        .send({
          plataforma: "EBAY",
          identificadorExterno: "batch5-rollback",
          nomeExibicao: "Rollback",
          origemIntegracao: "API"
        });
      expect(response.status).toBe(500);
      expect(
        await prisma.contaExterna.findFirst({
          where: { identificadorExterno: "batch5-rollback" }
        })
      ).toBeNull();
    } finally {
      setAuditFailureForTests();
    }
  });
});
