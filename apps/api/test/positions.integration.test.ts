import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
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
const MIAMI = "posicao-miami-base";
let createApp: typeof import("../src/app").createApp;
type Fixture = Awaited<ReturnType<typeof createOperationalFixture>>;
const fixtures: Fixture[] = [];
const users: string[] = [];
const profiles: string[] = [];
const positions: string[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await prisma.alocacaoMala.deleteMany({
      where: { pedidoCompraItemId: fixture.item.id }
    });
    await prisma.volumeLogistico.deleteMany({
      where: { mala: { viagemId: fixture.trip.id } }
    });
    await prisma.mala.deleteMany({
      where: { viagemId: fixture.trip.id, id: { not: fixture.bag.id } }
    });
    await prisma.pedidoCompra.update({
      where: { id: fixture.order.id },
      data: { destinoPosicaoId: MIAMI }
    });
    await fixture.cleanup();
  }
  for (const id of positions.splice(0)) {
    await prisma.responsabilidadeContextual.deleteMany({
      where: { posicaoId: id }
    });
    const position = await prisma.posicaoOperacional.findUnique({
      where: { id }
    });
    await prisma.posicaoOperacional.deleteMany({ where: { id } });
    if (position)
      await prisma.local.deleteMany({ where: { id: position.localId } });
  }
  for (const id of users.splice(0)) {
    await prisma.responsabilidadeContextual.deleteMany({
      where: { usuarioId: id }
    });
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }
  for (const id of profiles.splice(0)) {
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: id } });
    await prisma.perfil.deleteMany({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

const dronz = () => prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });

async function session(email = "admin@example.com") {
  const store = await dronz();
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  const headers = {
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": store.id
  };
  return { app, headers, store, userId: login.body.user.id as string };
}

async function operator(
  codes = ["MIAMI_RECEBIMENTO_VISUALIZAR", "MIAMI_RECEBIMENTO_CONFIRMAR"]
) {
  const store = await dronz();
  const perfil = await prisma.perfil.create({
    data: { code: `TEST_${randomUUID()}`, name: "test" }
  });
  profiles.push(perfil.id);
  for (const code of codes) {
    const permission = await prisma.permissao.findUniqueOrThrow({
      where: { code }
    });
    await prisma.perfilPermissao.create({
      data: { perfilId: perfil.id, permissaoId: permission.id }
    });
  }
  const email = `positions-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "Operador",
      email,
      passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: store.id } },
      perfis: { create: { perfilId: perfil.id } }
    }
  });
  users.push(user.id);
  return { ...(await session(email)), userId: user.id };
}

async function temporaryPosition(
  admin: Awaited<ReturnType<typeof session>>,
  extra: Record<string, unknown> = {}
) {
  const now = Date.now();
  const response = await request(admin.app)
    .post("/positions")
    .set(admin.headers)
    .send({
      codigo: `TMP-${randomUUID().slice(0, 8).toUpperCase()}`,
      nome: "Orlando viagem",
      tipo: "TEMPORARIA",
      inicioEm: new Date(now - 86_400_000).toISOString(),
      fimEm: new Date(now + 10 * 86_400_000).toISOString(),
      local: {
        alias: "Hotel Orlando",
        cidade: "Orlando",
        estado: "FL",
        pais: "US",
        timezone: "America/New_York",
        endereco: "1 Main St"
      },
      ...extra
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  positions.push(response.body.id);
  const activated = await request(admin.app)
    .patch(`/positions/${response.body.id}/status`)
    .set(admin.headers)
    .send({ action: "ATIVAR" });
  expect(activated.status).toBe(200);
  return response.body as { id: string };
}

async function fixture() {
  const data = await createOperationalFixture(prisma, (await dronz()).id);
  fixtures.push(data);
  await prisma.alocacaoMala.deleteMany({
    where: { pedidoCompraItemId: data.item.id }
  });
  return data;
}

const receipt = (
  data: Fixture,
  quantidadeRecebida: number,
  posicaoId?: string
) => ({
  pedidoCompraItemId: data.item.id,
  quantidadeRecebida,
  recebidoEm: new Date().toISOString(),
  ...(posicaoId ? { posicaoId } : {})
});

describe("posições operacionais", () => {
  it("Base Miami é permanente, ativa e não pode ser encerrada", async () => {
    const admin = await session();
    const miami = await request(admin.app)
      .get(`/positions/${MIAMI}`)
      .set(admin.headers);
    expect(miami.body).toMatchObject({
      codigo: "MIAMI",
      tipo: "PERMANENTE",
      status: "ATIVA"
    });
    expect(miami.body.allowedActions).not.toContain("ENCERRAR");
    const close = await request(admin.app)
      .patch(`/positions/${MIAMI}/status`)
      .set(admin.headers)
      .send({ action: "ENCERRAR" });
    expect(close.status).toBe(409);
  });

  it("valida fuso IANA, período e capacidade de gestão", async () => {
    const admin = await session();
    const bad = await request(admin.app)
      .post("/positions")
      .set(admin.headers)
      .send({
        codigo: "TMP-BAD",
        nome: "x",
        tipo: "TEMPORARIA",
        inicioEm: "2026-10-01T00:00:00Z",
        fimEm: "2026-10-05T00:00:00Z",
        local: { alias: "x", cidade: "x", pais: "US", timezone: "Mars/Olympus" }
      });
    expect(bad.status).toBe(400);
    const noPeriod = await request(admin.app)
      .post("/positions")
      .set(admin.headers)
      .send({
        codigo: "TMP-BAD2",
        nome: "x",
        tipo: "TEMPORARIA",
        local: {
          alias: "x",
          cidade: "x",
          pais: "US",
          timezone: "America/Chicago"
        }
      });
    expect(noPeriod.status).toBe(400);
    const op = await operator();
    const forbidden = await request(op.app)
      .post("/positions")
      .set(op.headers)
      .send({});
    expect(forbidden.status).toBe(403);
  });

  it("D-9: um responsável principal por período; delegados são permitidos", async () => {
    const admin = await session();
    const position = await temporaryPosition(admin);
    const [a, b] = [await operator(), await operator()];
    const from = new Date().toISOString();
    expect(
      (
        await request(admin.app)
          .post(`/positions/${position.id}/responsibilities`)
          .set(admin.headers)
          .send({ usuarioId: a.userId, papel: "PRINCIPAL", validoDe: from })
      ).status
    ).toBe(201);
    expect(
      (
        await request(admin.app)
          .post(`/positions/${position.id}/responsibilities`)
          .set(admin.headers)
          .send({ usuarioId: b.userId, papel: "PRINCIPAL", validoDe: from })
      ).status
    ).toBe(409);
    expect(
      (
        await request(admin.app)
          .post(`/positions/${position.id}/responsibilities`)
          .set(admin.headers)
          .send({ usuarioId: b.userId, papel: "DELEGADO", validoDe: from })
      ).status
    ).toBe(201);
  });

  it("D-7: endereço completo só para gestão ou responsável", async () => {
    const admin = await session();
    const position = await temporaryPosition(admin);
    const viewer = await operator(["LOGISTICA_POSICOES_VISUALIZAR"]);
    const seen = await request(viewer.app)
      .get(`/positions/${position.id}`)
      .set(viewer.headers);
    expect(seen.status).toBe(200);
    expect(seen.body.local.cidade).toBe("Orlando");
    expect(seen.body.local).not.toHaveProperty("endereco");
    const managed = await request(admin.app)
      .get(`/positions/${position.id}`)
      .set(admin.headers);
    expect(managed.body.local.endereco).toBe("1 Main St");
  });

  it("D-12/T32: receber exige vínculo contextual vigente na posição de destino", async () => {
    const admin = await session();
    const data = await fixture();
    const op = await operator();
    const denied = await request(op.app)
      .post("/logistics/miami-confirmations")
      .set(op.headers)
      .send(receipt(data, 1));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("position_not_authorized");
    const link = await request(admin.app)
      .post(`/positions/${MIAMI}/responsibilities`)
      .set(admin.headers)
      .send({
        usuarioId: op.userId,
        papel: "DELEGADO",
        validoDe: new Date(Date.now() - 1000).toISOString()
      });
    expect(link.status).toBe(201);
    expect(
      (
        await request(op.app)
          .post("/logistics/miami-confirmations")
          .set(op.headers)
          .send(receipt(data, 1))
      ).status
    ).toBe(200);
    await request(admin.app)
      .delete(`/positions/${MIAMI}/responsibilities/${link.body.id}`)
      .set(admin.headers);
    expect(
      (
        await request(op.app)
          .post("/logistics/miami-confirmations")
          .set(op.headers)
          .send(receipt(data, 1))
      ).status
    ).toBe(403);
    expect(
      (
        await prisma.pedidoCompraItem.findUniqueOrThrow({
          where: { id: data.item.id }
        })
      ).quantidadeRecebidaMiami
    ).toBe(1);
  });

  it("D-15/T31: recebe só no destino; destino muda apenas antes do primeiro recebimento", async () => {
    const admin = await session();
    const data = await fixture();
    const position = await temporaryPosition(admin);
    expect(
      (
        await request(admin.app)
          .put(`/purchase-orders/${data.order.id}/destination`)
          .set(admin.headers)
          .send({ posicaoId: position.id })
      ).status
    ).toBe(200);
    const wrong = await request(admin.app)
      .post("/logistics/miami-confirmations")
      .set(admin.headers)
      .send(receipt(data, 1, MIAMI));
    expect(wrong.body.error).toBe("destination_mismatch");
    expect(
      (
        await request(admin.app)
          .post("/logistics/miami-confirmations")
          .set(admin.headers)
          .send(receipt(data, 1, position.id))
      ).status
    ).toBe(200);
    const late = await request(admin.app)
      .put(`/purchase-orders/${data.order.id}/destination`)
      .set(admin.headers)
      .send({ posicaoId: MIAMI });
    expect(late.body.error).toBe("already_received");
    expect(
      (
        await prisma.recebimentoMiami.findFirstOrThrow({
          where: { pedidoCompraItemId: data.item.id }
        })
      ).posicaoId
    ).toBe(position.id);
  });

  it("T27/T29/F-8: reserva só o recebido na posição; fechar consome a reserva sem desconto duplo", async () => {
    const admin = await session();
    const data = await fixture();
    const position = await temporaryPosition(admin);
    await request(admin.app)
      .put(`/purchase-orders/${data.order.id}/destination`)
      .set(admin.headers)
      .send({ posicaoId: position.id });
    await request(admin.app)
      .post("/logistics/miami-confirmations")
      .set(admin.headers)
      .send(receipt(data, 1));
    const bag = await request(admin.app)
      .post("/logistics/suitcases")
      .set(admin.headers)
      .send({
        viagemId: data.trip.id,
        codigo: `MALA-${randomUUID().slice(0, 6)}`,
        posicaoId: position.id
      });
    expect(bag.status).toBe(200);
    const volume = await prisma.volumeLogistico.create({
      data: {
        lojaId: data.order.lojaId,
        malaId: bag.body.id,
        codigo: "V1",
        taraKg: 0.5
      }
    });
    const allocation = (quantidade: number) => ({
      pedidoCompraItemId: data.item.id,
      malaId: bag.body.id,
      volumeLogisticoId: volume.id,
      quantidade
    });
    expect(
      (
        await request(admin.app)
          .post("/logistics/allocations")
          .set(admin.headers)
          .send(allocation(2))
      ).status
    ).toBe(409);
    // A mala da Base Miami não enxerga o que foi recebido em Orlando.
    expect(
      (
        await request(admin.app)
          .post("/logistics/allocations")
          .set(admin.headers)
          .send({
            ...allocation(1),
            malaId: data.bag.id,
            volumeLogisticoId: data.volume.id
          })
      ).status
    ).toBe(409);
    const reserved = await request(admin.app)
      .post("/logistics/allocations")
      .set(admin.headers)
      .send(allocation(1));
    expect(reserved.status).toBe(200);
    expect(reserved.body).toMatchObject({
      status: "RESERVADA",
      reservadoPorId: admin.userId
    });
    const before = await request(admin.app)
      .get(`/positions/${position.id}/availability`)
      .set(admin.headers);
    expect(
      before.body.find(
        (row: { pedidoCompraItemId: string }) =>
          row.pedidoCompraItemId === data.item.id
      )
    ).toMatchObject({
      recebido: 1,
      reservado: 1,
      alocado: 0,
      disponivel: 0,
      aCaminho: 1
    });
    expect(
      (
        await request(admin.app)
          .patch(`/logistics/suitcases/${bag.body.id}/status`)
          .set(admin.headers)
          .send({ status: "CLOSED" })
      ).status
    ).toBe(200);
    const after = await request(admin.app)
      .get(`/positions/${position.id}/availability`)
      .set(admin.headers);
    expect(
      after.body.find(
        (row: { pedidoCompraItemId: string }) =>
          row.pedidoCompraItemId === data.item.id
      )
    ).toMatchObject({ recebido: 1, reservado: 0, alocado: 1, disponivel: 0 });
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: data.product.id }
      })
    ).toBe(0);
  });

  it("D-14: reabrir mala fechada exige motivo e só antes da saída", async () => {
    const admin = await session();
    const data = await fixture();
    await request(admin.app)
      .post("/logistics/miami-confirmations")
      .set(admin.headers)
      .send(receipt(data, 1));
    await request(admin.app)
      .post("/logistics/allocations")
      .set(admin.headers)
      .send({
        pedidoCompraItemId: data.item.id,
        malaId: data.bag.id,
        volumeLogisticoId: data.volume.id,
        quantidade: 1
      });
    const status = (body: Record<string, unknown>) =>
      request(admin.app)
        .patch(`/logistics/suitcases/${data.bag.id}/status`)
        .set(admin.headers)
        .send(body);
    expect((await status({ status: "CLOSED" })).status).toBe(200);
    expect((await status({ status: "PLANNING" })).status).toBe(400);
    expect(
      (await status({ status: "PLANNING", motivo: "Trocar item de volume" }))
        .status
    ).toBe(200);
    expect(
      (
        await prisma.alocacaoMala.findFirstOrThrow({
          where: { malaId: data.bag.id }
        })
      ).status
    ).toBe("RESERVADA");
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: data.bag.id,
        action: "UPDATE_SUITCASE_STATUS",
        reason: "Trocar item de volume"
      }
    });
    expect(audit).not.toBeNull();
    expect((await status({ status: "CLOSED" })).status).toBe(200);
    await prisma.viagem.update({
      where: { id: data.trip.id },
      data: { status: "IN_TRANSIT" }
    });
    expect(
      (await status({ status: "PLANNING", motivo: "tarde demais" })).body.error
    ).toBe("trip_departed");
  });

  it("D-10/D-16/T38–T40: encerramento manual sem pendências bloqueia recebimento e reabre só com motivo", async () => {
    const admin = await session();
    const data = await fixture();
    const position = await temporaryPosition(admin);
    await request(admin.app)
      .put(`/purchase-orders/${data.order.id}/destination`)
      .set(admin.headers)
      .send({ posicaoId: position.id });
    const blocked = await request(admin.app)
      .get(`/positions/${position.id}`)
      .set(admin.headers);
    expect(
      blocked.body.blockedReasons.map((reason: { code: string }) => reason.code)
    ).toContain("ITEMS_NOT_RECEIVED");
    expect(
      (
        await request(admin.app)
          .patch(`/positions/${position.id}/status`)
          .set(admin.headers)
          .send({ action: "ENCERRAR" })
      ).status
    ).toBe(409);
    // Sem pendências: devolve o pedido à Base Miami e encerra.
    await request(admin.app)
      .put(`/purchase-orders/${data.order.id}/destination`)
      .set(admin.headers)
      .send({ posicaoId: MIAMI });
    const op = await operator();
    await request(admin.app)
      .post(`/positions/${position.id}/responsibilities`)
      .set(admin.headers)
      .send({
        usuarioId: op.userId,
        papel: "PRINCIPAL",
        validoDe: new Date(Date.now() - 1000).toISOString()
      });
    const ready = await request(admin.app)
      .get(`/positions/${position.id}`)
      .set(admin.headers);
    expect(ready.body.sugestaoEncerramento).toBe(true);
    expect(
      (
        await request(admin.app)
          .patch(`/positions/${position.id}/status`)
          .set(admin.headers)
          .send({ action: "ENCERRAR" })
      ).status
    ).toBe(200);
    expect(
      await prisma.responsabilidadeContextual.count({
        where: { posicaoId: position.id, revogadoEm: null }
      })
    ).toBe(0);
    // Pacote tardio: pedido não pode ser destinado nem recebido na posição encerrada.
    expect(
      (
        await request(admin.app)
          .put(`/purchase-orders/${data.order.id}/destination`)
          .set(admin.headers)
          .send({ posicaoId: position.id })
      ).body.error
    ).toBe("position_closed");
    expect(
      (
        await request(admin.app)
          .patch(`/positions/${position.id}/status`)
          .set(admin.headers)
          .send({ action: "REABRIR" })
      ).status
    ).toBe(400);
    expect(
      (
        await request(admin.app)
          .patch(`/positions/${position.id}/status`)
          .set(admin.headers)
          .send({ action: "REABRIR", motivo: "Pacote tardio" })
      ).status
    ).toBe(200);
  });
});
