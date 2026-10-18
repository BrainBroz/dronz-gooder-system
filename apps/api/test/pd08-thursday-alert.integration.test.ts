import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createOperationalFixture } from "./helpers/operational-fixture";
import { zonedTimeToUtc } from "../src/lib/time-window";

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
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterAll(() => prisma.$disconnect());

// Quinta-feira anterior a hoje (no calendário de Miami), às 09:00 locais: janela já encerrada.
function lastThursdayNineAm() {
  const now = new Date();
  for (let back = 1; back <= 8; back++) {
    const day = new Date(now.getTime() - back * 86_400_000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric"
    }).formatToParts(day);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    if (get("weekday") === "Thu")
      return zonedTimeToUtc(
        Number(get("year")),
        Number(get("month")),
        Number(get("day")),
        9,
        "America/New_York"
      );
  }
  throw new Error("unreachable");
}

describe("PD-08 alerta de envio de quinta-feira", () => {
  it("conta viagem de quinta de manhã que não saiu após 12:00 no fuso da origem", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const app = createApp();
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
    const headers = {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": store.id
    };
    const count = async () =>
      (await request(app).get("/operations/home").set(headers)).body.secoes
        .find((s: { codigo: string }) => s.codigo === "LOGISTICA")
        .itens.find(
          (i: { codigo: string }) => i.codigo === "ENVIO_QUINTA_ATRASADO"
        ).quantidade as number;
    const data = await createOperationalFixture(prisma, store.id);
    try {
      const before = await count();
      await prisma.viagem.update({
        where: { id: data.trip.id },
        data: { partidaEm: lastThursdayNineAm() }
      });
      expect(await count()).toBe(before + 1);
      await prisma.viagem.update({
        where: { id: data.trip.id },
        data: { status: "IN_TRANSIT" }
      });
      expect(await count()).toBe(before);
    } finally {
      await data.cleanup();
    }
  });
});
