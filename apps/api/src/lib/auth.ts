import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "./env";
import { prisma } from "./prisma";

export type SessionPayload = {
  sub: string;
  tokenType: "access" | "refresh";
  jti: string;
};

export function signAccessToken(userId: string) {
  const payload: SessionPayload = { sub: userId, tokenType: "access", jti: crypto.randomUUID() };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function signRefreshToken(userId: string, tokenId: string) {
  const payload: SessionPayload = { sub: userId, tokenType: "refresh", jti: tokenId };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function persistRefreshToken(userId: string, refreshToken: string) {
  const tokenHash = await hashToken(refreshToken);
  return prisma.refreshToken.create({
    data: {
      tokenHash,
      usuarioId: userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });
}

export async function getAuthenticatedUser(userId: string) {
  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    include: {
      lojas: { include: { loja: true } },
      perfis: { include: { perfil: { include: { permissoes: { include: { permissao: true } } } } } }
    }
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active
    },
    lojas: user.lojas.map((entry) => ({ id: entry.loja.id, slug: entry.loja.slug, nome: entry.loja.nome })),
    perfis: user.perfis.map((entry) => ({ id: entry.perfil.id, code: entry.perfil.code, name: entry.perfil.name })),
    permissoes: user.perfis.flatMap((entry) =>
      entry.perfil.permissoes.map((link) => ({ id: link.permissao.id, code: link.permissao.code, name: link.permissao.name }))
    )
  };
}

export async function createSession(userId: string) {
  const identity = await getAuthenticatedUser(userId);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, crypto.randomUUID());
  await persistRefreshToken(userId, refreshToken);

  return {
    accessToken,
    refreshToken,
    ...identity
  };
}
