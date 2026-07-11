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

describe("Batch 3.3 — Check-in Brasil", () => {
  it("confirma checkpoint Brasil com divergência CORRETO", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.tipoDivergencia).toBe("CORRETO");
      expect(confirmed.body.lojaId).toBe(d.id);
    }
  });

  it("confirma checkpoint Brasil com divergência MALA_AUSENTE", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          observacao: "Mala não encontrada no Brasil",
          tipoDivergencia: "MALA_AUSENTE"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.tipoDivergencia).toBe("MALA_AUSENTE");
    }
  });

  it("confirma checkpoint Brasil com divergência QUANTIDADE_DIVERGENTE", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          observacao: "Quantidade de volumes divergente no Brasil",
          tipoDivergencia: "QUANTIDADE_DIVERGENTE"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.tipoDivergencia).toBe("QUANTIDADE_DIVERGENTE");
    }
  });

  it("confirma checkpoint Brasil com divergência AVARIA", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          observacao: "Avaria detectada na mala",
          tipoDivergencia: "AVARIA"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.tipoDivergencia).toBe("AVARIA");
    }
  });

  it("confirma checkpoint Brasil com divergência LACRE_ROMPIDO", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          observacao: "Lacre rompido detectado",
          tipoDivergencia: "LACRE_ROMPIDO"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.tipoDivergencia).toBe("LACRE_ROMPIDO");
    }
  });

  it("bloqueia confirmação com viagem não chegada no Brasil (status)", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: { not: "ARRIVED_BRAZIL" } }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      expect(confirmed.status).toBe(404);
    }
  });

  it("bloqueia confirmação com viagemId inválido", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id }
    });

    if (mala) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: "invalid-viagem-id",
          malaId: mala.id,
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      expect(confirmed.status).toBe(404);
    }
  });

  it("bloqueia confirmação com malaId inválido", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });

    if (viagem) {
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: "invalid-mala-id",
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      expect(confirmed.status).toBe(404);
    }
  });

  it("bloqueia confirmação de mala de outra loja (tenancy isolation)", async () => {
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
        const confirmed = await request(app)
          .post("/logistics/checkpoint-brasil")
          .set(h(d.id))
          .send({
            viagemId: viagem.id,
            malaId: mala.id,
            confirmadoEm: new Date(),
            tipoDivergencia: "CORRETO"
          });

        expect(confirmed.status).toBe(404);
      }
    }
  });

  it("confirma múltiplos checkpoints Brasil para mesma viagem", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const malas = await prisma.mala.findMany({
      where: { lojaId: d.id, viagemId: viagem?.id },
      take: 2
    });

    if (viagem && malas.length >= 2) {
      const cp1 = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: malas[0].id,
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      const cp2 = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: malas[1].id,
          confirmadoEm: new Date(),
          tipoDivergencia: "CORRETO"
        });

      expect(cp1.status).toBe(200);
      expect(cp2.status).toBe(200);
      expect(cp1.body.viagemId).toBe(viagem.id);
      expect(cp2.body.viagemId).toBe(viagem.id);
    }
  });

  it("registra informações de confirmação (usuário, timestamp, observações)", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const now = new Date();
      const confirmed = await request(app)
        .post("/logistics/checkpoint-brasil")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: mala.id,
          confirmadoEm: now,
          observacao: "Teste de observação Brasil"
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.confirmadoPorId).toBeDefined();
      expect(confirmed.body.createdAt).toBeDefined();
      expect(confirmed.body.observacao).toBe("Teste de observação Brasil");
    }
  });
});
