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
let createApp: typeof import("../src/app").createApp;
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  delete process.env.ESTOQUE_PERDA_LIMITE_UNIDADES;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

async function login(email: string, storeId: string) {
  const app = createApp();
  const session = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  return {
    app,
    headers: {
      Authorization: `Bearer ${session.body.accessToken}`,
      "x-store-id": storeId
    }
  };
}

async function adjuster(storeId: string) {
  const profile = await prisma.perfil.create({
    data: { code: `TEST_${randomUUID()}`, name: "test" }
  });
  for (const code of [
    "ESTOQUE_VISUALIZAR",
    "ESTOQUE_AJUSTAR",
    "ESTOQUE_MOVIMENTAR"
  ])
    await prisma.perfilPermissao.create({
      data: {
        perfilId: profile.id,
        permissaoId: (
          await prisma.permissao.findUniqueOrThrow({ where: { code } })
        ).id
      }
    });
  const email = `pd12-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "PD12",
      email,
      passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: storeId } },
      perfis: { create: { perfilId: profile.id } }
    }
  });
  cleanups.push(async () => {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: user.id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: user.id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: user.id } });
    await prisma.solicitacaoCorrecao.deleteMany({
      where: { propostoPorId: user.id }
    });
    await prisma.movimentacaoEstoque.deleteMany({
      where: { responsavelId: user.id }
    });
    await prisma.usuario.delete({ where: { id: user.id } });
    await prisma.perfilPermissao.deleteMany({
      where: { perfilId: profile.id }
    });
    await prisma.perfil.delete({ where: { id: profile.id } });
  });
  return login(email, storeId);
}

describe("PD-12 perda acima do limite exige aval", () => {
  it("abaixo do limite move direto; acima vira proposta que outro usuário aprova", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const data = await createOperationalFixture(prisma, store.id);
    cleanups.push(() => data.cleanup());
    const stock = await prisma.estoque.create({
      data: {
        lojaId: store.id,
        produtoId: data.product.id,
        quantidadeFisica: 10
      }
    });
    process.env.ESTOQUE_PERDA_LIMITE_UNIDADES = "2";
    const operator = await adjuster(store.id);
    const loss = (quantidade: number) => ({
      produtoId: data.product.id,
      tipo: "EXIT",
      motivo: "LOSS",
      quantidade,
      observacoes: "Avaria no transporte"
    });
    expect(
      (
        await request(operator.app)
          .post("/inventory/movements")
          .set(operator.headers)
          .send(loss(2))
      ).status
    ).toBe(200);
    expect(
      (
        await request(operator.app)
          .post("/inventory/movements")
          .set(operator.headers)
          .send(loss(3))
      ).body.error
    ).toBe("loss_requires_approval");
    const proposal = await request(operator.app)
      .post("/inventory/movements/loss-requests")
      .set({ ...operator.headers, "idempotency-key": randomUUID() })
      .send(loss(3));
    expect(proposal.status).toBe(200);
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(8);
    const admin = await login("admin@example.com", store.id);
    const approved = await request(admin.app)
      .post(`/operations/corrections/requests/${proposal.body.id}/approve`)
      .set(admin.headers);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(5);
    expect(
      (
        await request(admin.app)
          .post(`/operations/corrections/requests/${proposal.body.id}/approve`)
          .set(admin.headers)
      ).body.error
    ).toBe("request_already_decided");
  });

  it("sem limite configurado, a perda segue o fluxo atual", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const data = await createOperationalFixture(prisma, store.id);
    cleanups.push(() => data.cleanup());
    await prisma.estoque.create({
      data: {
        lojaId: store.id,
        produtoId: data.product.id,
        quantidadeFisica: 10
      }
    });
    const admin = await login("admin@example.com", store.id);
    expect(
      (
        await request(admin.app)
          .post("/inventory/movements")
          .set(admin.headers)
          .send({
            produtoId: data.product.id,
            tipo: "EXIT",
            motivo: "LOSS",
            quantidade: 9
          })
      ).status
    ).toBe(200);
  });
});
