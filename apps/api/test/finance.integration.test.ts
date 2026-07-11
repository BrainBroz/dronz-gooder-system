import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
afterAll(async () => {
  const orders = await prisma.pedidoCompra.findMany({
    where: { numeroPedido: { startsWith: "FIN-" } },
    select: { id: true }
  });
  const ids = orders.map((x) => x.id);
  await prisma.pagamento.deleteMany({ where: { pedidoCompraId: { in: ids } } });
  await prisma.custoPedidoItem.deleteMany({
    where: { custo: { pedidoCompraId: { in: ids } } }
  });
  await prisma.custoPedido.deleteMany({
    where: { pedidoCompraId: { in: ids } }
  });
  await prisma.pedidoCompraItem.deleteMany({
    where: { pedidoCompraId: { in: ids } }
  });
  await prisma.pedidoCompra.deleteMany({ where: { id: { in: ids } } });
  await prisma.fornecedor.deleteMany({ where: { nome: "Finance Test" } });
  await prisma.$disconnect();
});
async function setup() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
    g = login.body.stores.find((x: { slug: string }) => x.slug === "gooder"),
    h = (id: string) => ({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": id
    });
  const supplier = await prisma.fornecedor.create({
    data: { lojaId: d.id, nome: "Finance Test" }
  });
  const product = await prisma.produto.findFirstOrThrow({
    where: { lojaId: d.id }
  });
  const order = await request(app)
    .post("/purchase-orders")
    .set(h(d.id))
    .send({
      fornecedorId: supplier.id,
      numeroPedido: `FIN-${Date.now()}`,
      dataCompra: "2026-01-01",
      itens: [{ produtoId: product.id, quantidade: 3, precoUnitario: 10 }]
    });
  return { app, d, g, h, order: order.body };
}
describe("purchase finance", () => {
  it("rateia HALF_UP, aceita parcial, bloqueia excesso e isola loja", async () => {
    const { app, d, g, h, order } = await setup();
    const cost = await request(app)
      .put(`/finance/orders/${order.id}/costs`)
      .set(h(d.id))
      .send({ iofPercentual: 1, taxas: 1, custoAdicional: 0 });
    expect(cost.status).toBe(200);
    expect(
      cost.body.itens.reduce(
        (s: number, x: { custoRateado: string }) => s + Number(x.custoRateado),
        0
      )
    ).toBe(Number(cost.body.totalGlobal));
    const partial = await request(app)
      .post("/finance/payments")
      .set(h(d.id))
      .send({
        pedidoCompraId: order.id,
        formaPagamento: "PAYPAL",
        moeda: "USD",
        valor: 10
      });
    expect(partial.body.status).toBe("PARTIAL");
    expect(
      (
        await request(app).post("/finance/payments").set(h(d.id)).send({
          pedidoCompraId: order.id,
          formaPagamento: "CASH",
          moeda: "USD",
          valor: 25
        })
      ).status
    ).toBe(409);
    expect(
      (await request(app).get("/finance/payments").set(h(g.id))).body.some(
        (x: { pedidoCompraId: string }) => x.pedidoCompraId === order.id
      )
    ).toBe(false);
    const refund = await request(app)
      .post(`/finance/payments/${partial.body.id}/refund`)
      .set(h(d.id))
      .send({ valor: 5 });
    expect(refund.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/finance/payments/${partial.body.id}/refund`)
          .set(h(d.id))
          .send({ valor: 6 })
      ).status
    ).toBe(409);
  });
});
