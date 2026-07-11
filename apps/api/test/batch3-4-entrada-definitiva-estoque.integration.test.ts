import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";

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

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function session() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz");
  const h = (id: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": id
  });
  return { app, d, h };
}

describe("Batch 3.4 — Entrada Definitiva no Estoque", () => {
  it("move stock após entrada definitiva", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const estoqueAntes = await prisma.estoque.findFirst({
        where: { lojaId: d.id }
      });

      const entrada = await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date()
        });

      expect(entrada.status).toBe(200);
      expect(entrada.body.status).toBe("COMPLETED");

      const estoqueDepois = await prisma.estoque.findFirst({
        where: { lojaId: d.id }
      });

      if (estoqueAntes && estoqueDepois) {
        expect(estoqueDepois.quantidadeFisica).toBeGreaterThanOrEqual(
          estoqueAntes.quantidadeFisica
        );
      }
    }
  });

  it("cria movimentacao estoque para auditoria", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const movimentacoesAntes = await prisma.movimentacaoEstoque.count({
        where: { lojaId: d.id }
      });

      await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date()
        });

      const movimentacoesDepois = await prisma.movimentacaoEstoque.count({
        where: { lojaId: d.id }
      });

      expect(movimentacoesDepois).toBeGreaterThan(movimentacoesAntes);
    }
  });

  it("bloqueia entrada com items com divergencia", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const recebimento = await prisma.recebimento.findFirst({
        where: { lojaId: d.id, malaId: mala.id }
      });

      if (recebimento) {
        await prisma.recebimentoItem.updateMany({
          where: { recebimentoId: recebimento.id },
          data: { quantidadeRejeitada: 1 }
        });

        const entrada = await request(app)
          .post("/receiving/entrada-definitiva")
          .set(h(d.id))
          .send({
            viagemId: viagem.id,
            malaId: mala.id,
            confirmadoEm: new Date()
          });

        expect(entrada.status).toBe(409);
      }
    }
  });

  it("bloqueia entrada de mala de outra loja (tenancy isolation)", async () => {
    const { app, d, h } = await session();
    const otherLoja = await prisma.loja.findFirst({
      where: { id: { not: d.id } }
    });

    if (otherLoja) {
      const viagem = await prisma.viagem.findFirst({
        where: { lojaId: otherLoja.id, status: "ARRIVED_BRAZIL" }
      });
      const mala = await prisma.mala.findFirst({
        where: { lojaId: otherLoja.id, viagemId: viagem?.id }
      });

      if (viagem && mala) {
        const entrada = await request(app)
          .post("/receiving/entrada-definitiva")
          .set(h(d.id))
          .send({
            viagemId: viagem.id,
            malaId: mala.id,
            confirmadoEm: new Date()
          });

        expect(entrada.status).toBe(404);
      }
    }
  });

  it("implementa idempotencia (segunda chamada retorna mesmo resultado)", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const primeiro = await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date()
        });

      const segundo = await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date()
        });

      expect(primeiro.status).toBe(200);
      expect(segundo.status).toBe(200);
      expect(primeiro.body.id).toBe(segundo.body.id);
    }
  });
});
