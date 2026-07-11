import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

beforeEach(async () => {
  // Reset any test data
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

describe("Batch 3.1 — Complementação da Logística", () => {
  it("atualiza viajante (nome, email, telefone, observacoes, ativo)", async () => {
    const { app, d, h } = await session();
    const traveler = await prisma.viajante.findFirst({
      where: { lojaId: d.id }
    });

    if (traveler) {
      const updated = await request(app)
        .patch(`/logistics/travelers/${traveler.id}`)
        .set(h(d.id))
        .send({
          nome: "João Atualizado",
          email: "joao@example.com",
          telefone: "21999999999",
          observacoes: "Atualizado em teste"
        });

      expect(updated.status).toBe(200);
      expect(updated.body.nome).toBe("João Atualizado");
      expect(updated.body.email).toBe("joao@example.com");
    }
  });

  it("desativa viajante (ativo=false)", async () => {
    const { app, d, h } = await session();
    const traveler = await prisma.viajante.findFirst({
      where: { lojaId: d.id, ativo: true }
    });

    if (traveler) {
      const deactivated = await request(app)
        .patch(`/logistics/travelers/${traveler.id}`)
        .set(h(d.id))
        .send({ ativo: false });

      expect(deactivated.status).toBe(200);
      expect(deactivated.body.ativo).toBe(false);
    }
  });

  it("deleta viajante apenas se não tem viagens", async () => {
    const { app, d, h } = await session();
    const travelers = await prisma.viajante.findMany({
      where: { lojaId: d.id },
      include: { viagens: true }
    });
    const travellerWithoutTrips = travelers.find((t) => t.viagens.length === 0);

    if (travellerWithoutTrips) {
      const deleted = await request(app)
        .delete(`/logistics/travelers/${travellerWithoutTrips.id}`)
        .set(h(d.id));

      expect(deleted.status).toBe(200);

      const verify = await prisma.viajante.findUnique({
        where: { id: travellerWithoutTrips.id }
      });
      expect(verify).toBeNull();
    }
  });

  it("bloqueia deleção de viajante com viagens", async () => {
    const { app, d, h } = await session();
    const travelers = await prisma.viajante.findMany({
      where: { lojaId: d.id },
      include: { viagens: true }
    });
    const travellerWithTrips = travelers.find((t) => t.viagens.length > 0);

    if (travellerWithTrips) {
      const deleted = await request(app)
        .delete(`/logistics/travelers/${travellerWithTrips.id}`)
        .set(h(d.id));

      expect(deleted.status).toBe(409);
    }
  });

  it("atualiza viagem (datas, origem, destino, observacoes) apenas se PLANNED", async () => {
    const { app, d, h } = await session();
    const trip = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "PLANNED" }
    });

    if (trip) {
      const updated = await request(app)
        .patch(`/logistics/trips/${trip.id}`)
        .set(h(d.id))
        .send({
          origem: "Nova York",
          destino: "Rio de Janeiro",
          observacoes: "Trip atualizado em teste"
        });

      expect(updated.status).toBe(200);
      expect(updated.body.origem).toBe("Nova York");
      expect(updated.body.destino).toBe("Rio de Janeiro");
    }
  });

  it("bloqueia atualização de viagem se não está PLANNED", async () => {
    const { app, d, h } = await session();
    const trip = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: { not: "PLANNED" } }
    });

    const updated = await request(app)
      .patch(`/logistics/trips/${trip.id}`)
      .set(h(d.id))
      .send({ origem: "Outro lugar" });

    expect(updated.status).toBe(409);
  });

  it("deleta viagem apenas se PLANNED", async () => {
    const { app, d, h } = await session();
    const trip = await prisma.viagem.findFirst({
      where: { lojaId: d.id, status: "PLANNED" }
    });

    if (trip) {
      const deleted = await request(app)
        .delete(`/logistics/trips/${trip.id}`)
        .set(h(d.id));

      expect(deleted.status).toBe(200);

      const verify = await prisma.viagem.findUnique({
        where: { id: trip.id }
      });
      expect(verify).toBeNull();
    }
  });

  it("atualiza mala (código, limitePesoKg, observacoes) apenas se PLANNING", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, status: "PLANNING" }
    });

    if (mala) {
      const updated = await request(app)
        .patch(`/logistics/suitcases/${mala.id}`)
        .set(h(d.id))
        .send({
          codigo: "MALA-ATUALIZADA",
          limitePesoKg: 20,
          observacoes: "Mala atualizada"
        });

      expect(updated.status).toBe(200);
      expect(updated.body.codigo).toBe("MALA-ATUALIZADA");
      expect(Number(updated.body.limitePesoKg)).toBe(20);
    }
  });

  it("deleta mala apenas se PLANNING e sem alocações", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, status: "PLANNING" },
      include: { alocacoes: true }
    });

    if (mala && mala.alocacoes.length === 0) {
      const deleted = await request(app)
        .delete(`/logistics/suitcases/${mala.id}`)
        .set(h(d.id));

      expect(deleted.status).toBe(200);

      const verify = await prisma.mala.findUnique({
        where: { id: mala.id }
      });
      expect(verify).toBeNull();
    }
  });

  it("atualiza volume (código, taraKg) apenas se mala está PLANNING", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, status: "PLANNING" },
      include: { volumes: true }
    });

    if (mala && mala.volumes.length > 0) {
      const vol = mala.volumes[0];
      const updated = await request(app)
        .patch(`/logistics/suitcases/${mala.id}/volumes/${vol.id}`)
        .set(h(d.id))
        .send({ codigo: "VOL-ATUALIZADO", taraKg: 0.8 });

      expect(updated.status).toBe(200);
      expect(updated.body.codigo).toBe("VOL-ATUALIZADO");
    }
  });

  it("deleta alocação apenas se mala está PLANNING", async () => {
    const { app, d, h } = await session();
    const alocacao = await prisma.alocacaoMala.findFirst({
      where: { lojaId: d.id, mala: { status: "PLANNING" } },
      include: { mala: true }
    });

    if (alocacao) {
      const deleted = await request(app)
        .delete(`/logistics/allocations/${alocacao.id}`)
        .set(h(d.id));

      expect(deleted.status).toBe(200);

      const verify = await prisma.alocacaoMala.findUnique({
        where: { id: alocacao.id }
      });
      expect(verify).toBeNull();
    }
  });

  it("bloqueia operações após imutabilidade (checkpoint)", async () => {
    const { app, d, h } = await session();
    const mala = await prisma.mala.findFirst({
      where: { lojaId: d.id, status: { not: "PLANNING" } }
    });

    if (mala) {
      const updateMala = await request(app)
        .patch(`/logistics/suitcases/${mala.id}`)
        .set(h(d.id))
        .send({ codigo: "NOVO" });

      const deleteMala = await request(app)
        .delete(`/logistics/suitcases/${mala.id}`)
        .set(h(d.id));

      expect(updateMala.status).toBe(409);
      expect(deleteMala.status).toBe(409);
    }
  });
});
