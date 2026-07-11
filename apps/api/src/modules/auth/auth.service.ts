import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../lib/env";
import { AppError } from "../../lib/app-error";

type SessionPayload = { sub: string; tokenType: "access" | "refresh"; jti: string };
const refreshDurationMs = 1000 * 60 * 60 * 24 * 30;

function signAccessToken(userId: string) {
  const payload: SessionPayload = { sub: userId, tokenType: "access", jti: crypto.randomUUID() };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

function signRefreshToken(userId: string) {
  const payload: SessionPayload = { sub: userId, tokenType: "refresh", jti: crypto.randomUUID() };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function getAuthenticatedUser(userId: string) {
  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    include: { lojas: { include: { loja: true } }, perfis: { include: { perfil: { include: { permissoes: { include: { permissao: true } } } } } } }
  });
  if (!user || !user.active) throw new AppError(401, "unauthorized");
  return {
    user: { id: user.id, name: user.name, email: user.email, active: user.active },
    lojas: user.lojas.map((entry) => ({ id: entry.loja.id, slug: entry.loja.slug, nome: entry.loja.nome })),
    perfis: user.perfis.map((entry) => ({ id: entry.perfil.id, code: entry.perfil.code, name: entry.perfil.name })),
    permissoes: user.perfis.flatMap((entry) => entry.perfil.permissoes.map((link) => ({ id: link.permissao.id, code: link.permissao.code, name: link.permissao.name })))
  };
}

async function createSession(userId: string) {
  const identity = await getAuthenticatedUser(userId);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  const expiresAt = new Date(Date.now() + refreshDurationMs);
  await prisma.refreshToken.create({ data: { tokenHash: hashToken(refreshToken), usuarioId: userId, expiresAt } });
  return { accessToken, refreshToken, expiresAt, ...identity };
}

export async function login(email: string, password: string) {
  const user = await prisma.usuario.findUnique({ where: { email } });
  if (!user?.active || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError(401, "invalid_credentials");
  const session = await createSession(user.id);
  await prisma.auditLog.create({ data: { usuarioId: user.id, action: "login", entity: "Usuario", entityId: user.id, data: { email } } });
  return session;
}

export async function refresh(rawToken: string) {
  let decoded: { sub?: string; tokenType?: string };
  try {
    decoded = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as typeof decoded;
  } catch {
    throw new AppError(401, "invalid_refresh_token");
  }
  if (!decoded.sub || decoded.tokenType !== "refresh") throw new AppError(401, "invalid_refresh_token");
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored || stored.usuarioId !== decoded.sub || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) throw new AppError(401, "invalid_refresh_token");
  try {
    await getAuthenticatedUser(decoded.sub);
  } catch {
    throw new AppError(401, "invalid_refresh_token");
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return createSession(decoded.sub);
}

export async function logout(rawToken?: string) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}
