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

function deepSearchKeys(value: unknown, forbidden: string[], path = "root"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...deepSearchKeys(item, forbidden, `${path}[${index}]`));
    });
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.includes(key)) hits.push(`${path}.${key}`);
      hits.push(...deepSearchKeys(nested, forbidden, `${path}.${key}`));
    }
  }
  return hits;
}

async function login(agent = request.agent(createApp())) {
  return agent.post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
}

function cookieValue(setCookieHeader: string | string[] | undefined) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw ? raw.split(";")[0] : "";
}

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

describe("auth integration", () => {
  it("login válido retorna access token, cookie HttpOnly e sem refreshToken no body", async () => {
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.user.email).toBe("admin@example.com");
    expect(response.body.stores.map((store: { slug: string }) => store.slug)).toEqual(["dronz", "gooder"]);
    expect(response.body.refreshToken).toBeUndefined();
    expect(deepSearchKeys(response.body, ["refreshToken", "refresh_token", "refresh-token"])).toEqual([]);
    const cookie = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"][0] : response.headers["set-cookie"];
    expect(cookie).toContain("HttpOnly");
  });

  it("login inválido e usuário inexistente não criam sessão", async () => {
    const app = createApp();
    const invalid = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "wrong-password" });
    const missing = await request(app).post("/auth/login").send({ email: "missing@example.com", password: "change-me" });
    expect(invalid.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(invalid.headers["set-cookie"]).toBeUndefined();
    expect(missing.headers["set-cookie"]).toBeUndefined();
  });

  it("login com payload ausente ou e-mail inválido falha", async () => {
    const app = createApp();
    const missing = await request(app).post("/auth/login").send({});
    const invalidEmail = await request(app).post("/auth/login").send({ email: "abc", password: "x" });
    expect(missing.status).toBe(400);
    expect(invalidEmail.status).toBe(400);
  });

  it("refresh com cookie válido retorna novo access token e roda rotação", async () => {
    const agent = request.agent(createApp());
    const loginResponse = await login(agent);
    const firstCookie = cookieValue(loginResponse.headers["set-cookie"]);
    const refresh = await agent.post("/auth/refresh").set("Cookie", firstCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTruthy();
    expect(refresh.body.refreshToken).toBeUndefined();
    expect(deepSearchKeys(refresh.body, ["refreshToken", "refresh_token", "refresh-token"])).toEqual([]);
  });

  it("refresh sem cookie, com cookie inválido, expirado, revogado, body, query e header falha", async () => {
    const app = createApp();
    const loginResponse = await login();
    const cookie = cookieValue(loginResponse.headers["set-cookie"]);
    const revokedResponse = await request(app).post("/auth/logout").set("Cookie", cookie);
    expect(revokedResponse.status).toBe(200);

    const missing = await request(app).post("/auth/refresh");
    const invalidCookie = await request(app).post("/auth/refresh").set("Cookie", "dronz_refresh_token=invalid");
    const bodyOnly = await request(app).post("/auth/refresh").send({ refreshToken: "invalid" });
    const queryOnly = await request(app).post("/auth/refresh?refreshToken=invalid");
    const headerOnly = await request(app).post("/auth/refresh").set("x-refresh-token", "invalid");
    const afterLogout = await request(app).post("/auth/refresh").set("Cookie", cookie);
    const expired = jwt.sign({ sub: "expired", tokenType: "refresh", jti: "expired" }, process.env.JWT_REFRESH_SECRET!, { expiresIn: "-1s" });
    const expiredResponse = await request(app).post("/auth/refresh").set("Cookie", `dronz_refresh_token=${expired}`);

    expect(missing.status).toBe(401);
    expect(invalidCookie.status).toBe(401);
    expect(bodyOnly.status).toBe(401);
    expect(queryOnly.status).toBe(401);
    expect(headerOnly.status).toBe(401);
    expect(afterLogout.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
  });

  it("logout revoga sessão, limpa cookie e é idempotente", async () => {
    const loginResponse = await login();
    const cookie = cookieValue(loginResponse.headers["set-cookie"]);
    const first = await request(createApp()).post("/auth/logout").set("Cookie", cookie);
    const second = await request(createApp()).post("/auth/logout");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.refreshToken).toBeUndefined();
    expect(second.body.refreshToken).toBeUndefined();
    expect(deepSearchKeys(first.body, ["refreshToken", "refresh_token", "refresh-token"])).toEqual([]);
    expect(deepSearchKeys(second.body, ["refreshToken", "refresh_token", "refresh-token"])).toEqual([]);
  });

  it("/auth/me retorna identidade sem refreshToken e respeita auth", async () => {
    const loginResponse = await login();
    const me = await request(createApp()).get("/auth/me").set("Authorization", `Bearer ${loginResponse.body.accessToken}`);
    const missing = await request(createApp()).get("/auth/me");
    const invalid = await request(createApp()).get("/auth/me").set("Authorization", "Bearer invalid");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("admin@example.com");
    expect(me.body.refreshToken).toBeUndefined();
    expect(deepSearchKeys(me.body, ["refreshToken", "refresh_token", "refresh-token"])).toEqual([]);
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it("rejeita JWT assinado com tipo incorreto nas rotas protegidas", async () => {
    const loginResponse = await login();
    const wrongType = jwt.sign(
      { sub: loginResponse.body.user.id, tokenType: "refresh", jti: "wrong-type" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m" }
    );
    const response = await request(createApp()).get("/auth/me").set("Authorization", `Bearer ${wrongType}`);
    expect(response.status).toBe(401);
  });
});
