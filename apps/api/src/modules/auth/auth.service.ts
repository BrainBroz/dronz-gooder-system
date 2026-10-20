import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../lib/env";
import { AppError } from "../../lib/app-error";

type SessionPayload = { sub: string; tokenType: "access" | "refresh"; jti: string };
const refreshDurationMs = 1000 * 60 * 60 * 24 * 30;
// Token substituído há menos que isso por outra renovação: corrida entre abas, não reuso.
export const CONCURRENT_REFRESH_WINDOW_MS = 10_000;

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

async function createSession(userId: string, db: Prisma.TransactionClient = prisma) {
  const identity = await getAuthenticatedUser(userId);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  const expiresAt = new Date(Date.now() + refreshDurationMs);
  const stored = await db.refreshToken.create({ data: { tokenHash: hashToken(refreshToken), usuarioId: userId, expiresAt } });
  return { accessToken, refreshToken, expiresAt, refreshTokenId: stored.id, ...identity };
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
  const userId = decoded.sub;
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored || stored.usuarioId !== userId || stored.expiresAt.getTime() < Date.now()) throw new AppError(401, "invalid_refresh_token");
  if (stored.revokedAt) throw await rejectConsumed(stored);
  try {
    await getAuthenticatedUser(userId);
  } catch {
    throw new AppError(401, "invalid_refresh_token");
  }
  // Consumo atômico: só quem revoga o token cria a sessão sucessora, na mesma transação.
  const session = await prisma.$transaction(async (tx) => {
    const consumed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() }
    });
    if (consumed.count !== 1) return null;
    const created = await createSession(userId, tx);
    await tx.refreshToken.update({ where: { id: stored.id }, data: { replacedById: created.refreshTokenId } });
    return created;
  });
  if (!session) throw await rejectConsumed(await prisma.refreshToken.findUniqueOrThrow({ where: { id: stored.id } }));
  return session;
}

/**
 * Token já consumido. Rotacionado há pouco por outra renovação (duas abas): 409, sem sessão nova; o cliente
 * repete com o cookie que já recebeu. Fora da janela ou revogado por logout: reuso, 401 e auditoria.
 */
async function rejectConsumed(token: { id: string; usuarioId: string; revokedAt: Date | null; replacedById: string | null }) {
  const recentRotation =
    token.replacedById !== null && token.revokedAt !== null && Date.now() - token.revokedAt.getTime() < CONCURRENT_REFRESH_WINDOW_MS;
  if (recentRotation) return new AppError(409, "refresh_concorrente");
  if (token.replacedById !== null)
    await prisma.auditLog.create({
      data: { usuarioId: token.usuarioId, action: "refresh_token_reuse", entity: "RefreshToken", entityId: token.id }
    });
  return new AppError(401, "invalid_refresh_token");
}

export async function logout(rawToken?: string) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}
