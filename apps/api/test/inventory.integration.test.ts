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
  await prisma.movimentacaoEstoque.deleteMany();
  await prisma.recebimentoItem.deleteMany();
  await prisma.recebimento.deleteMany();
  await prisma.estoque.updateMany({
    data: { quantidadeFisica: 0, quantidadeReservada: 0 }
  });
  await prisma.viagem.updateMany({
    data: { status: "OPEN_FOR_ALLOCATION", chegadaRealEm: null }
  });
  await prisma.mala.updateMany({ data: { status: "PLANNING" } });
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
  it("bloqueia antes do Brasil e confirma entrada atômica após chegada", async () => {
    const { app, token, dronz } = await session();
    const trip = await prisma.viagem.findFirstOrThrow({
      where: { lojaId: dronz.id }
    });
    const bag = await prisma.mala.findFirstOrThrow({
      where: { lojaId: dronz.id }
    });
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
    const created = await request(app)
      .post("/receiving")
      .set(headers(token, dronz.id))
      .send({ viagemId: trip.id, malaId: bag.id });
    expect(created.status).toBe(200);
    const detail = (
      await request(app).get("/receiving").set(headers(token, dronz.id))
    ).body[0];
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
    ).toBe(2);
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
    const stock = await prisma.estoque.findFirstOrThrow({
      where: { lojaId: dronz.id }
    });
    await prisma.estoque.update({
      where: { id: stock.id },
      data: { quantidadeFisica: 3 }
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
