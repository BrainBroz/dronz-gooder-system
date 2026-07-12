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

async function eligibleFixture(lojaId: string, received = 2, rejected = 0) {
  const data = await createOperationalFixture(prisma, lojaId);
  fixtures.push(data);
  await prisma.viagem.update({ where: { id: data.trip.id }, data: { status: "ARRIVED_BRAZIL", chegadaRealEm: new Date() } });
  await prisma.mala.update({ where: { id: data.bag.id }, data: { status: "ARRIVED_BRAZIL" } });
  await prisma.recebimentoMiami.create({ data: {
    lojaId, pedidoCompraItemId: data.item.id, quantidadeRecebida: 2,
    recebidoEm: new Date(), confirmadoPorId: data.admin.id
  } });
  await prisma.checkpointParaguai.create({ data: {
    lojaId, viagemId: data.trip.id, malaId: data.bag.id,
    confirmadoPorId: data.admin.id, confirmadoEm: new Date()
  } });
  await prisma.checkpointBrasil.create({ data: {
    lojaId, viagemId: data.trip.id, malaId: data.bag.id,
    confirmadoPorId: data.admin.id, confirmadoEm: new Date()
  } });
  const receipt = await prisma.recebimento.create({ data: {
    lojaId, viagemId: data.trip.id, malaId: data.bag.id,
    confirmadoPorId: data.admin.id, iniciadoEm: new Date(),
    itens: { create: {
      pedidoCompraItemId: data.item.id, produtoId: data.product.id,
      quantidadeEsperada: Math.max(received + rejected, 2),
      quantidadeRecebida: received, quantidadeRejeitada: rejected
    } }
  }, include: { itens: true } });
  return { ...data, receipt, receiptItem: receipt.itens[0] };
}

const body = (data: { trip: { id: string }; bag: { id: string } }) => ({
  viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString()
});

describe("Batch 3.4 — Entrada Definitiva no Estoque", () => {
  it("move estoque após entrada definitiva", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id);
    const result = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("COMPLETED");
    const stock = await prisma.estoque.findUniqueOrThrow({ where: { lojaId_produtoId: { lojaId: dronz.id, produtoId: data.product.id } } });
    expect(stock.quantidadeFisica).toBe(2);
  });

  it("cria movimentação de estoque para auditoria", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id);
    await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    const movement = await prisma.movimentacaoEstoque.findFirstOrThrow({ where: { recebimentoId: data.receipt.id } });
    expect(movement.quantidade).toBe(2);
    expect(movement.quantidadeAnterior).toBe(0);
    expect(movement.quantidadePosterior).toBe(2);
  });

  it("bloqueia quando divergência elimina toda quantidade apta", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id, 1, 1);
    const result = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    expect(result.status).toBe(409);
  });

  it("bloqueia mala de outra loja", async () => {
    const { app, dronz, gooder, headers } = await session();
    const other = await eligibleFixture(gooder.id);
    const result = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(other));
    expect(result.status).toBe(404);
  });

  it("é idempotente", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id);
    const first = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    const second = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.movimentacaoEstoque.count({ where: { recebimentoId: data.receipt.id } })).toBe(1);
  });

  it("permite entrada parcial com rejeição", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id, 2, 1);
    const result = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    expect(result.status).toBe(200);
    const item = await prisma.recebimentoItem.findUniqueOrThrow({ where: { id: data.receiptItem.id } });
    expect(item.quantidadeJaIncorporada).toBe(1);
  });

  it("calcula recebida menos rejeitada menos incorporada", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id, 10, 2);
    await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    const item = await prisma.recebimentoItem.findUniqueOrThrow({ where: { id: data.receiptItem.id } });
    expect(item.quantidadeJaIncorporada).toBe(8);
  });

  it("bloqueia quando não há quantidade apta", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id, 0, 0);
    const result = await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    expect(result.status).toBe(409);
  });

  it("preserva quantidade incorporada em repetição idempotente", async () => {
    const { app, dronz, headers } = await session();
    const data = await eligibleFixture(dronz.id, 10, 0);
    await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    await request(app).post("/receiving/entrada-definitiva").set(headers(dronz.id)).send(body(data));
    const item = await prisma.recebimentoItem.findUniqueOrThrow({ where: { id: data.receiptItem.id } });
    expect(item.quantidadeJaIncorporada).toBe(10);
  });
});
