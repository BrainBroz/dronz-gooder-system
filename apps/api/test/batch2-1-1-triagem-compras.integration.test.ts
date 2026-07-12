import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
const createdOrderIds: string[] = [];
const createdImportIds: string[] = [];
let createApp: typeof import("../src/app").createApp;
let testSession: Awaited<ReturnType<typeof createSession>>;

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  testSession = await createSession();
});

afterEach(async () => {
  const orderIds = createdOrderIds.splice(0);
  if (orderIds.length) {
    const items = await prisma.pedidoCompraItem.findMany({
      where: { pedidoCompraId: { in: orderIds } },
      select: { id: true }
    });
    await prisma.recebimentoMiami.deleteMany({
      where: { pedidoCompraItemId: { in: items.map((item) => item.id) } }
    });
    await prisma.atribuicaoItem.deleteMany({
      where: { pedidoCompraItemId: { in: items.map((item) => item.id) } }
    });
    await prisma.pedidoCompra.deleteMany({ where: { id: { in: orderIds } } });
  }
  const importIds = createdImportIds.splice(0);
  if (importIds.length) {
    await prisma.compraImportada.deleteMany({
      where: { id: { in: importIds } }
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSession() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  expect(login.status).toBe(200);
  const dronz = login.body.stores.find(
    (store: { slug: string }) => store.slug === "dronz"
  );
  const gooder = login.body.stores.find(
    (store: { slug: string }) => store.slug === "gooder"
  );
  expect(dronz).toBeTruthy();
  expect(gooder).toBeTruthy();
  const headers = (storeId: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": storeId
  });
  return { app, dronz, gooder, headers };
}

async function createFixture(
  lojaId: string,
  slug: "dronz" | "gooder",
  compraImportadaId?: string
) {
  const fornecedor = await prisma.fornecedor.findFirstOrThrow({
    where: { lojaId, ativo: true }
  });
  const produto = await prisma.produto.findFirstOrThrow({
    where: { lojaId, ativo: true }
  });
  const order = await prisma.pedidoCompra.create({
    data: {
      lojaId,
      fornecedorId: fornecedor.id,
      numeroPedido: `TRIAGEM-${slug}-${randomUUID()}`,
      dataCompra: new Date(),
      moeda: "USD",
      compraImportadaId
    }
  });
  const item = await prisma.pedidoCompraItem.create({
    data: {
      pedidoCompraId: order.id,
      lojaId,
      produtoId: produto.id,
      quantidade: 4,
      precoUnitario: "10.00",
      totalItem: "40.00"
    }
  });
  createdOrderIds.push(order.id);
  return { order, item };
}

describe("Batch 2.1.1 — atribuição operacional de compras", () => {
  it("registra atribuição rastreável na loja do item", async () => {
    const { app, dronz, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");

    const result = await request(app)
      .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 2 });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      pedidoCompraItemId: item.id,
      lojaId: dronz.id,
      quantidade: 2
    });
    expect(result.body.atribuidoPorId).toBeTruthy();
  });

  it("substitui a quantidade da atribuição sem somar o valor anterior", async () => {
    const { app, dronz, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");
    const endpoint = `/purchase-orders/${order.id}/items/${item.id}/atribuir`;

    expect(
      (
        await request(app).post(endpoint).set(headers(dronz.id)).send({
          lojaId: dronz.id,
          quantidade: 2
        })
      ).status
    ).toBe(200);
    const updated = await request(app)
      .post(endpoint)
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 4 });

    expect(updated.status).toBe(200);
    expect(updated.body.quantidade).toBe(4);
    expect(
      await prisma.atribuicaoItem.count({
        where: { pedidoCompraItemId: item.id }
      })
    ).toBe(1);
  });

  it("mantém o status parcial e conclui quando toda quantidade é atribuída", async () => {
    const { app, dronz, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");
    const endpoint = `/purchase-orders/${order.id}/items/${item.id}/atribuir`;

    await request(app).post(endpoint).set(headers(dronz.id)).send({
      lojaId: dronz.id,
      quantidade: 2
    });
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: order.id }
        })
      ).statusAtribuicao
    ).toBe("PARCIALMENTE_ATRIBUIDA");

    await request(app).post(endpoint).set(headers(dronz.id)).send({
      lojaId: dronz.id,
      quantidade: 4
    });
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: order.id }
        })
      ).statusAtribuicao
    ).toBe("ATRIBUIDA");
  });

  it("rejeita quantidade superior à quantidade do item", async () => {
    const { app, dronz, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");

    const result = await request(app)
      .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 5 });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("quantidade_insuficiente");
  });

  it("não aceita loja do body diferente da loja autenticada", async () => {
    const { app, dronz, gooder, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");

    const result = await request(app)
      .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
      .set(headers(dronz.id))
      .send({ lojaId: gooder.id, quantidade: 1 });

    expect(result.status).toBe(403);
  });

  it("bloqueia atribuição cross-store antes da FK composta", async () => {
    const { app, dronz, gooder, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");

    const result = await request(app)
      .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
      .set(headers(gooder.id))
      .send({ lojaId: gooder.id, quantidade: 1 });

    expect(result.status).toBe(404);
    expect(
      await prisma.atribuicaoItem.count({
        where: { pedidoCompraItemId: item.id }
      })
    ).toBe(0);
  });

  it("lista somente atribuições de pedido pertencente à loja autenticada", async () => {
    const { app, dronz, gooder, headers } = testSession;
    const { order, item } = await createFixture(dronz.id, "dronz");
    await request(app)
      .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 1 });

    const own = await request(app)
      .get(`/purchase-orders/${order.id}/atribuicoes`)
      .set(headers(dronz.id));
    const otherStore = await request(app)
      .get(`/purchase-orders/${order.id}/atribuicoes`)
      .set(headers(gooder.id));

    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);
    expect(own.body[0].lojaId).toBe(dronz.id);
    expect(otherStore.status).toBe(404);
  });

  it("não mistura atribuição operacional com a staging importada", async () => {
    const { app, dronz, headers } = testSession;
    const imported = await prisma.compraImportada.create({
      data: {
        fornecedorId: `external-${randomUUID()}`,
        numeroPedido: `IMPORT-${randomUUID()}`,
        quantidade: 8
      }
    });
    createdImportIds.push(imported.id);
    const first = await createFixture(dronz.id, "dronz", imported.id);
    const second = await createFixture(dronz.id, "dronz", imported.id);

    const firstResult = await request(app)
      .post(
        `/purchase-orders/${first.order.id}/items/${first.item.id}/atribuir`
      )
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 1 });
    const secondResult = await request(app)
      .post(
        `/purchase-orders/${second.order.id}/items/${second.item.id}/atribuir`
      )
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 1 });

    expect(firstResult.status).toBe(200);
    expect(secondResult.status).toBe(200);
    expect(firstResult.body.compraImportadaId).toBeNull();
    expect(secondResult.body.compraImportadaId).toBeNull();
  });

  it("retorna 404 para pedido ou item inexistente", async () => {
    const { app, dronz, headers } = testSession;

    const result = await request(app)
      .post(
        "/purchase-orders/pedido-inexistente/items/item-inexistente/atribuir"
      )
      .set(headers(dronz.id))
      .send({ lojaId: dronz.id, quantidade: 1 });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe("item_not_found");
  });
});
