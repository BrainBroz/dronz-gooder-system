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
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
beforeEach(async () => {
  await prisma.pedidoCompraItem.deleteMany({
    where: { observacoes: "batch5-test" }
  });
  await prisma.pedidoCompra.deleteMany({
    where: { numeroPedido: { startsWith: "TEST-" } }
  });
  await prisma.fornecedor.deleteMany({
    where: { nome: { startsWith: "Test " } }
  });
});
afterAll(async () => {
  await prisma.pedidoCompraItem.deleteMany({
    where: { observacoes: "batch5-test" }
  });
  await prisma.pedidoCompra.deleteMany({
    where: { numeroPedido: { startsWith: "TEST-" } }
  });
  await prisma.fornecedor.deleteMany({
    where: { nome: { startsWith: "Test " } }
  });
  await prisma.$disconnect();
});
async function session() {
  const app = createApp(),
    login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    token: login.body.accessToken,
    d: login.body.stores.find((s: { slug: string }) => s.slug === "dronz"),
    g: login.body.stores.find((s: { slug: string }) => s.slug === "gooder")
  };
}
const h = (token: string, store: string) => ({
  Authorization: `Bearer ${token}`,
  "x-store-id": store
});
describe("suppliers and purchase orders", () => {
  it("isola fornecedores e bloqueia exclusão com histórico", async () => {
    const { app, token, d, g } = await session();
    const sd = (
      await request(app)
        .post("/suppliers")
        .set(h(token, d.id))
        .send({ nome: "Test D", moedaPadrao: "USD" })
    ).body;
    const sg = (
      await request(app)
        .post("/suppliers")
        .set(h(token, g.id))
        .send({ nome: "Test G" })
    ).body;
    expect(
      (
        await request(app).get("/suppliers").set(h(token, d.id))
      ).body.items.every((x: { lojaId: string }) => x.lojaId === d.id)
    ).toBe(true);
    expect(
      (await request(app).get(`/suppliers/${sg.id}`).set(h(token, d.id))).status
    ).toBe(404);
    const prod = await prisma.produto.findFirstOrThrow({
      where: { lojaId: d.id }
    });
    const order = await request(app)
      .post("/purchase-orders")
      .set(h(token, d.id))
      .send({
        fornecedorId: sd.id,
        numeroPedido: "TEST-1",
        dataCompra: "2026-01-01",
        moeda: "USD",
        descontoPedido: 2,
        frete: 5,
        imposto: 1,
        itens: [
          {
            produtoId: prod.id,
            quantidade: 2,
            precoUnitario: 10,
            descontoItem: 3,
            observacoes: "batch5-test"
          }
        ]
      });
    expect(order.status).toBe(201);
    expect(String(order.body.subtotal)).toBe("17");
    expect(String(order.body.total)).toBe("21");
    expect(
      (await request(app).delete(`/suppliers/${sd.id}`).set(h(token, d.id)))
        .status
    ).toBe(409);
  });
  it("valida loja, duplicidade, itens e transições", async () => {
    const { app, token, d, g } = await session();
    const s = (
      await request(app)
        .post("/suppliers")
        .set(h(token, d.id))
        .send({ nome: "Test Supplier" })
    ).body;
    const pd = await prisma.produto.findFirstOrThrow({
        where: { lojaId: d.id }
      }),
      pg = await prisma.produto.findFirstOrThrow({ where: { lojaId: g.id } });
    const payload = {
      fornecedorId: s.id,
      numeroPedido: "TEST-2",
      dataCompra: "2026-01-01",
      itens: [
        {
          produtoId: pd.id,
          quantidade: 1,
          precoUnitario: 10,
          descontoItem: 0,
          observacoes: "batch5-test"
        }
      ]
    };
    const o = await request(app)
      .post("/purchase-orders")
      .set(h(token, d.id))
      .send(payload);
    expect(o.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/purchase-orders")
          .set(h(token, d.id))
          .send(payload)
      ).status
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/purchase-orders/${o.body.id}/items`)
          .set(h(token, d.id))
          .send({ produtoId: pg.id, quantidade: 1, precoUnitario: 1 })
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/purchase-orders/${o.body.id}/status`)
          .set(h(token, d.id))
          .send({ status: "COMPLETED" })
      ).status
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/purchase-orders/${o.body.id}/status`)
          .set(h(token, d.id))
          .send({ status: "PLACED" })
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/purchase-orders/${o.body.id}`)
          .set(h(token, g.id))
      ).status
    ).toBe(404);
  });
});
