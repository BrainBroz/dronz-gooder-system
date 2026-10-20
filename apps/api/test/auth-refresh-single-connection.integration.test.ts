import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

// Pool com uma única conexão: a renovação não pode depender de uma segunda conexão enquanto a
// transação de rotação segura a primeira.
const base = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.DATABASE_URL = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

let createApp: typeof import("../src/app").createApp;
let prisma: typeof import("../src/lib/prisma").prisma;
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  ({ prisma } = await import("../src/lib/prisma"));
});
afterAll(() => prisma.$disconnect());

describe("rotação com pool de uma conexão", () => {
  it("renova sem esperar uma segunda conexão", async () => {
    const app = createApp();
    const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
    const cookie = String([login.headers["set-cookie"]].flat()[0]).split(";")[0]!;
    const started = Date.now();
    const refreshed = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 20_000);
});
