import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import { AppError } from "../../lib/app-error";
import { authCookie, clearAuthCookie, readRefreshCookie } from "./auth.cookies";
import { loginSchema } from "./auth.schemas";
import * as authService from "./auth.service";

export async function login(req: Request, res: Response, next: NextFunction) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request" });
  try {
    const session = await authService.login(parsed.data.email, parsed.data.password);
    res.setHeader("Set-Cookie", authCookie(session.refreshToken, session.expiresAt));
    res.json({ accessToken: session.accessToken, user: session.user, stores: session.lojas, profiles: session.perfis, permissions: session.permissoes });
  } catch (error) { next(error); }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  const token = readRefreshCookie(req.headers.cookie);
  if (!token) { res.setHeader("Set-Cookie", clearAuthCookie()); return res.status(401).json({ error: "invalid_refresh_token" }); }
  try {
    const session = await authService.refresh(token);
    res.setHeader("Set-Cookie", authCookie(session.refreshToken, session.expiresAt));
    res.json({ accessToken: session.accessToken });
  } catch (error) {
    res.setHeader("Set-Cookie", clearAuthCookie());
    next(error instanceof AppError ? error : new AppError(401, "invalid_refresh_token"));
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try { await authService.logout(readRefreshCookie(req.headers.cookie)); res.setHeader("Set-Cookie", clearAuthCookie()); res.json({ status: "ok" }); }
  catch (error) { next(error); }
}

export function me(req: AuthenticatedRequest, res: Response) { res.json(req.identity); }
