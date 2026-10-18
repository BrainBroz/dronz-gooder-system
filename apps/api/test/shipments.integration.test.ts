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
type Fixture = Awaited<ReturnType<typeof createOperationalFixture>>;
const fixtures: Fixture[] = [];
const trips: string[] = [];
const groups: string[] = [];
const users: string[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const id of trips.splice(0)) {
    await prisma.handoffVolume.deleteMany({
      where: { mala: { viagemId: id } }
    });
    await prisma.alocacaoMala.deleteMany({ where: { mala: { viagemId: id } } });
    await prisma.volumeLogistico.deleteMany({
      where: { mala: { viagemId: id } }
    });
    await prisma.mala.deleteMany({ where: { viagemId: id } });
    await prisma.viagem.deleteMany({ where: { id } });
  }
  for (const fixture of fixtures.splice(0)) {
    await prisma.mala.updateMany({
      where: { viagemId: fixture.trip.id },
      data: { grupoFisicoId: null }
    });
    await fixture.cleanup();
  }
  for (const id of groups.splice(0)) {
    await prisma.mala.updateMany({
      where: { grupoFisicoId: id },
      data: { grupoFisicoId: null }
    });
    await prisma.grupoFisico.deleteMany({ where: { id } });
  }
  for (const id of users.splice(0)) {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

const store = (slug: string) =>
  prisma.loja.findUniqueOrThrow({ where: { slug } });

async function session(email = "admin@example.com") {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  const headers = (lojaId: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": lojaId
  });
  return { app, headers };
}

async function fixture(slug = "dronz", weightKg = 1) {
  const data = await createOperationalFixture(prisma, (await store(slug)).id);
  fixtures.push(data);
  await prisma.alocacaoMala.deleteMany({
    where: { pedidoCompraItemId: data.item.id }
  });
  await prisma.produto.update({
    where: { id: data.product.id },
    data: { peso: weightKg }
  });
  await prisma.recebimentoMiami.create({
    data: {
      lojaId: data.order.lojaId,
      pedidoCompraItemId: data.item.id,
      quantidadeRecebida: 2,
      recebidoEm: new Date(),
      confirmadoPorId: data.admin.id
    }
  });
  return data;
}

const tripBody = (extra: Record<string, unknown>) => ({
  origem: "Miami",
  destino: "São Paulo",
  partidaEm: new Date(Date.now() + 86_400_000).toISOString(),
  chegadaPrevistaEm: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  rotaCodigo: "MIAMI_BRASIL",
  ...extra
});

async function airBox(app: Awaited<ReturnType<typeof session>>, data: Fixture) {
  const h = app.headers(data.order.lojaId);
  const trip = await request(app.app)
    .post("/logistics/trips")
    .set(h)
    .send(
      tripBody({ modalidade: "CAIXA_AEREA", transportadora: "Aero Cargo" })
    );
  expect(trip.status, JSON.stringify(trip.body)).toBe(200);
  trips.push(trip.body.id);
  await request(app.app)
    .patch(`/logistics/trips/${trip.body.id}/status`)
    .set(h)
    .send({ status: "OPEN_FOR_ALLOCATION" });
  const box = await request(app.app)
    .post("/logistics/suitcases")
    .set(h)
    .send({ viagemId: trip.body.id, codigo: "CX-1" });
  expect(box.status).toBe(200);
  const volume = await prisma.volumeLogistico.create({
    data: {
      lojaId: data.order.lojaId,
      malaId: box.body.id,
      codigo: "CX-1-V",
      taraKg: 1
    }
  });
  return { trip: trip.body, box: box.body, volume };
}

describe("envios: caixa aérea, handoff e volume físico entre lojas", () => {
  it("caixa aérea exige transportadora e não herda o limite de 23 kg da mala", async () => {
    const admin = await session();
    const data = await fixture("dronz", 15);
    const h = admin.headers(data.order.lojaId);
    const noCarrier = await request(admin.app)
      .post("/logistics/trips")
      .set(h)
      .send(tripBody({ modalidade: "CAIXA_AEREA" }));
    expect(noCarrier.body.error).toBe("carrier_required");
    const { box, volume } = await airBox(admin, data);
    expect(box).toMatchObject({ tipo: "CAIXA", limitePesoKg: null });
    const allocated = await request(admin.app)
      .post("/logistics/allocations")
      .set(h)
      .send({
        pedidoCompraItemId: data.item.id,
        malaId: box.id,
        volumeLogisticoId: volume.id,
        quantidade: 2
      });
    expect(allocated.status).toBe(200);
    const weight = await request(admin.app)
      .get(`/logistics/suitcases/${box.id}/weight`)
      .set(h);
    expect(Number(weight.body.totalKg)).toBe(31);
    expect(weight.body).toMatchObject({
      excesso: false,
      limiteKg: null,
      restanteKg: null
    });
  });

  it("mala de viajante continua limitada a 23 kg", async () => {
    const admin = await session();
    const data = await fixture();
    const h = admin.headers(data.order.lojaId);
    const tooHeavy = await request(admin.app)
      .post("/logistics/suitcases")
      .set(h)
      .send({ viagemId: data.trip.id, codigo: "M-30", limitePesoKg: 30 });
    expect(tooHeavy.body.error).toBe("weight_limit_above_23kg");
    expect(
      (await prisma.mala.findUniqueOrThrow({ where: { id: data.bag.id } })).tipo
    ).toBe("MALA");
  });

  it("D-13: embarque registra handoff; caixa exige referência do recibo", async () => {
    const admin = await session();
    const data = await fixture();
    const h = admin.headers(data.order.lojaId);
    const { box, volume } = await airBox(admin, data);
    await request(admin.app)
      .post("/logistics/allocations")
      .set(h)
      .send({
        pedidoCompraItemId: data.item.id,
        malaId: box.id,
        volumeLogisticoId: volume.id,
        quantidade: 1
      });
    expect(
      (
        await request(admin.app)
          .patch(`/logistics/suitcases/${box.id}/status`)
          .set(h)
          .send({ status: "CLOSED" })
      ).status
    ).toBe(200);
    const noReceipt = await request(admin.app)
      .patch(`/logistics/suitcases/${box.id}/status`)
      .set(h)
      .send({ status: "CHECKED_IN" });
    expect(noReceipt.body.error).toBe("handoff_reference_required");
    expect(
      (await prisma.mala.findUniqueOrThrow({ where: { id: box.id } })).status
    ).toBe("CLOSED");
    const shipped = await request(admin.app)
      .patch(`/logistics/suitcases/${box.id}/status`)
      .set(h)
      .send({ status: "CHECKED_IN", referencia: "AWB-123" });
    expect(shipped.status).toBe(200);
    const handoff = await prisma.handoffVolume.findFirstOrThrow({
      where: { malaId: box.id }
    });
    expect(handoff).toMatchObject({
      recebidoPor: "Aero Cargo",
      referencia: "AWB-123",
      entreguePorId: data.admin.id
    });
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: data.product.id }
      })
    ).toBe(0);
  });

  it("D-11: partes das duas lojas somam peso contra o mesmo limite físico", async () => {
    const admin = await session();
    const [dronz, gooder] = [
      await fixture("dronz", 10),
      await fixture("gooder", 1.6)
    ];
    const group = await request(admin.app)
      .post("/logistics/physical-groups")
      .set(admin.headers(dronz.order.lojaId))
      .send({
        codigo: `MALA-COMPARTILHADA-${randomUUID().slice(0, 6)}`,
        tipo: "MALA"
      });
    expect(group.status).toBe(200);
    groups.push(group.body.id);
    for (const part of [dronz, gooder]) {
      const linked = await request(admin.app)
        .put(`/logistics/suitcases/${part.bag.id}/physical-group`)
        .set(admin.headers(part.order.lojaId))
        .send({ grupoFisicoId: group.body.id });
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    }
    // Tara 0,5 + 0,5; Dronz 2 × 10 kg = 21 kg no volume físico.
    expect(
      (
        await request(admin.app)
          .post("/logistics/allocations")
          .set(admin.headers(dronz.order.lojaId))
          .send({
            pedidoCompraItemId: dronz.item.id,
            malaId: dronz.bag.id,
            volumeLogisticoId: dronz.volume.id,
            quantidade: 2
          })
      ).status
    ).toBe(200);
    const over = await request(admin.app)
      .post("/logistics/allocations")
      .set(admin.headers(gooder.order.lojaId))
      .send({
        pedidoCompraItemId: gooder.item.id,
        malaId: gooder.bag.id,
        volumeLogisticoId: gooder.volume.id,
        quantidade: 2
      });
    expect(over.body.error).toBe("weight_limit");
    expect(
      (
        await request(admin.app)
          .post("/logistics/allocations")
          .set(admin.headers(gooder.order.lojaId))
          .send({
            pedidoCompraItemId: gooder.item.id,
            malaId: gooder.bag.id,
            volumeLogisticoId: gooder.volume.id,
            quantidade: 1
          })
      ).status
    ).toBe(200);
    const weight = await request(admin.app)
      .get(`/logistics/suitcases/${gooder.bag.id}/weight`)
      .set(admin.headers(gooder.order.lojaId));
    expect(Number(weight.body.totalKg)).toBe(22.6);
  });

  it("D-11: alocações concorrentes de lojas diferentes não estouram o limite físico", async () => {
    const admin = await session();
    const [dronz, gooder] = [
      await fixture("dronz", 12),
      await fixture("gooder", 12)
    ];
    const group = await request(admin.app)
      .post("/logistics/physical-groups")
      .set(admin.headers(dronz.order.lojaId))
      .send({ codigo: `MALA-RACE-${randomUUID().slice(0, 6)}`, tipo: "MALA" });
    groups.push(group.body.id);
    for (const part of [dronz, gooder])
      await prisma.mala.update({
        where: { id: part.bag.id },
        data: { grupoFisicoId: group.body.id }
      });
    const { allocate } =
      await import("../src/modules/logistics/logistics.service");
    const actor = { userId: dronz.admin.id, permissions: ["SYSTEM_ADMIN"] };
    await Promise.allSettled(
      [dronz, gooder].map((part) =>
        allocate(
          part.order.lojaId,
          {
            pedidoCompraItemId: part.item.id,
            malaId: part.bag.id,
            volumeLogisticoId: part.volume.id,
            quantidade: 1
          },
          actor
        )
      )
    );
    const total = await prisma.alocacaoMala.aggregate({
      where: { mala: { grupoFisicoId: group.body.id } },
      _sum: { pesoConteudoKg: true }
    });
    expect(Number(total._sum.pesoConteudoKg)).toBe(12);
  });

  it("D-11: compor com outra loja exige acesso a ela; a outra parte aparece restrita", async () => {
    const admin = await session();
    const [dronz, gooder] = [await fixture("dronz"), await fixture("gooder")];
    const group = await request(admin.app)
      .post("/logistics/physical-groups")
      .set(admin.headers(gooder.order.lojaId))
      .send({ codigo: `MALA-ACL-${randomUUID().slice(0, 6)}`, tipo: "MALA" });
    groups.push(group.body.id);
    await request(admin.app)
      .put(`/logistics/suitcases/${gooder.bag.id}/physical-group`)
      .set(admin.headers(gooder.order.lojaId))
      .send({ grupoFisicoId: group.body.id });
    const profile = await prisma.perfil.findUniqueOrThrow({
      where: { code: "GESTOR_LOJA" }
    });
    const email = `shipments-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({
      data: {
        name: "Dronz",
        email,
        passwordHash: await bcrypt.hash("change-me", 12),
        lojas: { create: { lojaId: dronz.order.lojaId } },
        perfis: { create: { perfilId: profile.id } }
      }
    });
    users.push(user.id);
    const dronzOnly = await session(email);
    const denied = await request(dronzOnly.app)
      .put(`/logistics/suitcases/${dronz.bag.id}/physical-group`)
      .set(dronzOnly.headers(dronz.order.lojaId))
      .send({ grupoFisicoId: group.body.id });
    expect(denied.body.error).toBe("physical_group_not_authorized");
    const view = await request(dronzOnly.app)
      .get(`/logistics/physical-groups/${group.body.id}`)
      .set(dronzOnly.headers(dronz.order.lojaId));
    expect(view.body.partes).toEqual([
      { lojaId: gooder.order.lojaId, restrita: true }
    ]);
  });
});
