import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import {
  createSession,
  getAuthenticatedUser,
  hashToken,
  verifyPassword
} from "./lib/auth";
import { env } from "./lib/env";
import jwt from "jsonwebtoken";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

function authCookie(token: string) {
  return `refreshToken=${token}; HttpOnly; Path=/; SameSite=Lax`;
}

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/auth/login", async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await prisma.usuario.findUnique({ where: { email } });
      if (!user || !user.active) return res.status(401).json({ error: "invalid_credentials" });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "invalid_credentials" });
      const session = await createSession(user.id);
      await prisma.auditLog.create({
        data: { usuarioId: user.id, action: "login", entity: "Usuario", entityId: user.id, data: { email } }
      });
      res.setHeader("Set-Cookie", authCookie(session.refreshToken));
      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      let decoded: { sub: string; jti: string };
      try {
        decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; jti: string };
      } catch {
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      const tokenHash = hashToken(refreshToken);
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
      const user = await prisma.usuario.findUnique({ where: { id: decoded.sub } });
      if (!user || !user.active) return res.status(401).json({ error: "invalid_refresh_token" });
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      const session = await createSession(user.id);
      res.setHeader("Set-Cookie", authCookie(session.refreshToken));
      res.json({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/logout", async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken === "string") {
      const tokenHash = await hashToken(refreshToken);
      await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.setHeader("Set-Cookie", authCookie(""));
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
