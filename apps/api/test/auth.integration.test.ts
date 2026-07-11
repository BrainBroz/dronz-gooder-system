import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/dronz_gooder?schema=public";
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
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function login() {
  const app = createApp();
  const response = await request(app).post("/auth/login").send({
    email: "admin@example.com",
    password: "change-me"
  });
  return response;
}

describe("auth integration", () => {
  it("logs in successfully and returns only permitted stores", async () => {
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("admin@example.com");
    expect(response.body.lojas.map((store: { slug: string }) => store.slug)).toEqual(["dronz", "gooder"]);
    expect(response.body).not.toHaveProperty("passwordHash");
  });

  it("rejects invalid login", async () => {
    const app = createApp();
    const response = await request(app).post("/auth/login").send({
      email: "admin@example.com",
      password: "wrong-password"
    });
    expect(response.status).toBe(401);
  });

  it("rejects nonexistent user", async () => {
    const app = createApp();
    const response = await request(app).post("/auth/login").send({
      email: "missing@example.com",
      password: "change-me"
    });
    expect(response.status).toBe(401);
  });

  it("authenticates me with a valid access token", async () => {
    const loginResponse = await login();
    const app = createApp();
    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginResponse.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("admin@example.com");
    expect(response.body.lojas).toHaveLength(2);
  });

  it("rejects me without token", async () => {
    const app = createApp();
    const response = await request(app).get("/auth/me");
    expect(response.status).toBe(401);
  });

  it("rejects me with invalid token", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer invalid-token");
    expect(response.status).toBe(401);
  });

  it("refreshes a valid token and rotates it", async () => {
    const loginResponse = await login();
    const app = createApp();
    const refresh = loginResponse.body.refreshToken;
    const response = await request(app).post("/auth/refresh").send({ refreshToken: refresh });
    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).not.toBe(refresh);
  });

  it("rejects revoked refresh token", async () => {
    const loginResponse = await login();
    const app = createApp();
    const refresh = loginResponse.body.refreshToken;
    await request(app).post("/auth/logout").send({ refreshToken: refresh });
    const response = await request(app).post("/auth/refresh").send({ refreshToken: refresh });
    expect(response.status).toBe(401);
  });

  it("rejects expired refresh token", async () => {
    const app = createApp();
    const expired = jwt.sign(
      { sub: "expired", tokenType: "refresh", jti: "expired" },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "-1s" }
    );
    const response = await request(app).post("/auth/refresh").send({ refreshToken: expired });
    expect(response.status).toBe(401);
  });

  it("logs out idempotently", async () => {
    const loginResponse = await login();
    const app = createApp();
    const refresh = loginResponse.body.refreshToken;
    const first = await request(app).post("/auth/logout").send({ refreshToken: refresh });
    const second = await request(app).post("/auth/logout").send({ refreshToken: refresh });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("keeps loja scope constrained to the authenticated identity", async () => {
    const loginResponse = await login();
    const app = createApp();
    const response = await request(app)
      .get("/auth/me?lojaId=other")
      .set("Authorization", `Bearer ${loginResponse.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.lojas.map((store: { slug: string }) => store.slug)).toEqual(["dronz", "gooder"]);
  });
});
