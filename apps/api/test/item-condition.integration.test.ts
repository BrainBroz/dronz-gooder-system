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
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

async function login(email: string, lojaId: string) {
  const app = createApp();
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  return {
    app,
    headers: {
      Authorization: `Bearer ${response.body.accessToken}`,
      "x-store-id": lojaId
    }
  };
}

describe("condição do item no recebimento (D-4)", () => {
  it("registra dimensões separadas e restringe o registro em nome de terceiro", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const data = await createOperationalFixture(prisma, store.id);
    cleanups.push(() => data.cleanup());
    const admin = await login("admin@example.com", store.id);
    const confirmed = await request(admin.app)
      .post("/logistics/miami-confirmations")
      .set(admin.headers)
      .send({
        pedidoCompraItemId: data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString(),
        condicaoComercial: "CAIXA_ABERTA",
        funcionamento: "DEFEITO_PARCIAL",
        acessoriosAusentes: ["cabo USB", "manual"],
        registroTerceiro: true
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      condicaoComercial: "CAIXA_ABERTA",
      funcionamento: "DEFEITO_PARCIAL",
      acessoriosAusentes: ["cabo USB", "manual"]
    });
    const asManager = await request(admin.app)
      .get(`/operations/miami/items/${data.item.id}`)
      .set(admin.headers);
    expect(
      asManager.body.recebimentosMiami[0].registroTerceiro,
      JSON.stringify(asManager.body).slice(0, 600)
    ).toBe(true);

    const profile = await prisma.perfil.findUniqueOrThrow({
      where: { code: "CHECKPOINT_MIAMI" }
    });
    const email = `condition-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({
      data: {
        name: "Miami",
        email,
        passwordHash: await bcrypt.hash("change-me", 12),
        lojas: { create: { lojaId: store.id } },
        perfis: { create: { perfilId: profile.id } }
      }
    });
    cleanups.push(async () => {
      await prisma.refreshToken.deleteMany({ where: { usuarioId: user.id } });
      await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: user.id } });
      await prisma.usuarioLoja.deleteMany({ where: { usuarioId: user.id } });
      await prisma.usuario.delete({ where: { id: user.id } });
    });
    const miami = await login(email, store.id);
    const asOperator = await request(miami.app)
      .get(`/operations/miami/items/${data.item.id}`)
      .set(miami.headers);
    expect(asOperator.status).toBe(200);
    expect(asOperator.body.recebimentosMiami[0].funcionamento).toBe(
      "DEFEITO_PARCIAL"
    );
    expect(asOperator.body.recebimentosMiami[0]).not.toHaveProperty(
      "registroTerceiro"
    );
  });
});
