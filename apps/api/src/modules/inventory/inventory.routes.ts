import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  hasPermission,
  requireAuth,
  requireReadWrite,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import { AppError } from "../../lib/app-error";
import * as s from "./inventory.service";
export const inventoryRouter = Router();
inventoryRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(
    ["ESTOQUE_VISUALIZAR"],
    ["ESTOQUE_MOVIMENTAR", "ESTOQUE_AJUSTAR"]
  )
);
const w =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await fn(r));
    } catch (e) {
      n(e);
    }
  };
inventoryRouter.get(
  "/",
  w((r) => s.list(r.storeId!))
);
inventoryRouter.get(
  "/movements",
  w((r) => s.movements(r.storeId!))
);
inventoryRouter.post(
  "/movements",
  w((r) => {
    const p = z
      .object({
        produtoId: z.string(),
        tipo: z.enum([
          "RESERVE",
          "RELEASE_RESERVATION",
          "EXIT",
          "ADJUSTMENT_POSITIVE",
          "ADJUSTMENT_NEGATIVE",
          "RETURN_ENTRY",
          "RETURN_EXIT"
        ]),
        motivo: z.enum([
          "SALE",
          "MANUAL_CORRECTION",
          "DAMAGE",
          "LOSS",
          "RETURN",
          "RESERVATION",
          "RESERVATION_RELEASE"
        ]),
        quantidade: z.number().int().positive(),
        observacoes: z.string().optional()
      })
      .strict()
      .safeParse(r.body);
    if (!p.success) throw new AppError(400, "bad_request");
    const required = s.ADJUSTMENT_TYPES.includes(p.data.tipo)
      ? "ESTOQUE_AJUSTAR"
      : "ESTOQUE_MOVIMENTAR";
    if (!hasPermission(r, required))
      throw new AppError(403, "insufficient_permission");
    return s.move(
      r.storeId!,
      r.identity!.user.id,
      p.data,
      typeof r.headers["idempotency-key"] === "string"
        ? r.headers["idempotency-key"]
        : undefined
    );
  })
);
