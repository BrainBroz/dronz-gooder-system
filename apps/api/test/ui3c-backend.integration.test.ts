import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
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
const users: string[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  await prisma.eventoCorretivo.deleteMany({ where: { usuarioId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { usuarioId: { in: users } } });
  await prisma.refreshToken.deleteMany({ where: { usuarioId: { in: users } } });
  await prisma.usuarioLoja.deleteMany({ where: { usuarioId: { in: users } } });
  await prisma.usuario.deleteMany({ where: { id: { in: users } } });
  users.length = 0;
  for (const fixture of fixtures.reverse()) await fixture.cleanup();
  fixtures.length = 0;
});
afterAll(() => prisma.$disconnect());

async function session(email = "admin@example.com", password = "change-me") {
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email, password });
  const store = login.body.stores.find((entry: { slug: string }) => entry.slug === "dronz");
  const headers = (storeId = store?.id, key?: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": storeId,
    ...(key ? { "idempotency-key": key } : {})
  });
  return { app, login, store, headers };
}

async function fixture(route: "MIAMI_BRASIL" | "MIAMI_PARAGUAI_BRASIL" = "MIAMI_BRASIL") {
  const store = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  const value = await createOperationalFixture(prisma, store.id, route);
  fixtures.push(value);
  return value;
}

async function arrive(value: Awaited<ReturnType<typeof createOperationalFixture>>) {
  await prisma.viagem.update({ where: { id: value.trip.id }, data: { status: "ARRIVED_BRAZIL", chegadaRealEm: new Date() } });
  await prisma.mala.update({ where: { id: value.bag.id }, data: { status: "ARRIVED_BRAZIL" } });
}

describe("UI-3C backend", () => {
  it("expõe overview tenant-safe e sem campos financeiros no read model Miami", async () => {
    const { app, store, headers } = await session();
    const data = await fixture();
    await prisma.pedidoCompra.update({ where: { id: data.order.id }, data: { status: "CONFIRMED" } });
    const overview = await request(app).get("/operations/overview").set(headers());
    const candidates = await request(app).get("/operations/miami/candidates").set(headers());
    expect(overview.status).toBe(200);
    expect(overview.body.lojaId).toBe(store.id);
    expect(overview.body.totals.miamiPending).toBeGreaterThanOrEqual(1);
    const candidate = candidates.body.find((entry: { id: string }) => entry.id === data.item.id);
    expect(candidate.allowedActions).toContain("CONFIRM_MIAMI");
    expect(JSON.stringify(candidate)).not.toContain("precoUnitario");
    expect(JSON.stringify(candidate)).not.toContain("totalItem");
  });

  it("nega leitura e escrita a usuário vinculado sem permissão", async () => {
    const store = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
    const email = `limited-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({ data: { name: "Limited", email, passwordHash: await bcrypt.hash("change-me", 12), lojas: { create: { lojaId: store.id } } } });
    users.push(user.id);
    const { app, headers } = await session(email);
    expect((await request(app).get("/operations/overview").set(headers())).status).toBe(403);
    const data = await fixture();
    expect((await request(app).post("/logistics/miami-confirmations").set(headers()).send({ pedidoCompraItemId: data.item.id, quantidadeRecebida: 1, recebidoEm: new Date().toISOString() })).status).toBe(403);
  });

  it("representa Paraguai como não aplicável e não como pendente", async () => {
    const { app, headers } = await session();
    const data = await fixture("MIAMI_BRASIL");
    const result = await request(app).get("/operations/paraguay/candidates").set(headers());
    const candidate = result.body.find((entry: { id: string }) => entry.id === data.bag.id);
    expect(candidate.status).toBe("NOT_APPLICABLE");
    expect(candidate.blockedReasons[0].code).toBe("CHECKPOINT_NOT_APPLICABLE");
  });

  it("bloqueia Brasil quando Paraguai é obrigatório e libera após a transição válida", async () => {
    const { app, headers } = await session();
    const data = await fixture("MIAMI_PARAGUAI_BRASIL");
    await arrive(data);
    const payload = { viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString() };
    expect((await request(app).post("/logistics/checkpoint-brasil").set(headers()).send(payload)).body.error).toBe("checkpoint_required");
    await prisma.viagem.update({ where: { id: data.trip.id }, data: { status: "IN_TRANSIT", chegadaRealEm: null } });
    await prisma.mala.update({ where: { id: data.bag.id }, data: { status: "CHECKED_IN" } });
    expect((await request(app).post("/logistics/checkpoint-paraguai").set(headers()).send(payload)).status).toBe(200);
    await arrive(data);
    expect((await request(app).post("/logistics/checkpoint-brasil").set(headers()).send(payload)).status).toBe(200);
  });

  it("permite rota sem Paraguai e aplica idempotência persistente no Brasil", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const payload = { viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString() };
    const key = randomUUID();
    const first = await request(app).post("/logistics/checkpoint-brasil").set(headers(undefined, key)).send(payload);
    const replay = await request(app).post("/logistics/checkpoint-brasil").set(headers(undefined, key)).send(payload);
    const conflict = await request(app).post("/logistics/checkpoint-brasil").set(headers(undefined, key)).send({ ...payload, observacao: "different" });
    expect(first.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(conflict.body.error).toBe("idempotency_conflict");
    expect(await prisma.checkpointBrasil.count({ where: { malaId: data.bag.id, supersededAt: null } })).toBe(1);
  });

  it("registra auditoria estruturada na mesma mutação", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const key = randomUUID();
    const result = await request(app).post("/logistics/checkpoint-brasil").set(headers(undefined, key)).send({ viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString() });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: result.body.id, action: "CONFIRM_BRAZIL" } });
    expect(audit.lojaId).toBe(data.bag.lojaId);
    expect(audit.permissionCode).toBe("BRASIL_CHECKPOINT_CONFIRMAR");
    expect(audit.idempotencyKey).toBe(key);
    expect(audit.correlationId).toBeTruthy();
  });

  it("preserva o checkpoint original ao criar correção auditável", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const original = await request(app).post("/logistics/checkpoint-brasil").set(headers()).send({ viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString(), tipoDivergencia: "CORRETO" });
    const correction = await request(app).post("/operations/corrections").set(headers(undefined, randomUUID())).send({
      entity: "CheckpointBrasil", originalEventId: original.body.id, correctionType: "DIVERGENCIA", reason: "Avaria constatada", after: { tipoDivergencia: "AVARIA" }
    });
    expect(correction.status).toBe(200);
    expect((await prisma.checkpointBrasil.findUniqueOrThrow({ where: { id: original.body.id } })).tipoDivergencia).toBe("CORRETO");
    expect((await prisma.eventoCorretivo.findUniqueOrThrow({ where: { id: correction.body.id } })).originalEventId).toBe(original.body.id);
    const projected = await request(app).get("/operations/brazil/candidates").set(headers());
    const candidate = projected.body.find((entry: { id: string }) => entry.id === data.bag.id);
    expect(candidate.status).toBe("DIVERGENT");
    expect(candidate.allowedActions).toEqual([]);
    expect(candidate.checkpoint.tipoDivergencia).toBe("AVARIA");
  });

  it("read model de Brasil informa bloqueio e depois ação permitida", async () => {
    const { app, headers } = await session();
    const data = await fixture("MIAMI_PARAGUAI_BRASIL");
    await arrive(data);
    const blocked = await request(app).get("/operations/brazil/candidates").set(headers());
    expect(blocked.body.find((entry: { id: string }) => entry.id === data.bag.id).blockedReasons[0].code).toBe("CHECKPOINT_REQUIRED");
    await prisma.checkpointParaguai.create({ data: { lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id, confirmadoPorId: data.admin.id, confirmadoEm: new Date() } });
    const ready = await request(app).get("/operations/brazil/candidates").set(headers());
    expect(ready.body.find((entry: { id: string }) => entry.id === data.bag.id).allowedActions).toContain("CONFIRM_BRAZIL");
  });

  it("não permite enumeração cross-store nos detalhes", async () => {
    const { app, login, headers } = await session();
    const gooder = login.body.stores.find((entry: { slug: string }) => entry.slug === "gooder");
    const other = await createOperationalFixture(prisma, gooder.id);
    fixtures.push(other);
    await prisma.pedidoCompra.update({ where: { id: other.order.id }, data: { status: "CONFIRMED" } });
    expect((await request(app).get(`/operations/miami/items/${other.item.id}`).set(headers())).status).toBe(404);
  });

  it("read models de recebimento e entrada definitiva retornam bloqueios e impacto", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    await prisma.checkpointBrasil.create({ data: { lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id, confirmadoPorId: data.admin.id, confirmadoEm: new Date() } });
    const receivingCandidates = await request(app).get("/operations/receiving/candidates").set(headers());
    expect(receivingCandidates.body.find((entry: { id: string }) => entry.id === data.bag.id).allowedActions).toContain("OPEN_RECEIVING");
    const receipt = await prisma.recebimento.create({ data: {
      lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id, status: "COMPLETED",
      iniciadoEm: new Date(), concluidoEm: new Date(), confirmadoPorId: data.admin.id,
      itens: { create: { pedidoCompraItemId: data.item.id, produtoId: data.product.id, quantidadeEsperada: 2, quantidadeRecebida: 2 } }
    } });
    await prisma.recebimentoMiami.create({ data: {
      lojaId: data.bag.lojaId, pedidoCompraItemId: data.item.id, quantidadeRecebida: 2,
      recebidoEm: new Date(), confirmadoPorId: data.admin.id
    } });
    const candidates = await request(app).get("/operations/definitive-entry/candidates").set(headers());
    const candidate = candidates.body.find((entry: { id: string }) => entry.id === receipt.id);
    expect(candidate.impactQuantity).toBe(2);
    expect(candidate.allowedActions).toContain("POST_DEFINITIVE_ENTRY");
  });

  it("correção pós-estoque cria movimento compensatório vinculado", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const checkpoint = await prisma.checkpointBrasil.create({ data: { lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id, confirmadoPorId: data.admin.id, confirmadoEm: new Date() } });
    const stock = await prisma.estoque.create({ data: { lojaId: data.bag.lojaId, produtoId: data.product.id, quantidadeFisica: 15 } });
    const originalMovement = await prisma.movimentacaoEstoque.create({ data: {
      lojaId: data.bag.lojaId, produtoId: data.product.id, estoqueId: stock.id, tipo: "ENTRY", motivo: "PURCHASE_RECEIPT",
      quantidade: 5, quantidadeAnterior: 0, quantidadePosterior: 5, responsavelId: data.admin.id
    } });
    const correction = await request(app).post("/operations/corrections").set(headers(undefined, randomUUID())).send({
      entity: "CheckpointBrasil", originalEventId: checkpoint.id, correctionType: "STOCK_COMPENSATION", reason: "Duas unidades avariadas",
      after: { tipoDivergencia: "AVARIA" }, adjustments: [{ productId: data.product.id, quantityDelta: -2, originalMovementId: originalMovement.id }]
    });
    expect(correction.status).toBe(200);
    expect((await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } })).quantidadeFisica).toBe(13);
    const movement = await prisma.movimentacaoEstoque.findFirstOrThrow({ where: { movimentoOriginalId: originalMovement.id } });
    expect(movement.tipo).toBe("ADJUSTMENT_NEGATIVE");
    expect(movement.quantidadePosterior).toBe(13);
    const excessive = await request(app).post("/operations/corrections").set(headers(undefined, randomUUID())).send({
      entity: "CheckpointBrasil", originalEventId: checkpoint.id, correctionType: "STOCK_COMPENSATION", reason: "Tentativa acima do original",
      after: { tipoDivergencia: "AVARIA" }, adjustments: [{ productId: data.product.id, quantityDelta: -4, originalMovementId: originalMovement.id }]
    });
    expect(excessive.status).toBe(409);
    expect(excessive.body.error).toBe("correction_exceeds_original");
    const remaining = await request(app).post("/operations/corrections").set(headers(undefined, randomUUID())).send({
      entity: "CheckpointBrasil", originalEventId: checkpoint.id, correctionType: "STOCK_COMPENSATION", reason: "Compensação restante",
      after: { tipoDivergencia: "AVARIA" }, adjustments: [{ productId: data.product.id, quantityDelta: -3, originalMovementId: originalMovement.id }]
    });
    expect(remaining.status).toBe(200);
    expect((await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } })).quantidadeFisica).toBe(10);
  });

  it("serializa compensações concorrentes sem ultrapassar o movimento original", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const checkpoint = await prisma.checkpointBrasil.create({ data: { lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id, confirmadoPorId: data.admin.id, confirmadoEm: new Date() } });
    const stock = await prisma.estoque.create({ data: { lojaId: data.bag.lojaId, produtoId: data.product.id, quantidadeFisica: 15 } });
    const originalMovement = await prisma.movimentacaoEstoque.create({ data: {
      lojaId: data.bag.lojaId, produtoId: data.product.id, estoqueId: stock.id, tipo: "ENTRY", motivo: "PURCHASE_RECEIPT",
      quantidade: 5, quantidadeAnterior: 10, quantidadePosterior: 15, responsavelId: data.admin.id
    } });
    const send = () => request(app).post("/operations/corrections").set(headers(undefined, randomUUID())).send({
      entity: "CheckpointBrasil", originalEventId: checkpoint.id, correctionType: "STOCK_COMPENSATION", reason: "Compensação concorrente",
      after: { tipoDivergencia: "AVARIA" }, adjustments: [{ productId: data.product.id, quantityDelta: -4, originalMovementId: originalMovement.id }]
    });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.movimentacaoEstoque.count({ where: { movimentoOriginalId: originalMovement.id, tipo: "ADJUSTMENT_NEGATIVE" } })).toBe(1);
  });

  it("restringe overview e histórico do perfil Miami ao próprio escopo", async () => {
    const store = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
    const profile = await prisma.perfil.findUniqueOrThrow({ where: { code: "CHECKPOINT_MIAMI" } });
    const email = `miami-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({ data: {
      name: "Miami", email, passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: store.id } }, perfis: { create: { perfilId: profile.id } }
    } });
    users.push(user.id);
    const { app, headers } = await session(email);
    const overview = await request(app).get("/operations/overview").set(headers());
    expect(Object.keys(overview.body.totals).every((key) => key.startsWith("miami"))).toBe(true);
    expect((await request(app).get("/operations/brazil/candidates").set(headers())).status).toBe(403);
    expect((await request(app).get("/operations/history").query({ entity: "EstoqueEntrada" }).set(headers())).status).toBe(403);
  });

  it("não oferece ação quando a mesma policy rejeitaria a transição", async () => {
    const { app, headers } = await session();
    const data = await fixture("MIAMI_PARAGUAI_BRASIL");
    const blocked = await request(app).get("/operations/paraguay/candidates").set(headers());
    expect(blocked.body.find((entry: { id: string }) => entry.id === data.bag.id).allowedActions).toEqual([]);
    const payload = { viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString() };
    expect((await request(app).post("/logistics/checkpoint-paraguai").set(headers()).send(payload)).body.error).toBe("invalid_transition");
    await prisma.viagem.update({ where: { id: data.trip.id }, data: { status: "IN_TRANSIT" } });
    await prisma.mala.update({ where: { id: data.bag.id }, data: { status: "CHECKED_IN" } });
    const ready = await request(app).get("/operations/paraguay/candidates").set(headers());
    expect(ready.body.find((entry: { id: string }) => entry.id === data.bag.id).allowedActions).toContain("CONFIRM_PARAGUAY");
    expect((await request(app).post("/logistics/checkpoint-paraguai").set(headers()).send(payload)).status).toBe(200);
  });

  it("faz rollback integral quando a auditoria obrigatória falha", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    const key = randomUUID();
    const { setAuditFailureForTests } = await import("../src/modules/operations/operations.persistence");
    setAuditFailureForTests((input) => input.idempotencyKey === key);
    try {
      const response = await request(app).post("/logistics/checkpoint-brasil").set(headers(undefined, key)).send({
        viagemId: data.trip.id, malaId: data.bag.id, confirmadoEm: new Date().toISOString()
      });
      expect(response.status).toBe(500);
    } finally {
      setAuditFailureForTests();
    }
    expect(await prisma.checkpointBrasil.count({ where: { malaId: data.bag.id, supersededAt: null } })).toBe(0);
  });

  it("expõe divergência tipada de recebimento e bloqueia entrada enquanto não resolvida", async () => {
    const { app, headers } = await session();
    const data = await fixture();
    await arrive(data);
    await prisma.checkpointBrasil.create({ data: {
      lojaId: data.bag.lojaId, viagemId: data.trip.id, malaId: data.bag.id,
      confirmadoPorId: data.admin.id, confirmadoEm: new Date()
    } });
    const receiving = await request(app).post("/receiving").set(headers()).send({ viagemId: data.trip.id, malaId: data.bag.id });
    const detail = await request(app).get(`/operations/receiving/${receiving.body.id}`).set(headers());
    const itemId = detail.body.itens[0].id;
    const confirmation = await request(app).post(`/receiving/${receiving.body.id}/items/${itemId}/confirm`).set(headers()).send({
      quantidadeRecebida: 0, quantidadeRejeitada: 2, tipoDivergencia: "AVARIA", observacoes: "Avaria confirmada"
    });
    expect(confirmation.status).toBe(200);
    const updated = await request(app).get(`/operations/receiving/${receiving.body.id}`).set(headers());
    expect(updated.body.itens[0].tipoDivergencia).toBe("AVARIA");
    expect(updated.body.itens[0].divergenciaResolvida).toBe(false);
    const entry = await request(app).get("/operations/definitive-entry/candidates").set(headers());
    expect(entry.body.find((candidate: { id: string }) => candidate.id === receiving.body.id).blockedReasons)
      .toContainEqual(expect.objectContaining({ code: "DIVERGENCE_UNRESOLVED" }));
  });
});
