import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
let fixture: Awaited<ReturnType<typeof createOperationalFixture>> | undefined;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function session() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    token: login.body.accessToken,
    dronz: login.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
    gooder: login.body.stores.find((x: { slug: string }) => x.slug === "gooder")
  };
}
const headers = (token: string, id: string) => ({
  Authorization: `Bearer ${token}`,
  "x-store-id": id
});
describe("receiving and inventory", () => {
  it("rejeita confirmação Miami fora dos estados permitidos", async () => {
    const { app, token, dronz } = await session();
    fixture = await createOperationalFixture(prisma, dronz.id);
    const { order, item } = fixture;
    for (const status of ["DRAFT", "PLACED", "RECEIVED_MIAMI", "CANCELLED"] as const) {
      await prisma.pedidoCompra.update({ where: { id: order.id }, data: { status } });
      const result = await request(app).post("/logistics/miami-confirmations")
        .set(headers(token, dronz.id))
        .send({ pedidoCompraItemId: item.id, quantidadeRecebida: 1, recebidoEm: new Date().toISOString() });
      expect(result.status).toBe(409);
      expect((await prisma.pedidoCompra.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(status);
    }
    expect(await prisma.recebimentoMiami.count({ where: { pedidoCompraItemId: item.id } })).toBe(0);
  });

  it("percorre pedido, Miami, Paraguai, Brasil e entrada definitiva sem estoque antecipado", async () => {
    const { app, token, dronz } = await session();
    fixture = await createOperationalFixture(prisma, dronz.id, "MIAMI_PARAGUAI_BRASIL");
    const { order, item, trip, bag, volume, allocation, product } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    await prisma.pedidoCompra.update({ where: { id: order.id }, data: { status: "DRAFT" } });
    const storeHeaders = headers(token, dronz.id);
    for (const status of ["PLACED", "CONFIRMED"]) {
      const result = await request(app).patch(`/purchase-orders/${order.id}/status`)
        .set(storeHeaders).send({ status });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe(status);
    }
    const miami = await request(app).post("/logistics/miami-confirmations")
      .set(storeHeaders).send({ pedidoCompraItemId: item.id, quantidadeRecebida: 2, recebidoEm: new Date().toISOString() });
    expect(miami.status).toBe(200);
    expect((await prisma.pedidoCompra.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RECEIVED_MIAMI");
    const allocated = await request(app).post("/logistics/allocations")
      .set(storeHeaders).send({ pedidoCompraItemId: item.id, malaId: bag.id, volumeLogisticoId: volume.id, quantidade: 2 });
    expect(allocated.status).toBe(200);
    expect(allocated.body).toMatchObject({ pedidoCompraItemId: item.id, malaId: bag.id, quantidade: 2 });
    for (const status of ["CLOSED", "CHECKED_IN"]) {
      const result = await request(app).patch(`/logistics/suitcases/${bag.id}/status`)
        .set(storeHeaders).send({ status });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe(status);
    }
    for (const status of ["CLOSED_FOR_ALLOCATION", "IN_TRANSIT"]) {
      const result = await request(app).patch(`/logistics/trips/${trip.id}/status`)
        .set(storeHeaders).send({ status });
      expect(result.status).toBe(200);
      expect(result.body.status).toBe(status);
    }
    const paraguay = await request(app).post("/logistics/checkpoint-paraguai")
      .set(storeHeaders).send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(paraguay.status).toBe(200);
    expect(paraguay.body.tipoDivergencia).toBe("CORRETO");
    const arrivedTrip = await request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(storeHeaders).send({ status: "ARRIVED_BRAZIL" });
    expect(arrivedTrip.status).toBe(200);
    const arrivedBag = await request(app).patch(`/logistics/suitcases/${bag.id}/status`)
      .set(storeHeaders).send({ status: "ARRIVED_BRAZIL" });
    expect(arrivedBag.status).toBe(200);
    const brazil = await request(app).post("/logistics/checkpoint-brasil")
      .set(storeHeaders).send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(brazil.status).toBe(200);
    const receiving = await request(app).post("/receiving")
      .set(storeHeaders).send({ viagemId: trip.id, malaId: bag.id });
    expect(receiving.status).toBe(200);
    const receivingItems = await prisma.recebimentoItem.findMany({ where: { recebimentoId: receiving.body.id } });
    expect(receivingItems).toHaveLength(1);
    expect(receivingItems[0]).toMatchObject({ pedidoCompraItemId: item.id, produtoId: product.id, quantidadeEsperada: 2 });
    const confirmed = await request(app).post(`/receiving/${receiving.body.id}/items/${receivingItems[0].id}/confirm`)
      .set(storeHeaders).send({ quantidadeRecebida: 2, quantidadeRejeitada: 0 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("COMPLETED");
    expect(await prisma.estoque.findUnique({
      where: { lojaId_produtoId: { lojaId: dronz.id, produtoId: product.id } }
    })).toBeNull();
    expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: product.id, tipo: "ENTRY" } })).toBe(0);
    const entry = await request(app).post("/receiving/entrada-definitiva")
      .set(storeHeaders).send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(entry.status).toBe(200);
    expect((await prisma.estoque.findUniqueOrThrow({
      where: { lojaId_produtoId: { lojaId: dronz.id, produtoId: product.id } }
    })).quantidadeFisica).toBe(2);
    expect(await prisma.movimentacaoEstoque.count({
      where: { recebimentoId: receiving.body.id, produtoId: product.id, tipo: "ENTRY" }
    })).toBe(1);
  });

  it("agrega alocações do mesmo item em volumes distintos até a entrada em estoque", async () => {
    const { app, token, dronz } = await session();
    fixture = await createOperationalFixture(prisma, dronz.id);
    const { trip, bag, item, allocation, product, admin } = fixture;
    const secondVolume = await prisma.volumeLogistico.create({
      data: { lojaId: dronz.id, malaId: bag.id, codigo: `SECOND-${bag.id}`, taraKg: 0.5 }
    });
    await prisma.alocacaoMala.update({
      where: { id: allocation.id }, data: { quantidade: 1, pesoConteudoKg: 1 }
    });
    await prisma.alocacaoMala.create({
      data: {
        lojaId: dronz.id, pedidoCompraItemId: item.id, malaId: bag.id,
        volumeLogisticoId: secondVolume.id, quantidade: 1, pesoConteudoKg: 1
      }
    });
    await prisma.viagem.update({
      where: { id: trip.id }, data: { status: "ARRIVED_BRAZIL", chegadaRealEm: new Date() }
    });
    await prisma.mala.update({ where: { id: bag.id }, data: { status: "ARRIVED_BRAZIL" } });
    await prisma.checkpointBrasil.create({ data: {
      lojaId: dronz.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date()
    } });
    await prisma.recebimentoMiami.create({ data: {
      lojaId: dronz.id, pedidoCompraItemId: item.id, quantidadeRecebida: 2,
      recebidoEm: new Date(), confirmadoPorId: admin.id
    } });
    const opened = await request(app).post("/receiving")
      .set(headers(token, dronz.id)).send({ viagemId: trip.id, malaId: bag.id });
    expect(opened.status).toBe(200);
    const entries = await prisma.recebimentoItem.findMany({
      where: { recebimentoId: opened.body.id }
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      pedidoCompraItemId: item.id, produtoId: product.id, quantidadeEsperada: 2
    });
    const confirmed = await request(app)
      .post(`/receiving/${opened.body.id}/items/${entries[0].id}/confirm`)
      .set(headers(token, dronz.id))
      .send({ quantidadeRecebida: 2, quantidadeRejeitada: 0 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("COMPLETED");
    const posted = await request(app).post("/receiving/entrada-definitiva")
      .set(headers(token, dronz.id))
      .send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(posted.status).toBe(200);
    expect((await prisma.estoque.findUniqueOrThrow({
      where: { lojaId_produtoId: { lojaId: dronz.id, produtoId: product.id } }
    })).quantidadeFisica).toBe(2);
    expect(await prisma.movimentacaoEstoque.count({
      where: { recebimentoId: opened.body.id, tipo: "ENTRY" }
    })).toBe(1);
  });

  it("bloqueia antes do Brasil e confirma entrada atômica após chegada", async () => {
    const { app, token, dronz } = await session();
    fixture = await createOperationalFixture(prisma, dronz.id);
    const { trip, bag } = fixture;
    expect(
      (
        await request(app)
          .post("/receiving")
          .set(headers(token, dronz.id))
          .send({ viagemId: trip.id, malaId: bag.id })
      ).status
    ).toBe(409);
    await prisma.viagem.update({
      where: { id: trip.id },
      data: { status: "ARRIVED_BRAZIL", chegadaRealEm: new Date() }
    });
    await prisma.mala.update({
      where: { id: bag.id },
      data: { status: "ARRIVED_BRAZIL" }
    });
    await prisma.checkpointBrasil.create({ data: {
      lojaId: dronz.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: fixture.admin.id, confirmadoEm: new Date()
    } });
    const created = await request(app)
      .post("/receiving")
      .set(headers(token, dronz.id))
      .send({ viagemId: trip.id, malaId: bag.id });
    expect(created.status).toBe(200);
    const detail = await prisma.recebimento.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { itens: true }
    });
    expect(detail.itens).toHaveLength(1);
    await prisma.recebimentoItem.update({
      where: { id: detail.itens[0].id },
      data: { quantidadeEsperada: 2 }
    });
    const confirmed = await request(app)
      .post(`/receiving/${created.body.id}/items/${detail.itens[0].id}/confirm`)
      .set(headers(token, dronz.id))
      .send({ quantidadeRecebida: 1, quantidadeRejeitada: 0 });
    expect(confirmed.body.status).toBe("PARTIALLY_COMPLETED");
    const completed = await request(app)
      .post(`/receiving/${created.body.id}/items/${detail.itens[0].id}/confirm`)
      .set(headers(token, dronz.id))
      .send({ quantidadeRecebida: 1, quantidadeRejeitada: 0 });
    expect(completed.body.status).toBe("COMPLETED");
    expect((await request(app).get("/inventory").set(headers(token, dronz.id))).body.find(
      (entry: { produtoId: string }) => entry.produtoId === detail.itens[0].produtoId
    )).toBeUndefined();
    expect(await prisma.movimentacaoEstoque.count({ where: { recebimentoId: created.body.id, tipo: "ENTRY" } })).toBe(0);
    await prisma.recebimentoMiami.create({ data: {
      lojaId: dronz.id, pedidoCompraItemId: fixture.item.id, quantidadeRecebida: 2,
      recebidoEm: new Date(), confirmadoPorId: fixture.admin.id
    } });
    const entry = await request(app).post("/receiving/entrada-definitiva")
      .set(headers(token, dronz.id))
      .send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(entry.status).toBe(200);
    const stock = (
      await request(app).get("/inventory").set(headers(token, dronz.id))
    ).body.find(
      (x: { produtoId: string }) => x.produtoId === detail.itens[0].produtoId
    );
    expect(stock.quantidadeFisica).toBe(2);
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { recebimentoId: created.body.id, tipo: "ENTRY" }
      })
    ).toBe(1);
    expect(
      (
        await request(app)
          .post(
            `/receiving/${created.body.id}/items/${detail.itens[0].id}/confirm`
          )
          .set(headers(token, dronz.id))
          .send({ quantidadeRecebida: 1, quantidadeRejeitada: 0 })
      ).status
    ).toBe(409);
  });
  it("reserva, libera, baixa e isola lojas", async () => {
    const { app, token, dronz, gooder } = await session();
    fixture = await createOperationalFixture(prisma, dronz.id);
    const stock = await prisma.estoque.upsert({
      where: { lojaId_produtoId: { lojaId: dronz.id, produtoId: fixture.product.id } },
      create: { lojaId: dronz.id, produtoId: fixture.product.id, quantidadeFisica: 3 },
      update: { quantidadeFisica: 3, quantidadeReservada: 0 }
    });
    const move = (tipo: string, motivo: string, q = 1, observacoes?: string) =>
      request(app)
        .post("/inventory/movements")
        .set(headers(token, dronz.id))
        .send({
          produtoId: stock.produtoId,
          tipo,
          motivo,
          quantidade: q,
          observacoes
        });
    expect((await move("RESERVE", "RESERVATION")).status).toBe(200);
    expect(
      (await move("RELEASE_RESERVATION", "RESERVATION_RELEASE")).status
    ).toBe(200);
    expect((await move("EXIT", "SALE", 2)).status).toBe(200);
    expect((await move("EXIT", "SALE", 2)).status).toBe(409);
    expect(
      (await move("ADJUSTMENT_POSITIVE", "MANUAL_CORRECTION", 1)).status
    ).toBe(400);
    expect(
      (
        await request(app).get("/inventory").set(headers(token, gooder.id))
      ).body.every((x: { lojaId: string }) => x.lojaId === gooder.id)
    ).toBe(true);
  });
});
