import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOperationalFixture } from "./helpers/operational-fixture";

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
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

async function orderWithPurchase() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  const purchase = await prisma.compraImportada.create({
    data: {
      numeroPedido: `TRK-${randomUUID()}`,
      quantidade: 2,
      plataforma: "MANUAL",
      dataPedido: new Date()
    }
  });
  await prisma.pedidoCompra.update({
    where: { id: data.order.id },
    data: { compraImportadaId: purchase.id }
  });
  cleanups.push(async () => {
    await prisma.trackingExterno.updateMany({
      where: { pacote: { envio: { compraImportadaId: purchase.id } } },
      data: { substituiTrackingId: null }
    });
    await prisma.trackingExterno.deleteMany({
      where: { pacote: { envio: { compraImportadaId: purchase.id } } }
    });
    await prisma.pacoteExterno.deleteMany({
      where: { envio: { compraImportadaId: purchase.id } }
    });
    await prisma.envioExterno.deleteMany({
      where: { compraImportadaId: purchase.id }
    });
    await prisma.pedidoCompra.update({
      where: { id: data.order.id },
      data: { compraImportadaId: null }
    });
    await data.cleanup();
    await prisma.compraImportada.delete({ where: { id: purchase.id } });
  });
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const gooder = await prisma.loja.findUniqueOrThrow({
    where: { slug: "gooder" }
  });
  const headers = (lojaId = store.id) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": lojaId
  });
  return { app, headers, data, gooderId: gooder.id };
}

describe("tracking do pedido operacional (Batch 14)", () => {
  it("registra tracking manual, corrige preservando o anterior e não cria recebimento nem estoque", async () => {
    const { app, headers, data } = await orderWithPurchase();
    const add = (body: object) =>
      request(app)
        .post(`/purchase-orders/${data.order.id}/trackings`)
        .set(headers())
        .send(body);
    const first = await add({
      codigo: "9400 1112 2233",
      transportadora: "USPS"
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      codigo: "940011122233",
      origem: "MANUAL",
      ativo: true
    });
    expect(
      (await add({ codigo: "940011122233", transportadora: "USPS" })).body.error
    ).toBe("tracking_already_registered");
    const fixed = await add({
      codigo: "940011122299",
      transportadora: "USPS",
      substituiTrackingId: first.body.id
    });
    expect(fixed.status).toBe(201);
    const list = await request(app)
      .get(`/purchase-orders/${data.order.id}/trackings`)
      .set(headers());
    expect(
      list.body.map((entry: { codigo: string; ativo: boolean }) => [
        entry.codigo,
        entry.ativo
      ])
    ).toEqual([
      ["940011122233", false],
      ["940011122299", true]
    ]);
    expect(list.body[1].substituiTrackingId).toBe(first.body.id);
    expect(
      await prisma.recebimentoMiami.count({
        where: { pedidoCompraItemId: data.item.id }
      })
    ).toBe(0);
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: data.product.id }
      })
    ).toBe(0);
  });

  it("leitura de etiqueta acha o pedido pelo código ou últimos dígitos só na loja certa", async () => {
    const { app, headers, data, gooderId } = await orderWithPurchase();
    await request(app)
      .post(`/purchase-orders/${data.order.id}/trackings`)
      .set(headers())
      .send({ codigo: "1Z999AA10123456784", transportadora: "UPS" });
    const full = await request(app)
      .get("/purchase-orders/tracking/lookup")
      .set(headers())
      .query({ codigo: "1z999aa10123456784" });
    expect(full.status).toBe(200);
    expect(full.body[0]).toMatchObject({
      exato: true,
      pedidos: [
        expect.objectContaining({
          id: data.order.id,
          destinoPosicao: expect.objectContaining({ nome: "Base Miami" })
        })
      ]
    });
    expect(full.body[0].pedidos[0]).not.toHaveProperty("total");
    const suffix = await request(app)
      .get("/purchase-orders/tracking/lookup")
      .set(headers())
      .query({ codigo: "456784" });
    expect(suffix.body[0]).toMatchObject({
      exato: false,
      codigo: "1Z999AA10123456784"
    });
    const otherStore = await request(app)
      .get("/purchase-orders/tracking/lookup")
      .set(headers(gooderId))
      .query({ codigo: "1Z999AA10123456784" });
    expect(otherStore.body).toEqual([]);
    expect(
      (
        await request(app)
          .get("/purchase-orders/tracking/lookup")
          .set(headers())
          .query({ codigo: "123" })
      ).status
    ).toBe(400);
  });

  it("disponibilidade da posição mostra o tracking esperado do pedido a caminho", async () => {
    const { app, headers, data } = await orderWithPurchase();
    await request(app)
      .post(`/purchase-orders/${data.order.id}/trackings`)
      .set(headers())
      .send({ codigo: "TBA123456789", transportadora: "AMZL" });
    const availability = await request(app)
      .get("/positions/posicao-miami-base/availability")
      .set(headers());
    const row = availability.body.find(
      (entry: { pedidoCompraItemId: string }) =>
        entry.pedidoCompraItemId === data.item.id
    );
    expect(row.aCaminho).toBe(2);
    expect(row.trackings).toEqual([
      { codigo: "TBA123456789", transportadora: "AMZL" }
    ]);
  });
});
