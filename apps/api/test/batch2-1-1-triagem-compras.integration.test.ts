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
  await prisma.$disconnect();
});

async function session() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz");
  const g = login.body.stores.find((x: { slug: string }) => x.slug === "gooder");
  const h = (id: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": id
  });
  return { app, d, g, h };
}

describe("Batch 2.1.1 — Triagem de Compras", () => {
  it("atribui item para loja", async () => {
    const { app, d, h } = await session();
    const order = await prisma.pedidoCompra.findFirst({
      where: { lojaId: d.id }
    });
    const item = await prisma.pedidoCompraItem.findFirst({
      where: { pedidoCompraId: order?.id }
    });

    if (order && item) {
      await prisma.atribuicaoItem.deleteMany({
        where: { pedidoCompraItemId: item.id }
      });

      const result = await request(app)
        .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
        .set(h(d.id))
        .send({
          lojaId: d.id,
          quantidade: 1
        });

      if (result.status !== 200) {
        console.log("Response:", { status: result.status, body: result.body });
      }

      expect(result.status).toBe(200);
      expect(result.body.pedidoCompraItemId).toBe(item.id);
      expect(result.body.lojaId).toBe(d.id);
      expect(result.body.quantidade).toBe(1);
    }
  });

  it("bloqueia atribuição com quantidade maior que disponível", async () => {
    const { app, d, h } = await session();
    const order = await prisma.pedidoCompra.findFirst({
      where: { lojaId: d.id }
    });
    const item = await prisma.pedidoCompraItem.findFirst({
      where: { pedidoCompraId: order?.id }
    });

    if (order && item) {
      const result = await request(app)
        .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
        .set(h(d.id))
        .send({
          lojaId: d.id,
          quantidade: item.quantidade + 1
        });

      expect(result.status).toBe(400);
    }
  });

  it("bloqueia atribuição com lojaId diferente do header", async () => {
    const { app, d, g, h } = await session();
    const order = await prisma.pedidoCompra.findFirst({
      where: { lojaId: d.id }
    });
    const item = await prisma.pedidoCompraItem.findFirst({
      where: { pedidoCompraId: order?.id }
    });

    if (order && item && g) {
      const result = await request(app)
        .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
        .set(h(d.id))
        .send({
          lojaId: g.id,
          quantidade: 1
        });

      expect(result.status).toBe(403);
    }
  });

  it("permite Miami check-in após atribuição", async () => {
    const { app, d, h } = await session();
    const order = await prisma.pedidoCompra.findFirst({
      where: { lojaId: d.id }
    });
    const item = await prisma.pedidoCompraItem.findFirst({
      where: { pedidoCompraId: order?.id }
    });

    if (order && item) {
      await prisma.atribuicaoItem.deleteMany({
        where: { pedidoCompraItemId: item.id }
      });

      await prisma.recebimentoMiami.deleteMany({
        where: { pedidoCompraItemId: item.id }
      });

      await prisma.pedidoCompraItem.update({
        where: { id: item.id },
        data: { quantidadeRecebidaMiami: 0 }
      });

      await request(app)
        .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
        .set(h(d.id))
        .send({
          lojaId: d.id,
          quantidade: 1
        });

      const miami = await request(app)
        .post("/logistics/miami-confirmations")
        .set(h(d.id))
        .send({
          pedidoCompraItemId: item.id,
          quantidadeRecebida: 1,
          recebidoEm: new Date()
        });

      expect(miami.status).toBe(200);
    }
  });


  it("lista atribuições do pedido", async () => {
    const { app, d, h } = await session();
    const order = await prisma.pedidoCompra.findFirst({
      where: { lojaId: d.id }
    });
    const item = await prisma.pedidoCompraItem.findFirst({
      where: { pedidoCompraId: order?.id }
    });

    if (order && item) {
      await request(app)
        .post(`/purchase-orders/${order.id}/items/${item.id}/atribuir`)
        .set(h(d.id))
        .send({
          lojaId: d.id,
          quantidade: 1
        });

      const result = await request(app)
        .get(`/purchase-orders/${order.id}/atribuicoes`)
        .set(h(d.id));

      expect(result.status).toBe(200);
      expect(Array.isArray(result.body)).toBe(true);
      if (result.body.length > 0) {
        expect(result.body[0].lojaId).toBe(d.id);
      }
    }
  });
});
