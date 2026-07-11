import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { createSession, getAuthenticatedUser, hashToken, verifyPassword } from "./lib/auth";
import { env } from "./lib/env";
import jwt from "jsonwebtoken";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const REFRESH_COOKIE = "dronz_refresh_token";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function authCookie(token: string, expiresAt?: Date) {
  const parts = [
    `${REFRESH_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax"
  ];
  if (expiresAt) parts.push(`Expires=${expiresAt.toUTCString()}`);
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

function clearAuthCookie() {
  const parts = [
    `${REFRESH_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  const match = header.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/auth/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "bad_request" });
      const { email, password } = parsed.data;
      const user = await prisma.usuario.findUnique({ where: { email } });
      if (!user || !user.active) return res.status(401).json({ error: "invalid_credentials" });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "invalid_credentials" });
      const session = await createSession(user.id);
      await prisma.auditLog.create({
        data: { usuarioId: user.id, action: "login", entity: "Usuario", entityId: user.id, data: { email } }
      });
      res.setHeader("Set-Cookie", authCookie(session.refreshToken, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)));
      res.json({
        accessToken: session.accessToken,
        user: session.user,
        stores: session.lojas,
        profiles: session.perfis,
        permissions: session.permissoes
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/refresh", async (req, res) => {
    try {
      const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!refreshToken) {
        res.setHeader("Set-Cookie", clearAuthCookie());
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      let decoded: { sub: string; jti: string };
      try {
        decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; jti: string };
      } catch {
        res.setHeader("Set-Cookie", clearAuthCookie());
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      const tokenHash = hashToken(refreshToken);
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
        res.setHeader("Set-Cookie", clearAuthCookie());
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      const user = await prisma.usuario.findUnique({ where: { id: decoded.sub } });
      if (!user || !user.active) {
        res.setHeader("Set-Cookie", clearAuthCookie());
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      const session = await createSession(user.id);
      res.setHeader("Set-Cookie", authCookie(session.refreshToken, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)));
      res.json({ accessToken: session.accessToken });
    } catch {
      res.setHeader("Set-Cookie", clearAuthCookie());
      res.status(401).json({ error: "invalid_refresh_token" });
    }
  });

  app.post("/auth/logout", async (req, res) => {
    const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.setHeader("Set-Cookie", clearAuthCookie());
    res.json({ status: "ok" });
  });

  app.get("/auth/me", async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
      const identity = await getAuthenticatedUser(payload.sub);
      res.json(identity);
    } catch {
      res.status(401).json({ error: "unauthorized" });
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response) => {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.status(400).json({ error: "bad_request" });
  });

  return app;
}
