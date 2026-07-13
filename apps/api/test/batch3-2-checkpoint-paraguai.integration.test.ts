import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createOperationalFixture } from "./helpers/operational-fixture";

process.env.DATABASE_URL = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const fixtures: Awaited<ReturnType<typeof createOperationalFixture>>[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const fixture of fixtures.reverse()) await fixture.cleanup();
  fixtures.length = 0;
});
afterAll(() => prisma.$disconnect());

async function session() {
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  const dronz = login.body.stores.find((store: { slug: string }) => store.slug === "dronz");
  const gooder = login.body.stores.find((store: { slug: string }) => store.slug === "gooder");
  const headers = (lojaId: string) => ({ Authorization: `Bearer ${login.body.accessToken}`, "x-store-id": lojaId });
  return { app, dronz, gooder, headers };
}

async function fixture(lojaId: string) {
  const value = await createOperationalFixture(prisma, lojaId, "MIAMI_PARAGUAI_BRASIL");
  fixtures.push(value);
  await prisma.viagem.update({ where: { id: value.trip.id }, data: { status: "IN_TRANSIT" } });
  await prisma.mala.update({ where: { id: value.bag.id }, data: { status: "CHECKED_IN" } });
  return value;
}

describe("Batch 3.2 — Check-in Paraguai", () => {
  it.each(["CORRETO", "MALA_AUSENTE", "QUANTIDADE_DIVERGENTE", "AVARIA", "ITEM_EXTRA"])(
    "confirma checkpoint com divergência %s",
    async (tipoDivergencia) => {
      const { app, dronz, headers } = await session();
      const data = await fixture(dronz.id);
      const result = await request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
        viagemId: data.trip.id,
        malaId: data.bag.id,
        confirmadoEm: new Date().toISOString(),
        observacao: `Divergência ${tipoDivergencia}`,
        tipoDivergencia
      });
      expect(result.status).toBe(200);
      expect(result.body.tipoDivergencia).toBe(tipoDivergencia);
      expect(result.body.lojaId).toBe(dronz.id);
    }
  );

  it("bloqueia viagem inválida", async () => {
    const { app, dronz, headers } = await session();
    const data = await fixture(dronz.id);
    const result = await request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
      viagemId: "invalid-trip",
      malaId: data.bag.id,
      confirmadoEm: new Date().toISOString(),
      tipoDivergencia: "CORRETO"
    });
    expect(result.status).toBe(404);
  });

  it("bloqueia mala inválida", async () => {
    const { app, dronz, headers } = await session();
    const data = await fixture(dronz.id);
    const result = await request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
      viagemId: data.trip.id,
      malaId: "invalid-bag",
      confirmadoEm: new Date().toISOString(),
      tipoDivergencia: "CORRETO"
    });
    expect(result.status).toBe(404);
  });

  it("bloqueia mala de outra loja", async () => {
    const { app, dronz, gooder, headers } = await session();
    const other = await fixture(gooder.id);
    const result = await request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
      viagemId: other.trip.id,
      malaId: other.bag.id,
      confirmadoEm: new Date().toISOString(),
      tipoDivergencia: "CORRETO"
    });
    expect(result.status).toBe(404);
  });

  it("confirma duas malas da mesma viagem", async () => {
    const { app, dronz, headers } = await session();
    const data = await fixture(dronz.id);
    const secondBag = await prisma.mala.create({ data: { lojaId: dronz.id, viagemId: data.trip.id, codigo: `SECOND-${data.bag.id}`, status: "CHECKED_IN" } });
    const send = (malaId: string) => request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
      viagemId: data.trip.id, malaId, confirmadoEm: new Date().toISOString(), tipoDivergencia: "CORRETO"
    });
    const first = await send(data.bag.id);
    const second = await send(secondBag.id);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.malaId).not.toBe(second.body.malaId);
    await prisma.checkpointParaguai.deleteMany({ where: { malaId: secondBag.id } });
    await prisma.mala.delete({ where: { id: secondBag.id } });
  });

  it("registra usuário, timestamp e observação", async () => {
    const { app, dronz, headers } = await session();
    const data = await fixture(dronz.id);
    const result = await request(app).post("/logistics/checkpoint-paraguai").set(headers(dronz.id)).send({
      viagemId: data.trip.id,
      malaId: data.bag.id,
      confirmadoEm: new Date().toISOString(),
      observacao: "Teste determinístico"
    });
    expect(result.status).toBe(200);
    expect(result.body.confirmadoPorId).toBe(data.admin.id);
    expect(result.body.createdAt).toBeDefined();
    expect(result.body.observacao).toBe("Teste determinístico");
  });
});
