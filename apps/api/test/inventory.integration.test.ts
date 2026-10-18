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
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
let fixture: Awaited<ReturnType<typeof createOperationalFixture>> | undefined;
const mutationKeys: string[] = [];
afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { idempotencyKey: { in: mutationKeys } } });
  await prisma.idempotencyRecord.deleteMany({ where: { idempotencyKey: { in: mutationKeys.splice(0) } } });
  if (fixture) {
    const sales = await prisma.venda.findMany({
      where: { itens: { some: { produtoId: fixture.product.id } } },
      select: { id: true }
    });
    const vendaId = { in: sales.map((sale) => sale.id) };
    await prisma.recebivelVenda.deleteMany({ where: { vendaId } });
    await prisma.baixaVenda.deleteMany({
      where: { item: { produtoId: fixture.product.id } }
    });
    await prisma.vendaItem.deleteMany({ where: { vendaId } });
    await prisma.venda.deleteMany({ where: { id: vendaId } });
  }
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
type Indicator = {
  codigo: string;
  dimensao: string | null;
  valor: string | null;
};
const indicatorValue = (rows: Indicator[], code: string, dimension: string) =>
  rows
    .filter((row) => row.codigo === code && row.dimensao === dimension)
    .reduce((sum, row) => sum + Number(row.valor ?? 0), 0);

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

  it.each(["dronz", "gooder"] as const)("percorre pedido, checkpoints, estoque, venda e recebimentos em %s sem duplicar nem misturar lojas", async (slug) => {
    const { app, token, ...stores } = await session();
    const store = stores[slug];
    const otherStore = stores[slug === "dronz" ? "gooder" : "dronz"];
    const storeHeaders = headers(token, store.id);
    const indicators = (storeId: string) => request(app)
      .get("/analytics/indicators")
      .set(headers(token, storeId))
      .query({ from: "2026-01-01", to: "2100-01-01", moeda: "USD" });
    const before = await indicators(store.id);
    const otherBefore = await indicators(otherStore.id);
    expect(before.status).toBe(200);
    expect(otherBefore.status).toBe(200);
    fixture = await createOperationalFixture(prisma, store.id, "MIAMI_PARAGUAI_BRASIL");
    const { order, item, trip, bag, volume, allocation, product } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    await prisma.pedidoCompra.update({ where: { id: order.id }, data: { status: "DRAFT" } });
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
      where: { lojaId_produtoId: { lojaId: store.id, produtoId: product.id } }
    })).toBeNull();
    expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: product.id, tipo: "ENTRY" } })).toBe(0);
    const entry = await request(app).post("/receiving/entrada-definitiva")
      .set(storeHeaders).send({ viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString() });
    expect(entry.status).toBe(200);
    expect((await prisma.estoque.findUniqueOrThrow({
      where: { lojaId_produtoId: { lojaId: store.id, produtoId: product.id } }
    })).quantidadeFisica).toBe(2);
    expect(await prisma.movimentacaoEstoque.count({
      where: { recebimentoId: receiving.body.id, produtoId: product.id, tipo: "ENTRY" }
    })).toBe(1);

    const lots = await prisma.movimentacaoEstoque.findMany({
      where: { produtoId: product.id, tipo: "ENTRY" }
    });
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ lojaId: store.id, pedidoCompraItemId: item.id, quantidade: 2 });
    const salePayload = {
      canal: "OUTRO",
      dataVenda: new Date().toISOString(),
      moeda: "USD",
      itens: [{ produtoId: product.id, quantidade: 1, precoUnitario: 100 }]
    };
    const saleKey = randomUUID();
    mutationKeys.push(saleKey);
    const createSale = () => request(app).post("/sales").set(storeHeaders)
      .set("idempotency-key", saleKey).send(salePayload);
    const sale = await createSale();
    expect(sale.status).toBe(201);
    expect((await createSale()).body.id).toBe(sale.body.id);
    expect(await prisma.estoque.findUniqueOrThrow({
      where: { lojaId_produtoId: { lojaId: store.id, produtoId: product.id } }
    })).toMatchObject({ quantidadeFisica: 2, quantidadeReservada: 0 });
    expect((await request(app).get(`/sales/${sale.body.id}`)
      .set(headers(token, otherStore.id))).status).toBe(404);

    const suggestion = await request(app).get(`/sales/${sale.body.id}/lot-suggestion`).set(storeHeaders);
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.itens).toEqual([expect.objectContaining({
      vendaItemId: sale.body.itens[0].id,
      faltante: 0,
      lotes: [expect.objectContaining({ movimentoEntradaId: lots[0].id, quantidade: 1, custoConhecido: true })]
    })]);
    const confirmationKey = randomUUID();
    mutationKeys.push(confirmationKey);
    const confirmSale = () => request(app).post(`/sales/${sale.body.id}/confirm`).set(storeHeaders)
      .set("idempotency-key", confirmationKey).send({ lotes: [{
        vendaItemId: sale.body.itens[0].id, movimentoEntradaId: lots[0].id, quantidade: 1
      }] });
    const sold = await confirmSale();
    expect(sold.status).toBe(200);
    expect(sold.body).toMatchObject({
      estado: "CONFIRMADA", receitaLiquida: "100.00", custo: "50.00", lucro: "50.00", margem: "50.00"
    });
    expect((await confirmSale()).body.id).toBe(sale.body.id);
    expect(await prisma.estoque.findUniqueOrThrow({
      where: { lojaId_produtoId: { lojaId: store.id, produtoId: product.id } }
    })).toMatchObject({ quantidadeFisica: 1, quantidadeReservada: 0 });
    expect(await prisma.movimentacaoEstoque.count({
      where: { produtoId: product.id, tipo: "EXIT", motivo: "SALE" }
    })).toBe(1);
    expect(await prisma.baixaVenda.count({ where: { movimentoEntradaId: lots[0].id } })).toBe(1);

    for (const [amount, expectedStatus] of [[40, "PARCIAL"], [60, "RECEBIDO"]] as const) {
      const receiptKey = randomUUID();
      mutationKeys.push(receiptKey);
      const payload = { valor: amount, recebidoEm: new Date().toISOString() };
      const receive = () => request(app).post(`/sales/${sale.body.id}/receipts`).set(storeHeaders)
        .set("idempotency-key", receiptKey).send(payload);
      const result = await receive();
      expect(result.status).toBe(201);
      expect(result.body.status).toBe(expectedStatus);
      expect((await receive()).body).toEqual(result.body);
    }
    const receivable = await prisma.recebivelVenda.findUniqueOrThrow({ where: { vendaId: sale.body.id } });
    expect(receivable.valorRecebido.toFixed(2)).toBe("100.00");
    expect(await prisma.auditLog.count({
      where: { entity: "RecebivelVenda", entityId: receivable.id, action: "RECEIVE_SALE" }
    })).toBe(2);

    const after = await indicators(store.id);
    const otherAfter = await indicators(otherStore.id);
    expect(after.status).toBe(200);
    expect(otherAfter.status).toBe(200);
    for (const [code, dimension, delta] of [
      ["ESTOQUE_BR", "DISPONIVEL", 1],
      ["VENDAS_POR_CANAL", "OUTRO", 100],
      ["FLUXO_FINANCEIRO", "RECEBIMENTO_VENDA", 100]
    ] as const) {
      expect(indicatorValue(after.body.linhas, code, dimension))
        .toBe(indicatorValue(before.body.linhas, code, dimension) + delta);
      expect(indicatorValue(otherAfter.body.linhas, code, dimension))
        .toBe(indicatorValue(otherBefore.body.linhas, code, dimension));
    }
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
    expect((await move("EXIT", "SALE", 2)).body.error).toBe(
      "sale_requires_sales_module"
    );
    expect((await move("EXIT", "LOSS", 2)).status).toBe(200);
    expect((await move("EXIT", "LOSS", 2)).status).toBe(409);
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
