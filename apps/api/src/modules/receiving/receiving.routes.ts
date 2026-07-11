import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import { AppError } from "../../lib/app-error";
import * as s from "./receiving.service";
export const receivingRouter = Router();
receivingRouter.use(requireAuth, requireStore);
const w =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await fn(r));
    } catch (e) {
      n(e);
    }
  };
receivingRouter.get(
  "/",
  w((r) => s.list(r.storeId!))
);
receivingRouter.post(
  "/",
  w((r) => {
    const p = z
      .object({
        viagemId: z.string(),
        malaId: z.string(),
        observacoes: z.string().optional()
      })
      .strict()
      .safeParse(r.body);
    if (!p.success) throw new AppError(400, "bad_request");
    return s.create(r.storeId!, r.identity!.user.id, p.data);
  })
);
receivingRouter.post(
  "/:id/items/:itemId/confirm",
  w((r) => {
    const p = z
      .object({
        quantidadeRecebida: z.number().int().min(0),
        quantidadeRejeitada: z.number().int().min(0),
        observacoes: z.string().optional()
      })
      .strict()
      .safeParse(r.body);
    if (!p.success) throw new AppError(400, "bad_request");
    return s.confirm(
      r.storeId!,
      r.identity!.user.id,
      String(r.params.id),
      String(r.params.itemId),
      p.data
    );
  })
);
