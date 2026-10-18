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

async function home(email: string, lojaId: string) {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  const response = await request(app)
    .get("/operations/home")
    .set({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": lojaId
    });
  expect(response.status).toBe(200);
  return response.body as {
    referenciaEm: string;
    secoes: {
      codigo: string;
      itens: { codigo: string; quantidade: number; definicao: string }[];
    }[];
  };
}
const count = (
  body: Awaited<ReturnType<typeof home>>,
  section: string,
  item: string
) =>
  body.secoes
    .find((entry) => entry.codigo === section)
    ?.itens.find((entry) => entry.codigo === item)?.quantidade;

describe("Home operacional (BE-HOME)", () => {
  it("mostra pendências por área, com definição e instante de referência, só no que o perfil pode ver", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const data = await createOperationalFixture(prisma, store.id);
    cleanups.push(() => data.cleanup());
    const admin = await home("admin@example.com", store.id);
    expect(new Date(admin.referenciaEm).getTime()).toBeGreaterThan(
      Date.now() - 60_000
    );
    expect(admin.secoes.map((section) => section.codigo)).toEqual(
      expect.arrayContaining([
        "COMPRAS",
        "OPERACAO",
        "LOGISTICA",
        "CORRECOES",
        "FINANCEIRO"
      ])
    );
    expect(
      admin.secoes.every((section) =>
        section.itens.every((item) => item.definicao.length > 10)
      )
    ).toBe(true);
    // Fixture: pedido confirmado de 100 sem pagamento e mala em preparo com 2 unidades reservadas.
    expect(
      count(admin, "FINANCEIRO", "PEDIDOS_A_PAGAR")
    ).toBeGreaterThanOrEqual(1);
    expect(
      count(admin, "LOGISTICA", "RESERVAS_ABERTAS")
    ).toBeGreaterThanOrEqual(1);
    expect(count(admin, "OPERACAO", "MIAMI_PENDENTE")).toBeGreaterThanOrEqual(
      1
    );

    const profile = await prisma.perfil.findUniqueOrThrow({
      where: { code: "CHECKPOINT_MIAMI" }
    });
    const email = `home-${randomUUID()}@example.com`;
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
    const miami = await home(email, store.id);
    const codes = miami.secoes.map((section) => section.codigo);
    expect(codes).not.toContain("FINANCEIRO");
    expect(codes).not.toContain("COMPRAS");
    expect(codes).not.toContain("CORRECOES");
    expect(
      miami.secoes
        .find((section) => section.codigo === "OPERACAO")
        ?.itens.map((item) => item.codigo)
    ).toEqual(["MIAMI_PENDENTE", "MIAMI_DIVERGENTE"]);
  });
});
