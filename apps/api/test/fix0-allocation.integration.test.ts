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
  if (fixture) {
    await prisma.alocacaoMala.deleteMany({
      where: { pedidoCompraItemId: fixture.item.id }
    });
    await fixture.cleanup();
    fixture = undefined;
  }
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
    d: l.body.stores.find((x: { slug: string }) => x.slug === "dronz")
  };
}
const h = (t: string, id: string) => ({
  Authorization: `Bearer ${t}`,
  "x-store-id": id
});
describe("FIX-0 — alocação limitada ao recebido em Miami", () => {
  it("bloqueia alocação de quantidade ainda não recebida e libera após o recebimento", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    // O fixture cria uma alocação direta via Prisma; remove para exercitar o serviço.
    await prisma.alocacaoMala.deleteMany({
      where: { pedidoCompraItemId: fixture.item.id }
    });
    // A unique (item, mala, volume) exige volumes distintos por alocação.
    const volumeB = await prisma.volumeLogistico.create({
      data: {
        lojaId: d.id,
        malaId: fixture.bag.id,
        codigo: `BOX-B-${fixture.item.id}`,
        taraKg: 0.5
      }
    });
    const volumeC = await prisma.volumeLogistico.create({
      data: {
        lojaId: d.id,
        malaId: fixture.bag.id,
        codigo: `BOX-C-${fixture.item.id}`,
        taraKg: 0.5
      }
    });
    const body = (volumeLogisticoId: string) => ({
      pedidoCompraItemId: fixture!.item.id,
      malaId: fixture!.bag.id,
      volumeLogisticoId,
      quantidade: 1
    });
    try {
      // Nada recebido em Miami: alocar 1 unidade deve falhar.
      const semRecebimento = await request(app)
        .post("/logistics/allocations")
        .set(h(t, d.id))
        .send(body(fixture.volume.id));
      expect(semRecebimento.status).toBe(409);
      // Recebida 1 de 2 unidades: alocar 1 passa, a segunda continua bloqueada.
      await prisma.pedidoCompraItem.update({
        where: { id: fixture.item.id },
        data: { quantidadeRecebidaMiami: 1 }
      });
      const dentroDoRecebido = await request(app)
        .post("/logistics/allocations")
        .set(h(t, d.id))
        .send(body(fixture.volume.id));
      expect(dentroDoRecebido.status).toBe(200);
      const acimaDoRecebido = await request(app)
        .post("/logistics/allocations")
        .set(h(t, d.id))
        .send(body(volumeB.id));
      expect(acimaDoRecebido.status).toBe(409);
      // Recebimento total libera o restante até o limite do recebido.
      await prisma.pedidoCompraItem.update({
        where: { id: fixture.item.id },
        data: { quantidadeRecebidaMiami: 2 }
      });
      const aposRecebimentoTotal = await request(app)
        .post("/logistics/allocations")
        .set(h(t, d.id))
        .send(body(volumeB.id));
      expect(aposRecebimentoTotal.status).toBe(200);
      const acimaDoTotal = await request(app)
        .post("/logistics/allocations")
        .set(h(t, d.id))
        .send(body(volumeC.id));
      expect(acimaDoTotal.status).toBe(409);
    } finally {
      await prisma.alocacaoMala.deleteMany({
        where: { pedidoCompraItemId: fixture.item.id }
      });
      await prisma.volumeLogistico.deleteMany({
        where: { id: { in: [volumeB.id, volumeC.id] } }
      });
    }
  });
});
