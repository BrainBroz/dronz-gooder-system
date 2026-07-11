import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { createSession, getAuthenticatedUser, hashToken, verifyPassword } from "./lib/auth";
import { env } from "./lib/env";
import jwt from "jsonwebtoken";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const storeHeaderSchema = z.object({ storeId: z.string().min(1) });
const categoryCreateSchema = z.object({
  lojaId: z.string().min(1).optional(),
  nome: z.string().min(1),
  slug: z.string().min(1),
  descricao: z.string().optional().nullable(),
  ordem: z.number().int().default(0),
  ativo: z.boolean().optional()
}).strict();
const categoryUpdateSchema = categoryCreateSchema.partial().omit({ lojaId: true }).strict();
const productCreateSchema = z.object({
  lojaId: z.string().min(1).optional(),
  categoriaId: z.string().min(1),
  codigo: z.number().int().min(1),
  nome: z.string().min(1),
  slug: z.string().min(1),
  descricao: z.string().optional().nullable(),
  precoVenda: z.number().min(0),
  markup: z.number().min(25),
  peso: z.number().min(0).optional().nullable(),
  ativo: z.boolean().optional()
}).strict();
const productUpdateSchema = productCreateSchema.partial().omit({ lojaId: true, codigo: true }).strict();

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

function parseAccessToken(req: express.Request) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return undefined;
  return auth.slice(7);
}

async function authorizeUser(req: express.Request, res: express.Response) {
  const token = parseAccessToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return undefined;
  }
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
    const identity = await getAuthenticatedUser(payload.sub);
    return identity;
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return undefined;
  }
}

function parseStoreId(req: express.Request) {
  const result = storeHeaderSchema.safeParse({ storeId: req.headers["x-store-id"] });
  return result.success ? result.data.storeId : undefined;
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

  app.get("/categories", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const categories = await prisma.categoria.findMany({
      where: { lojaId: storeId },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }]
    });
    res.json({ items: categories });
  });

  app.get("/categories/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const category = await prisma.categoria.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!category) return res.status(404).json({ error: "not_found" });
    res.json(category);
  });

  app.post("/categories", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const parsed = categoryCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "bad_request" });
    if (parsed.data.lojaId && parsed.data.lojaId !== storeId) return res.status(403).json({ error: "forbidden" });
    try {
      const category = await prisma.categoria.create({ data: { ...parsed.data, lojaId: storeId } });
      res.status(201).json(category);
    } catch {
      res.status(409).json({ error: "conflict" });
    }
  });

  app.patch("/categories/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const parsed = categoryUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "bad_request" });
    const existing = await prisma.categoria.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    try {
      const category = await prisma.categoria.update({ where: { id: existing.id }, data: parsed.data });
      res.json(category);
    } catch {
      res.status(409).json({ error: "conflict" });
    }
  });

  app.patch("/categories/:id/status", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const existing = await prisma.categoria.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    const category = await prisma.categoria.update({ where: { id: existing.id }, data: { ativo: !existing.ativo } });
    res.json(category);
  });

  app.delete("/categories/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const existing = await prisma.categoria.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    const count = await prisma.produto.count({ where: { categoriaId: existing.id } });
    if (count > 0) return res.status(409).json({ error: "conflict" });
    await prisma.categoria.delete({ where: { id: existing.id } });
    res.json({ status: "ok" });
  });

  app.get("/products", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const categoryId = typeof req.query.categoriaId === "string" ? req.query.categoriaId : undefined;
    const ativo = typeof req.query.ativo === "string" ? req.query.ativo === "true" : undefined;
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const products = await prisma.produto.findMany({
      where: {
        lojaId: storeId,
        ...(search ? { OR: [{ nome: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
        ...(categoryId ? { categoriaId: categoryId } : {}),
        ...(ativo === undefined ? {} : { ativo })
      },
      orderBy: [{ nome: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { categoria: true }
    });
    res.json({ items: products });
  });

  app.get("/products/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const product = await prisma.produto.findFirst({ where: { id: req.params.id, lojaId: storeId }, include: { categoria: true } });
    if (!product) return res.status(404).json({ error: "not_found" });
    res.json(product);
  });

  app.post("/products", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const parsed = productCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "bad_request" });
    if (parsed.data.lojaId && parsed.data.lojaId !== storeId) return res.status(403).json({ error: "forbidden" });
    const category = await prisma.categoria.findFirst({ where: { id: parsed.data.categoriaId, lojaId: storeId } });
    if (!category) return res.status(404).json({ error: "not_found" });
    try {
      const product = await prisma.produto.create({ data: { ...parsed.data, lojaId: storeId, precoVenda: parsed.data.precoVenda.toFixed(2), markup: parsed.data.markup.toFixed(2), peso: parsed.data.peso == null ? undefined : parsed.data.peso.toFixed(3) } });
      res.status(201).json(product);
    } catch {
      res.status(409).json({ error: "conflict" });
    }
  });

  app.patch("/products/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const parsed = productUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "bad_request" });
    const existing = await prisma.produto.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (parsed.data.categoriaId) {
      const category = await prisma.categoria.findFirst({ where: { id: parsed.data.categoriaId, lojaId: storeId } });
      if (!category) return res.status(404).json({ error: "not_found" });
    }
    try {
      const product = await prisma.produto.update({
        where: { id: existing.id },
        data: {
          ...parsed.data,
          precoVenda: parsed.data.precoVenda === undefined ? undefined : parsed.data.precoVenda.toFixed(2),
          markup: parsed.data.markup === undefined ? undefined : parsed.data.markup.toFixed(2),
          peso: parsed.data.peso == null ? undefined : parsed.data.peso.toFixed(3)
        }
      });
      res.json(product);
    } catch {
      res.status(409).json({ error: "conflict" });
    }
  });

  app.patch("/products/:id/status", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const existing = await prisma.produto.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    const product = await prisma.produto.update({ where: { id: existing.id }, data: { ativo: !existing.ativo } });
    res.json(product);
  });

  app.delete("/products/:id", async (req, res) => {
    const identity = await authorizeUser(req, res);
    if (!identity) return;
    const storeId = parseStoreId(req);
    if (!storeId || !identity.lojas.some((store) => store.id === storeId)) return res.status(403).json({ error: "forbidden" });
    const existing = await prisma.produto.findFirst({ where: { id: req.params.id, lojaId: storeId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    await prisma.produto.delete({ where: { id: existing.id } });
    res.json({ status: "ok" });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response) => {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.status(400).json({ error: "bad_request" });
  });

  return app;
}
