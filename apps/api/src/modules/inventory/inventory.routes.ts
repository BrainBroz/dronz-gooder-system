import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  hasPermission,
  requireAuth,
  requirePermission,
  requireReadWrite,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import { AppError } from "../../lib/app-error";
import * as s from "./inventory.service";
import * as lots from "./lots.service";
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

// PD-03: diagnóstico e reconciliação de lotes legados; escrita exige ESTOQUE_AJUSTAR e motivo.
const lotKey = (r: AuthenticatedRequest) =>
  z.string().trim().min(1).max(200).parse(r.headers["idempotency-key"]);
const lotReason = z
  .object({ motivo: z.string().trim().min(3).max(500) })
  .strict();
inventoryRouter.get(
  "/lots/:produtoId",
  w((r) => lots.lotDiagnosis(r.storeId!, String(r.params.produtoId)))
);
inventoryRouter.post(
  "/lots/:produtoId/reconcile",
  requirePermission("ESTOQUE_AJUSTAR"),
  w((r) =>
    lots.reconcileLots(
      r.storeId!,
      r.identity!.user.id,
      String(r.params.produtoId),
      lotReason.parse(r.body).motivo,
      lotKey(r)
    )
  )
);
inventoryRouter.post(
  "/lots/entries/:movimentoId/purchase-item",
  requirePermission("ESTOQUE_AJUSTAR"),
  w((r) =>
    lots.linkLotPurchaseItem(
      r.storeId!,
      r.identity!.user.id,
      String(r.params.movimentoId),
      z
        .object({
          pedidoCompraItemId: z.string().min(1),
          motivo: z.string().trim().min(3).max(500)
        })
        .strict()
        .parse(r.body),
      lotKey(r)
    )
  )
);
