import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../lib/env";
import { getAuthenticatedUser } from "../modules/auth/auth.service";

export type AuthIdentity = Awaited<ReturnType<typeof getAuthenticatedUser>>;
export type AuthenticatedRequest = Request & { identity?: AuthIdentity; storeId?: string };

function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub?: string; tokenType?: string };
  if (!payload.sub || payload.tokenType !== "access") throw new Error("INVALID_ACCESS_TOKEN");
  return payload.sub;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  try {
    req.identity = await getAuthenticatedUser(verifyAccessToken(authorization.slice(7)));
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

const storeHeaderSchema = z.string().min(1);

export function requireStore(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const parsed = storeHeaderSchema.safeParse(req.headers["x-store-id"]);
  if (!parsed.success || !req.identity?.lojas.some((store) => store.id === parsed.data)) {
    return res.status(403).json({ error: "forbidden" });
  }
  req.storeId = parsed.data;
  next();
}
