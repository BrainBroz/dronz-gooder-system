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
afterAll(() => prisma.$disconnect());
async function s() {
  const app = createApp(),
    l = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    t: l.body.accessToken,
    d: l.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
    g: l.body.stores.find((x: { slug: string }) => x.slug === "gooder")
  };
}
const h = (t: string, id: string) => ({
  Authorization: `Bearer ${t}`,
  "x-store-id": id
});
describe("international logistics", () => {
  it("isola lojas, omite documento e calcula conteúdo mais tara", async () => {
    const { app, t, d, g } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const travelers = await request(app)
      .get("/logistics/travelers")
      .set(h(t, d.id));
    expect(travelers.status).toBe(200);
    const traveler = travelers.body.find((item: { id: string }) => item.id === fixture?.traveler.id);
    expect(traveler).toBeTruthy();
    expect(traveler.documento).toBeUndefined();
    const bag = fixture.bag;
    const weight = await request(app)
      .get(`/logistics/suitcases/${bag.id}/weight`)
      .set(h(t, d.id));
    expect(Number(weight.body.conteudoKg)).toBe(1);
    expect(Number(weight.body.taraKg)).toBe(0.5);
    expect(Number(weight.body.totalKg)).toBe(1.5);
    expect(
      (
        await request(app)
          .get(`/logistics/suitcases/${bag.id}/weight`)
          .set(h(t, g.id))
      ).status
    ).toBe(404);
  });
  it("valida transições e confirmação Miami sem gerar estoque", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, item } = fixture;
    expect(
      (
        await request(app)
          .patch(`/logistics/trips/${trip.id}/status`)
          .set(h(t, d.id))
          .send({ status: "ARRIVED_BRAZIL" })
      ).status
    ).toBe(409);
    const partial = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(Date.now() - 90000000).toISOString()
      });
    expect(partial.status).toBe(200);
    expect(partial.body.atraso).toBe(true);
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: item.pedidoCompraId }
        })
      ).status
    ).toBe("PARTIALLY_RECEIVED_MIAMI");
    await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString()
      });
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: item.pedidoCompraId }
        })
      ).status
    ).toBe("RECEIVED_MIAMI");
  });
});
