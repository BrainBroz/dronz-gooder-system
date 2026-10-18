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

async function userWith(codes: string[]) {
  const store = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  const profile = await prisma.perfil.create({
    data: { code: `TEST_${randomUUID()}`, name: "test" }
  });
  for (const code of codes)
    await prisma.perfilPermissao.create({
      data: {
        perfilId: profile.id,
        permissaoId: (await prisma.permissao.findUniqueOrThrow({ where: { code } })).id
      }
    });
  const email = `pd05-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "PD05",
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
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: profile.id } });
    await prisma.perfil.delete({ where: { id: profile.id } });
  });
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email, password: "change-me" });
  return {
    app,
    headers: { Authorization: `Bearer ${login.body.accessToken}`, "x-store-id": store.id },
    store
  };
}

describe("PD-05: status de viagem e mala exige gestão logística", () => {
  it("sem LOGISTICA_POSICOES_GERENCIAR recebe 403; com ela, a rota responde", async () => {
    const store = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
    const data = await createOperationalFixture(prisma, store.id);
    cleanups.push(() => data.cleanup());
    const viewer = await userWith(["LOGISTICA_POSICOES_VISUALIZAR"]);
    for (const path of [`/logistics/trips/${data.trip.id}/status`, `/logistics/suitcases/${data.bag.id}/status`])
      expect(
        (await request(viewer.app).patch(path).set(viewer.headers).send({ status: "CANCELLED" })).status,
        path
      ).toBe(403);
    const manager = await userWith(["LOGISTICA_POSICOES_GERENCIAR"]);
    const allowed = await request(manager.app)
      .patch(`/logistics/trips/${data.trip.id}/status`)
      .set(manager.headers)
      .send({ status: "CLOSED_FOR_ALLOCATION" });
    expect(allowed.status).not.toBe(403);
  });
});
