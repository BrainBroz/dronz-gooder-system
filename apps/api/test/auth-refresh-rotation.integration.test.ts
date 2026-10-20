import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
let hashToken: typeof import("../src/modules/auth/auth.service").hashToken;

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  ({ hashToken } = await import("../src/modules/auth/auth.service"));
});
beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany({ where: { action: { in: ["login", "refresh_token_reuse"] } } });
});
afterAll(() => prisma.$disconnect());

const cookieOf = (header: string | string[] | undefined) => String([header].flat()[0] ?? "").split(";")[0]!;
const tokenOf = (cookie: string) => decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
const clearsCookie = (header: string | string[] | undefined) => /Expires=Thu, 01 Jan 1970/.test(String([header].flat()[0] ?? ""));

async function loginCookie(app: ReturnType<typeof createApp>) {
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  return cookieOf(login.headers["set-cookie"]);
}

describe("rotação do refresh token sob concorrência", () => {
  it("duas renovações simultâneas com o mesmo token: uma sessão sucessora, a outra recusada sem apagar o cookie", async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const cookie = await loginCookie(app);
      const [a, b] = await Promise.all([
        request(app).post("/auth/refresh").set("Cookie", cookie),
        request(app).post("/auth/refresh").set("Cookie", cookie)
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
      expect(loser.body.error).toBe("refresh_concorrente");
      expect(loser.headers["set-cookie"]).toBeUndefined();

      const consumed = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(tokenOf(cookie)) } });
      const successor = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashToken(tokenOf(cookieOf(winner.headers["set-cookie"]))) }
      });
      expect(consumed.revokedAt).not.toBeNull();
      expect(consumed.replacedById).toBe(successor.id);
      expect(successor.revokedAt).toBeNull();
      expect(await prisma.refreshToken.count({ where: { usuarioId: consumed.usuarioId, revokedAt: null, createdAt: { gt: consumed.createdAt } } })).toBe(1);
    }
  });

  it("logo após a rotação, o token antigo recebe 409 sem nova sessão; o cookie novo continua válido", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const first = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(first.status).toBe(200);
    const before = await prisma.refreshToken.count();
    const replay = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(replay.status).toBe(409);
    expect(replay.body.accessToken).toBeUndefined();
    expect(replay.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.refreshToken.count()).toBe(before);
    const next = await request(app).post("/auth/refresh").set("Cookie", cookieOf(first.headers["set-cookie"]));
    expect(next.status).toBe(200);
  });

  it("fora da janela, reapresentar um token já rotacionado é reuso: 401, cookie limpo e auditoria", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    expect((await request(app).post("/auth/refresh").set("Cookie", cookie)).status).toBe(200);
    await prisma.refreshToken.update({
      where: { tokenHash: hashToken(tokenOf(cookie)) },
      data: { revokedAt: new Date(Date.now() - 11_000) }
    });
    const reuse = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(reuse.status).toBe(401);
    expect(clearsCookie(reuse.headers["set-cookie"])).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "refresh_token_reuse" } })).toBe(1);
  });

  it("token revogado por logout continua 401 mesmo logo em seguida", async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    expect((await request(app).post("/auth/logout").set("Cookie", cookie)).status).toBe(200);
    const after = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(after.status).toBe(401);
    expect(clearsCookie(after.headers["set-cookie"])).toBe(true);
  });
});
