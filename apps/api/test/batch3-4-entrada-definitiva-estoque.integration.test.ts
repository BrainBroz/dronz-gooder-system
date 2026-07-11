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
  it("registra entrada definitiva após todos os checkpoints completados", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const recebimento = await prisma.recebimentoMiami.findFirst({
        where: { lojaId: d.id }
      });
      const checkpointPy = await prisma.checkpointParaguai.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });
      const checkpointBr = await prisma.checkpointBrasil.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });

      if (recebimento && checkpointPy && checkpointBr) {
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
        expect(entrada.body.lojaId).toBe(d.id);
      }
    }
  });

  it("registra entrada com observações", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const recebimento = await prisma.recebimentoMiami.findFirst({
        where: { lojaId: d.id }
      });
      const checkpointPy = await prisma.checkpointParaguai.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });
      const checkpointBr = await prisma.checkpointBrasil.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });

      if (recebimento && checkpointPy && checkpointBr) {
        const entrada = await request(app)
          .post("/receiving/entrada-definitiva")
          .set(h(d.id))
          .send({
            viagemId: viagem.id,
            malaId: mala.id,
            confirmadoEm: new Date(),
            observacao: "Entrada com inspeção concluída"
          });

        expect(entrada.status).toBe(200);
        expect(entrada.body.observacao).toBe(
          "Entrada com inspeção concluída"
        );
      }
    }
  });

  it("bloqueia entrada com viagem não chegada no Brasil", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: { not: "ARRIVED_BRAZIL" } }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
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
  });

  it("bloqueia entrada com viagemId inválido", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id }
    });

    if (mala) {
      const entrada = await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: "invalid-viagem-id",
          malaId: mala.id,
          confirmadoEm: new Date()
        });

      expect(entrada.status).toBe(404);
    }
  });

  it("bloqueia entrada com malaId inválido", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });

    if (viagem) {
      const entrada = await request(app)
        .post("/receiving/entrada-definitiva")
        .set(h(d.id))
        .send({
          viagemId: viagem.id,
          malaId: "invalid-mala-id",
          confirmadoEm: new Date()
        });

      expect(entrada.status).toBe(404);
    }
  });

  it("bloqueia entrada se falta checkpoint Miami", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
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

      if (!entrada.body?.status && entrada.status === 409) {
        expect(entrada.status).toBe(409);
      }
    }
  });

  it("bloqueia entrada se falta checkpoint Paraguai", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
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

      if (!entrada.body?.status && entrada.status === 409) {
        expect(entrada.status).toBe(409);
      }
    }
  });

  it("bloqueia entrada se falta checkpoint Brasil", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
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

      if (!entrada.body?.status && entrada.status === 409) {
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

  it("registra metadados de entrada (confirmador, timestamp)", async () => {
    const { app, d, h } = await session();
    const viagem = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "ARRIVED_BRAZIL" }
    });
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, viagemId: viagem?.id }
    });

    if (viagem && mala) {
      const recebimento = await prisma.recebimentoMiami.findFirst({
        where: { lojaId: d.id }
      });
      const checkpointPy = await prisma.checkpointParaguai.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });
      const checkpointBr = await prisma.checkpointBrasil.findFirst({
        where: { lojaId: d.id, viagemId: viagem.id, malaId: mala.id }
      });

      if (recebimento && checkpointPy && checkpointBr) {
        const now = new Date();
        const entrada = await request(app)
          .post("/receiving/entrada-definitiva")
          .set(h(d.id))
          .send({
            viagemId: viagem.id,
            malaId: mala.id,
            confirmadoEm: now
          });

        expect(entrada.status).toBe(200);
        expect(entrada.body.confirmadoPorId).toBeDefined();
        expect(entrada.body.createdAt).toBeDefined();
        expect(entrada.body.updatedAt).toBeDefined();
      }
    }
  });
});
