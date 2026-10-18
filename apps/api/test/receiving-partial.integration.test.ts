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
type Fixture = Awaited<ReturnType<typeof createOperationalFixture>>;
const fixtures: Fixture[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});
afterAll(() => prisma.$disconnect());

async function arrivedBag(quantity = 2) {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  fixtures.push(data);
  await prisma.pedidoCompraItem.update({
    where: { id: data.item.id },
    data: { quantidade: quantity, quantidadeRecebidaMiami: quantity }
  });
  await prisma.alocacaoMala.update({
    where: { id: data.allocation.id },
    data: { quantidade: quantity }
  });
  await prisma.recebimentoMiami.create({
    data: {
      lojaId: store.id,
      pedidoCompraItemId: data.item.id,
      quantidadeRecebida: quantity,
      recebidoEm: new Date(),
      confirmadoPorId: data.admin.id
    }
  });
  await prisma.viagem.update({
    where: { id: data.trip.id },
    data: { status: "ARRIVED_BRAZIL", chegadaRealEm: new Date() }
  });
  await prisma.mala.update({
    where: { id: data.bag.id },
    data: { status: "ARRIVED_BRAZIL" }
  });
  await prisma.checkpointBrasil.create({
    data: {
      lojaId: store.id,
      viagemId: data.trip.id,
      malaId: data.bag.id,
      confirmadoPorId: data.admin.id,
      confirmadoEm: new Date()
    }
  });
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const headers = {
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": store.id
  };
  const receiving = await request(app)
    .post("/receiving")
    .set(headers)
    .send({ viagemId: data.trip.id, malaId: data.bag.id });
  expect(receiving.status).toBe(200);
  const item = await prisma.recebimentoItem.findFirstOrThrow({
    where: { recebimentoId: receiving.body.id }
  });
  const confirm = (body: Record<string, unknown>) =>
    request(app)
      .post(`/receiving/${receiving.body.id}/items/${item.id}/confirm`)
      .set(headers)
      .send(body);
  const entry = () =>
    request(app)
      .post("/receiving/entrada-definitiva")
      .set(headers)
      .send({
        viagemId: data.trip.id,
        malaId: data.bag.id,
        confirmadoEm: new Date().toISOString()
      });
  const stock = async () =>
    (await prisma.estoque.findFirst({ where: { produtoId: data.product.id } }))
      ?.quantidadeFisica ?? 0;
  return {
    app,
    headers,
    data,
    receiving: receiving.body,
    item,
    confirm,
    entry,
    stock
  };
}

describe("recebimento parcial e entrada das unidades aptas (X-07, DEC-DOM-003)", () => {
  it("rejeitadas fazem parte das recebidas: 1 boa e 1 avariada incorporam 1 unidade", async () => {
    const flow = await arrivedBag(2);
    expect(
      (
        await flow.confirm({
          quantidadeRecebida: 1,
          quantidadeRejeitada: 2,
          tipoDivergencia: "AVARIA",
          observacoes: "x"
        })
      ).status
    ).toBe(409);
    expect(
      (
        await flow.confirm({
          quantidadeRecebida: 2,
          quantidadeRejeitada: 1,
          tipoDivergencia: "AVARIA",
          observacoes: "1 avariada"
        })
      ).status
    ).toBe(200);
    expect((await flow.entry()).status).toBe(200);
    expect(await flow.stock()).toBe(1);
    expect(
      (
        await prisma.recebimentoItem.findUniqueOrThrow({
          where: { id: flow.item.id }
        })
      ).quantidadeJaIncorporada
    ).toBe(1);
  });

  it("exemplo da especificação: 10 esperadas, 8 chegam (7 aptas, 1 avariada); entra 7, depois entram as 2 restantes", async () => {
    const flow = await arrivedBag(10);
    expect(
      (
        await flow.confirm({
          quantidadeRecebida: 8,
          quantidadeRejeitada: 1,
          tipoDivergencia: "AVARIA",
          observacoes: "1 avariada"
        })
      ).status
    ).toBe(200);
    expect(
      (
        await prisma.recebimento.findUniqueOrThrow({
          where: { id: flow.receiving.id }
        })
      ).status
    ).toBe("PARTIALLY_COMPLETED");
    const candidates = await request(flow.app)
      .get("/operations/definitive-entry/candidates")
      .set(flow.headers);
    const candidate = candidates.body.find(
      (entry: { id: string }) => entry.id === flow.receiving.id
    );
    expect(candidate).toMatchObject({ impactQuantity: 7, blockedReasons: [] });
    expect((await flow.entry()).status).toBe(200);
    expect(await flow.stock()).toBe(7);
    // Conferir as que faltavam libera nova entrada parcial; o estoque nunca soma conferência sem entrada.
    expect(
      (
        await flow.confirm({
          quantidadeRecebida: 2,
          quantidadeRejeitada: 0,
          tipoDivergencia: "CORRETO"
        })
      ).status
    ).toBe(200);
    expect(await flow.stock()).toBe(7);
    const second = await flow.entry();
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(await flow.stock()).toBe(9);
    const repeat = await flow.entry();
    expect(repeat.body.id).toBe(second.body.id);
    expect(await flow.stock()).toBe(9);
    expect(
      await prisma.estoqueEntrada.count({ where: { malaId: flow.data.bag.id } })
    ).toBe(1);
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: flow.data.product.id, tipo: "ENTRY" }
      })
    ).toBe(2);
  });

  it("sobra não resolvida bloqueia a entrada do item e aparece no read model", async () => {
    const flow = await arrivedBag(2);
    expect(
      (
        await flow.confirm({
          quantidadeRecebida: 3,
          quantidadeRejeitada: 0,
          tipoDivergencia: "EXCESSO",
          observacoes: "veio 1 a mais"
        })
      ).status
    ).toBe(200);
    const candidates = await request(flow.app)
      .get("/operations/definitive-entry/candidates")
      .set(flow.headers);
    const candidate = candidates.body.find(
      (entry: { id: string }) => entry.id === flow.receiving.id
    );
    expect(candidate.items[0]).toMatchObject({
      entradaBloqueada: true,
      quantidadeAptaPendente: 0
    });
    expect((await flow.entry()).body.error).toBe("no_apt_quantity");
    expect(await flow.stock()).toBe(0);
  });
});
