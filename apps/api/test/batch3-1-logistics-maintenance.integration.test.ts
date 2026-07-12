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
let fixture: Awaited<ReturnType<typeof createOperationalFixture>> | undefined;
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => { await fixture?.cleanup(); fixture = undefined; });
afterAll(() => prisma.$disconnect());

async function context() {
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  const store = login.body.stores.find((item: { slug: string }) => item.slug === "dronz");
  fixture = await createOperationalFixture(prisma, store.id);
  const headers = { Authorization: `Bearer ${login.body.accessToken}`, "x-store-id": store.id };
  return { app, store, data: fixture, headers };
}

describe("Batch 3.1 — Complementação da Logística", () => {
  it("atualiza viajante", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).patch(`/logistics/travelers/${data.traveler.id}`).set(headers).send({
      nome: "João Atualizado", email: "joao@example.com", telefone: "21999999999", observacoes: "Atualizado"
    });
    expect(result.status).toBe(200);
    expect(result.body.nome).toBe("João Atualizado");
    expect(result.body.email).toBe("joao@example.com");
  });

  it("desativa viajante", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).patch(`/logistics/travelers/${data.traveler.id}`).set(headers).send({ ativo: false });
    expect(result.status).toBe(200);
    expect(result.body.ativo).toBe(false);
  });

  it("deleta viajante sem viagens", async () => {
    const { app, store, headers } = await context();
    const traveler = await prisma.viajante.create({ data: { lojaId: store.id, nome: "Sem viagem" } });
    const result = await request(app).delete(`/logistics/travelers/${traveler.id}`).set(headers);
    expect(result.status).toBe(200);
    expect(await prisma.viajante.findUnique({ where: { id: traveler.id } })).toBeNull();
  });

  it("bloqueia deleção de viajante com viagem", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).delete(`/logistics/travelers/${data.traveler.id}`).set(headers);
    expect(result.status).toBe(409);
  });

  it("atualiza viagem PLANNED", async () => {
    const { app, data, headers } = await context();
    await prisma.viagem.update({ where: { id: data.trip.id }, data: { status: "PLANNED" } });
    const result = await request(app).patch(`/logistics/trips/${data.trip.id}`).set(headers).send({
      origem: "Nova York", destino: "Rio de Janeiro", observacoes: "Atualizada"
    });
    expect(result.status).toBe(200);
    expect(result.body.origem).toBe("Nova York");
    expect(result.body.destino).toBe("Rio de Janeiro");
  });

  it("bloqueia atualização de viagem fora de PLANNED", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).patch(`/logistics/trips/${data.trip.id}`).set(headers).send({ origem: "Outro lugar" });
    expect(result.status).toBe(409);
  });

  it("deleta viagem PLANNED sem dependências", async () => {
    const { app, store, data, headers } = await context();
    const trip = await prisma.viagem.create({ data: {
      lojaId: store.id, viajanteId: data.traveler.id, origem: "Miami", destino: "Brasil",
      partidaEm: new Date(Date.now() + 86_400_000), chegadaPrevistaEm: new Date(Date.now() + 172_800_000), status: "PLANNED"
    } });
    const result = await request(app).delete(`/logistics/trips/${trip.id}`).set(headers);
    expect(result.status).toBe(200);
    expect(await prisma.viagem.findUnique({ where: { id: trip.id } })).toBeNull();
  });

  it("atualiza mala em planejamento", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).patch(`/logistics/suitcases/${data.bag.id}`).set(headers).send({
      codigo: `UPDATED-${data.bag.id}`, limitePesoKg: 20, observacoes: "Atualizada"
    });
    expect(result.status).toBe(200);
    expect(Number(result.body.limitePesoKg)).toBe(20);
  });

  it("deleta mala em planejamento sem alocações", async () => {
    const { app, store, data, headers } = await context();
    const bag = await prisma.mala.create({ data: { lojaId: store.id, viagemId: data.trip.id, codigo: `EMPTY-${data.bag.id}` } });
    const result = await request(app).delete(`/logistics/suitcases/${bag.id}`).set(headers);
    expect(result.status).toBe(200);
    expect(await prisma.mala.findUnique({ where: { id: bag.id } })).toBeNull();
  });

  it("atualiza volume de mala em planejamento", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).patch(`/logistics/suitcases/${data.bag.id}/volumes/${data.volume.id}`).set(headers).send({
      codigo: `UPDATED-${data.volume.id}`, taraKg: 0.8
    });
    expect(result.status).toBe(200);
    expect(Number(result.body.taraKg)).toBe(0.8);
  });

  it("deleta alocação de mala em planejamento", async () => {
    const { app, data, headers } = await context();
    const result = await request(app).delete(`/logistics/allocations/${data.allocation.id}`).set(headers);
    expect(result.status).toBe(200);
    expect(await prisma.alocacaoMala.findUnique({ where: { id: data.allocation.id } })).toBeNull();
  });

  it("bloqueia mutação da mala após checkpoint", async () => {
    const { app, data, headers } = await context();
    await prisma.mala.update({ where: { id: data.bag.id }, data: { status: "CLOSED" } });
    const update = await request(app).patch(`/logistics/suitcases/${data.bag.id}`).set(headers).send({ codigo: "NOVO" });
    const remove = await request(app).delete(`/logistics/suitcases/${data.bag.id}`).set(headers);
    expect(update.status).toBe(409);
    expect(remove.status).toBe(409);
  });
});
