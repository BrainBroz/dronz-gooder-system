import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
let fixture: Awaited<ReturnType<typeof createOperationalFixture>> | undefined;
afterEach(async () => {
  if (fixture) {
    const bags = await prisma.mala.findMany({
      where: { viagemId: fixture.trip.id }, select: { id: true }
    });
    const checkpoints = await prisma.checkpointParaguai.findMany({
      where: { viagemId: fixture.trip.id }, select: { id: true }
    });
    const checkpointIds = checkpoints.map((checkpoint) => checkpoint.id);
    await prisma.eventoCorretivo.deleteMany({
      where: { originalEventId: { in: checkpointIds } }
    });
    await prisma.projecaoOperacional.deleteMany({
      where: { entityId: { in: checkpointIds } }
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [fixture.trip.id, ...bags.map((bag) => bag.id), ...checkpointIds] } }
    });
    await prisma.checkpointParaguai.deleteMany({ where: { viagemId: fixture.trip.id } });
    await prisma.mala.deleteMany({
      where: { viagemId: fixture.trip.id, id: { not: fixture.bag.id } }
    });
    await fixture.cleanup();
  }
  fixture = undefined;
});
afterAll(() => prisma.$disconnect());
async function s() {
  const app = createApp(),
    l = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    t: l.body.accessToken,
    d: l.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
    g: l.body.stores.find((x: { slug: string }) => x.slug === "gooder")
  };
}
const h = (t: string, id: string) => ({
  Authorization: `Bearer ${t}`,
  "x-store-id": id
});
async function paraguayTripInTransit(lojaId: string) {
  fixture = await createOperationalFixture(prisma, lojaId, "MIAMI_PARAGUAI_BRASIL");
  await prisma.viagem.update({
    where: { id: fixture.trip.id }, data: { status: "IN_TRANSIT" }
  });
  await prisma.mala.update({
    where: { id: fixture.bag.id }, data: { status: "CHECKED_IN" }
  });
  return fixture;
}
describe("international logistics", () => {
  it("audita transições com ator e loja na mesma transação", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, bag, admin } = fixture;
    expect((await request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(h(t, d.id)).send({ status: "CLOSED_FOR_ALLOCATION" })).status).toBe(200);
    expect((await request(app).patch(`/logistics/suitcases/${bag.id}/status`)
      .set(h(t, d.id)).send({ status: "CLOSED" })).status).toBe(200);
    const logs = await prisma.auditLog.findMany({
      where: { entityId: { in: [trip.id, bag.id] } }
    });
    expect(logs.map((log) => log.action).sort())
      .toEqual(["UPDATE_SUITCASE_STATUS", "UPDATE_TRIP_STATUS"]);
    for (const log of logs) {
      expect(log.usuarioId).toBe(admin.id);
      expect(log.lojaId).toBe(d.id);
      expect(log.origin).toBe("API_LOGISTICS");
      expect(log.permissionCode).toBeNull();
      expect(log.correlationId).toBeTruthy();
      expect(log.beforeData).toMatchObject({ status: expect.any(String) });
      expect(log.afterData).toMatchObject({ status: expect.any(String) });
    }
  });

  it("faz rollback das transições se AuditLog falhar", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, bag } = fixture;
    const { setAuditFailureForTests } = await import("../src/modules/operations/operations.persistence");
    setAuditFailureForTests((input) => [trip.id, bag.id].includes(input.entityId));
    try {
      expect((await request(app).patch(`/logistics/trips/${trip.id}/status`)
        .set(h(t, d.id)).send({ status: "CLOSED_FOR_ALLOCATION" })).status).toBe(500);
      expect((await request(app).patch(`/logistics/suitcases/${bag.id}/status`)
        .set(h(t, d.id)).send({ status: "CLOSED" })).status).toBe(500);
    } finally {
      setAuditFailureForTests();
    }
    expect((await prisma.viagem.findUniqueOrThrow({ where: { id: trip.id } })).status)
      .toBe("OPEN_FOR_ALLOCATION");
    expect((await prisma.mala.findUniqueOrThrow({ where: { id: bag.id } })).status)
      .toBe("PLANNING");
    expect(await prisma.auditLog.count({ where: { entityId: { in: [trip.id, bag.id] } } }))
      .toBe(0);
  });

  it("oferece transições da viagem e rejeita avanço concorrente do mesmo estado", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const tripId = fixture.trip.id;
    await prisma.alocacaoMala.delete({ where: { id: fixture.allocation.id } });
    const list = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(list.body.find((trip: { id: string }) => trip.id === tripId).allowedStatusTransitions)
      .toEqual(["CLOSED_FOR_ALLOCATION", "CANCELLED"]);
    const results = await Promise.all([
      request(app).patch(`/logistics/trips/${tripId}/status`).set(h(t, d.id))
        .send({ status: "CLOSED_FOR_ALLOCATION" }),
      request(app).patch(`/logistics/trips/${tripId}/status`).set(h(t, d.id))
        .send({ status: "CLOSED_FOR_ALLOCATION" })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await prisma.viagem.findUniqueOrThrow({ where: { id: tripId } })).status)
      .toBe("CLOSED_FOR_ALLOCATION");
  });

  it("serializa criação de mala e chegada para não admitir mala sem checkpoint", async () => {
    const { app, t, d } = await s();
    fixture = await paraguayTripInTransit(d.id);
    const { trip, bag } = fixture;
    await prisma.mala.update({ where: { id: bag.id }, data: { status: "CANCELLED" } });
    let locked!: () => void;
    let release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    const arrival = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Viagem" WHERE id = ${trip.id} FOR UPDATE`;
      locked();
      await releaseLock;
      await tx.viagem.update({
        where: { id: trip.id }, data: { status: "ARRIVED_BRAZIL" }
      });
    });
    await lockReady;
    const creation = request(app).post("/logistics/suitcases").set(h(t, d.id))
      .send({ viagemId: trip.id, codigo: `RACE-${trip.id}` }).then((response) => response);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 300 && !waiting; attempt++) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query LIKE '%"Viagem"%' OR query LIKE '%"Mala"%')
        `;
        waiting = rows[0].count > 0n;
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await arrival;
    }
    expect((await creation).status).toBe(404);
    const current = await prisma.viagem.findUniqueOrThrow({ where: { id: trip.id } });
    const activeBags = await prisma.mala.count({
      where: { viagemId: trip.id, status: { not: "CANCELLED" } }
    });
    expect(current.status).toBe("ARRIVED_BRAZIL");
    expect(activeBags).toBe(0);
  });

  it("bloqueia cancelamento até desalocar e não aceita alocação após cancelar", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, bag, volume, item, allocation } = fixture;
    const before = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(before.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["CLOSED_FOR_ALLOCATION"]);
    const cancel = () => request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(h(t, d.id)).send({ status: "CANCELLED" });
    expect((await cancel()).status).toBe(409);
    expect((await prisma.viagem.findUniqueOrThrow({ where: { id: trip.id } })).status)
      .toBe("OPEN_FOR_ALLOCATION");
    expect((await request(app).delete(`/logistics/allocations/${allocation.id}`)
      .set(h(t, d.id))).status).toBe(200);
    const after = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(after.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["CLOSED_FOR_ALLOCATION", "CANCELLED"]);
    expect((await cancel()).status).toBe(200);
    const rejected = await request(app).post("/logistics/allocations").set(h(t, d.id))
      .send({ pedidoCompraItemId: item.id, malaId: bag.id, volumeLogisticoId: volume.id, quantidade: 1 });
    expect(rejected.status).toBe(409);
    expect(await prisma.alocacaoMala.count({ where: { malaId: bag.id } })).toBe(0);
  });

  it("serializa cancelamento e nova alocação concorrentes", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, bag, volume, item, allocation } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    expect((await request(app).post("/logistics/miami-confirmations")
      .set(h(t, d.id)).send({
        pedidoCompraItemId: item.id, quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString()
      })).status).toBe(200);
    const results = await Promise.all([
      request(app).patch(`/logistics/trips/${trip.id}/status`)
        .set(h(t, d.id)).send({ status: "CANCELLED" }),
      request(app).post("/logistics/allocations").set(h(t, d.id))
        .send({ pedidoCompraItemId: item.id, malaId: bag.id, volumeLogisticoId: volume.id, quantidade: 1 })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const current = await prisma.viagem.findUniqueOrThrow({ where: { id: trip.id } });
    const allocated = await prisma.alocacaoMala.count({ where: { malaId: bag.id } });
    expect([current.status, allocated]).toEqual(
      current.status === "CANCELLED" ? ["CANCELLED", 0] : ["OPEN_FOR_ALLOCATION", 1]
    );
  });

  it("não deixa mala saltar etapas nem declarar chegada antes da viagem", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const bagId = fixture.bag.id;
    const tripId = fixture.trip.id;
    const changeBag = (status: string) => request(app)
      .patch(`/logistics/suitcases/${bagId}/status`).set(h(t, d.id)).send({ status });
    const changeTrip = (status: string) => request(app)
      .patch(`/logistics/trips/${tripId}/status`).set(h(t, d.id)).send({ status });
    const listed = await request(app).get("/logistics/suitcases").set(h(t, d.id));
    expect(listed.body.find((bag: { id: string }) => bag.id === bagId).allowedStatusTransitions)
      .toEqual(["CLOSED"]);
    expect((await changeBag("ARRIVED_BRAZIL")).status).toBe(409);
    expect((await changeBag("RECEIVED")).status).toBe(409);
    expect((await changeBag("CANCELLED")).status).toBe(409);
    expect((await changeBag("CLOSED")).status).toBe(200);
    expect((await changeBag("CLOSED")).status).toBe(409);
    expect((await changeBag("CHECKED_IN")).status).toBe(200);
    expect((await changeBag("ARRIVED_BRAZIL")).status).toBe(409);
    for (const status of ["CLOSED_FOR_ALLOCATION", "IN_TRANSIT", "ARRIVED_BRAZIL"])
      expect((await changeTrip(status)).status).toBe(200);
    const ready = await request(app).get("/logistics/suitcases").set(h(t, d.id));
    expect(ready.body.find((bag: { id: string }) => bag.id === bagId).allowedStatusTransitions)
      .toEqual(["ARRIVED_BRAZIL"]);
    expect((await changeBag("ARRIVED_BRAZIL")).status).toBe(200);
    expect((await changeBag("RECEIVED")).status).toBe(409);
    expect((await prisma.mala.findUniqueOrThrow({ where: { id: bagId } })).status)
      .toBe("ARRIVED_BRAZIL");
  });

  it("exige checkpoint Paraguai antes de declarar chegada na rota que o inclui", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id, "MIAMI_PARAGUAI_BRASIL");
    const { trip, bag } = fixture;
    const changeTrip = (status: string) => request(app)
      .patch(`/logistics/trips/${trip.id}/status`).set(h(t, d.id)).send({ status });
    const changeBag = (status: string) => request(app)
      .patch(`/logistics/suitcases/${bag.id}/status`).set(h(t, d.id)).send({ status });
    expect((await changeBag("CLOSED")).status).toBe(200);
    expect((await changeBag("CHECKED_IN")).status).toBe(200);
    expect((await changeTrip("CLOSED_FOR_ALLOCATION")).status).toBe(200);
    expect((await changeTrip("IN_TRANSIT")).status).toBe(200);
    const before = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(before.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual([]);
    const premature = await changeTrip("ARRIVED_BRAZIL");
    expect(premature.status).toBe(409);
    expect(premature.body.error).toBe("checkpoint_required");
    expect((await prisma.viagem.findUniqueOrThrow({ where: { id: trip.id } })).status)
      .toBe("IN_TRANSIT");
    const checkpoint = await request(app).post("/logistics/checkpoint-paraguai")
      .set(h(t, d.id)).send({
        viagemId: trip.id, malaId: bag.id, confirmadoEm: new Date().toISOString()
      });
    expect(checkpoint.status).toBe(200);
    const ready = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(ready.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["ARRIVED_BRAZIL"]);
    expect((await changeTrip("ARRIVED_BRAZIL")).status).toBe(200);
  });

  it("aceita checkpoint Paraguai corrigido na projeção efetiva", async () => {
    const { app, t, d } = await s();
    const { trip, bag, admin } = await paraguayTripInTransit(d.id);
    const checkpoint = await prisma.checkpointParaguai.create({ data: {
      lojaId: d.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date(), tipoDivergencia: "AVARIA"
    } });
    const changeTrip = () => request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(h(t, d.id)).send({ status: "ARRIVED_BRAZIL" });
    expect((await changeTrip()).status).toBe(409);
    const corrected = await request(app).post("/operations/corrections")
      .set(h(t, d.id)).send({
        entity: "CheckpointParaguai", originalEventId: checkpoint.id,
        correctionType: "DIVERGENCIA", reason: "Conferência posterior",
        after: { tipoDivergencia: "CORRETO" }
      });
    expect(corrected.status).toBe(200);
    const listed = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(listed.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["ARRIVED_BRAZIL"]);
    expect((await changeTrip()).status).toBe(200);
  });

  it("ignora checkpoint Paraguai substituído e considera somente o ativo", async () => {
    const { app, t, d } = await s();
    const { trip, bag, admin } = await paraguayTripInTransit(d.id);
    await prisma.checkpointParaguai.create({ data: {
      lojaId: d.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date(),
      tipoDivergencia: "CORRETO", supersededAt: new Date()
    } });
    const active = await prisma.checkpointParaguai.create({ data: {
      lojaId: d.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date(), tipoDivergencia: "AVARIA"
    } });
    const changeTrip = () => request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(h(t, d.id)).send({ status: "ARRIVED_BRAZIL" });
    const listed = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(listed.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual([]);
    expect((await changeTrip()).status).toBe(409);
    const corrected = await request(app).post("/operations/corrections")
      .set(h(t, d.id)).send({
        entity: "CheckpointParaguai", originalEventId: active.id,
        correctionType: "DIVERGENCIA", reason: "Conferência ativa corrigida",
        after: { tipoDivergencia: "CORRETO" }
      });
    expect(corrected.status).toBe(200);
    const ready = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(ready.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["ARRIVED_BRAZIL"]);
    expect((await changeTrip()).status).toBe(200);
  });

  it("exige liberação do Paraguai para todas as malas ativas da viagem", async () => {
    const { app, t, d } = await s();
    const { trip, bag, admin } = await paraguayTripInTransit(d.id);
    const second = await prisma.mala.create({ data: {
      lojaId: d.id, viagemId: trip.id, codigo: `SECOND-${trip.id}`, status: "CHECKED_IN"
    } });
    await prisma.checkpointParaguai.create({ data: {
      lojaId: d.id, viagemId: trip.id, malaId: bag.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date()
    } });
    const changeTrip = () => request(app).patch(`/logistics/trips/${trip.id}/status`)
      .set(h(t, d.id)).send({ status: "ARRIVED_BRAZIL" });
    const blocked = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(blocked.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual([]);
    expect((await changeTrip()).status).toBe(409);
    await prisma.checkpointParaguai.create({ data: {
      lojaId: d.id, viagemId: trip.id, malaId: second.id,
      confirmadoPorId: admin.id, confirmadoEm: new Date()
    } });
    const ready = await request(app).get("/logistics/trips").set(h(t, d.id));
    expect(ready.body.find((entry: { id: string }) => entry.id === trip.id).allowedStatusTransitions)
      .toEqual(["ARRIVED_BRAZIL"]);
    expect((await changeTrip()).status).toBe(200);
  });

  it("serializa alocações concorrentes e não excede o recebido em Miami", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { item, bag, volume, allocation } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    const received = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 2,
        recebidoEm: new Date().toISOString()
      });
    expect(received.status).toBe(200);
    const payload = {
      pedidoCompraItemId: item.id,
      malaId: bag.id,
      volumeLogisticoId: volume.id,
      quantidade: 2
    };
    const results = await Promise.all([
      request(app).post("/logistics/allocations").set(h(t, d.id)).send(payload),
      request(app).post("/logistics/allocations").set(h(t, d.id)).send(payload)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const allocations = await prisma.alocacaoMala.findMany({
      where: { pedidoCompraItemId: item.id }
    });
    expect(allocations.reduce((sum, entry) => sum + entry.quantidade, 0)).toBe(2);
  });

  it("rejeita peso acima do limite sem deixar alocação parcial", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { item, bag, volume, allocation } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    await prisma.mala.update({ where: { id: bag.id }, data: { limitePesoKg: 1 } });
    const received = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString()
      });
    expect(received.status).toBe(200);
    const allocationAttempt = await request(app)
      .post("/logistics/allocations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        malaId: bag.id,
        volumeLogisticoId: volume.id,
        quantidade: 1
      });
    expect(allocationAttempt.status).toBe(409);
    expect(allocationAttempt.body.error).toBe("weight_limit");
    expect(await prisma.alocacaoMala.count({ where: { malaId: bag.id } })).toBe(0);
  });

  it("serializa o limite de peso entre alocações concorrentes", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { item, bag, volume, allocation } = fixture;
    await prisma.alocacaoMala.delete({ where: { id: allocation.id } });
    await prisma.mala.update({ where: { id: bag.id }, data: { limitePesoKg: 1.5 } });
    const secondVolume = await prisma.volumeLogistico.create({
      data: { lojaId: d.id, malaId: bag.id, codigo: `BOX-B-${item.id}`, taraKg: 0 }
    });
    const received = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 2,
        recebidoEm: new Date().toISOString()
      });
    expect(received.status).toBe(200);
    const payload = (volumeLogisticoId: string) => ({
      pedidoCompraItemId: item.id,
      malaId: bag.id,
      volumeLogisticoId,
      quantidade: 1
    });
    const results = await Promise.all([
      request(app).post("/logistics/allocations").set(h(t, d.id)).send(payload(volume.id)),
      request(app).post("/logistics/allocations").set(h(t, d.id)).send(payload(secondVolume.id))
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.error).toBe("weight_limit");
    const bagWeight = await request(app)
      .get(`/logistics/suitcases/${bag.id}/weight`)
      .set(h(t, d.id));
    expect(Number(bagWeight.body.totalKg)).toBe(1.5);
  });

  it("não fecha mala acima do limite de peso", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    await prisma.mala.update({
      where: { id: fixture.bag.id },
      data: { limitePesoKg: 1 }
    });
    const result = await request(app)
      .patch(`/logistics/suitcases/${fixture.bag.id}/status`)
      .set(h(t, d.id))
      .send({ status: "CLOSED" });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("weight_limit");
    expect((await prisma.mala.findUniqueOrThrow({ where: { id: fixture.bag.id } })).status)
      .toBe("PLANNING");
  });

  it("não altera volumes nem alocações depois do fechamento", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { bag, volume, allocation } = fixture;
    const closed = await request(app)
      .patch(`/logistics/suitcases/${bag.id}/status`)
      .set(h(t, d.id))
      .send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    const results = await Promise.all([
      request(app).post(`/logistics/suitcases/${bag.id}/volumes`)
        .set(h(t, d.id)).send({ codigo: "LATE", taraKg: 0.2 }),
      request(app).patch(`/logistics/suitcases/${bag.id}/volumes/${volume.id}`)
        .set(h(t, d.id)).send({ taraKg: 0.8 }),
      request(app).delete(`/logistics/allocations/${allocation.id}`)
        .set(h(t, d.id))
    ]);
    expect(results.map((result) => result.status)).toEqual([409, 409, 409]);
    expect(await prisma.volumeLogistico.count({ where: { malaId: bag.id } })).toBe(1);
    expect(await prisma.alocacaoMala.count({ where: { malaId: bag.id } })).toBe(1);
  });

  it("isola lojas, omite documento e calcula conteúdo mais tara", async () => {
    const { app, t, d, g } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const travelers = await request(app)
      .get("/logistics/travelers")
      .set(h(t, d.id));
    expect(travelers.status).toBe(200);
    const traveler = travelers.body.find((item: { id: string }) => item.id === fixture?.traveler.id);
    expect(traveler).toBeTruthy();
    expect(traveler.documento).toBeUndefined();
    const bag = fixture.bag;
    const weight = await request(app)
      .get(`/logistics/suitcases/${bag.id}/weight`)
      .set(h(t, d.id));
    expect(Number(weight.body.conteudoKg)).toBe(1);
    expect(Number(weight.body.taraKg)).toBe(0.5);
    expect(Number(weight.body.totalKg)).toBe(1.5);
    expect(
      (
        await request(app)
          .get(`/logistics/suitcases/${bag.id}/weight`)
          .set(h(t, g.id))
      ).status
    ).toBe(404);
  });
  it("valida transições e confirmação Miami sem gerar estoque", async () => {
    const { app, t, d } = await s();
    fixture = await createOperationalFixture(prisma, d.id);
    const { trip, item } = fixture;
    expect(
      (
        await request(app)
          .patch(`/logistics/trips/${trip.id}/status`)
          .set(h(t, d.id))
          .send({ status: "ARRIVED_BRAZIL" })
      ).status
    ).toBe(409);
    const partial = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(Date.now() - 90000000).toISOString()
      });
    expect(partial.status).toBe(200);
    expect(partial.body.atraso).toBe(true);
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: item.pedidoCompraId }
        })
      ).status
    ).toBe("PARTIALLY_RECEIVED_MIAMI");
    await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(t, d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString()
      });
    expect(
      (
        await prisma.pedidoCompra.findUniqueOrThrow({
          where: { id: item.pedidoCompraId }
        })
      ).status
    ).toBe("RECEIVED_MIAMI");
  });
});
