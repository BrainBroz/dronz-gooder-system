import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
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
  requirePermission("RECEBIMENTO_VISUALIZAR"),
  w((r) => s.list(r.storeId!))
);
receivingRouter.post(
  "/",
  requirePermission("RECEBIMENTO_CONFIRMAR"),
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
    return s.create(r.storeId!, r.identity!.user.id, p.data, typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined);
  })
);
receivingRouter.post(
  "/:id/items/:itemId/confirm",
  requirePermission("RECEBIMENTO_CONFIRMAR"),
  w((r) => {
    const p = z
      .object({
        quantidadeRecebida: z.number().int().min(0),
        quantidadeRejeitada: z.number().int().min(0),
        observacoes: z.string().optional(),
        tipoDivergencia: z.enum(["CORRETO", "FALTA", "EXCESSO", "AVARIA", "ITEM_INCORRETO", "OUTRO"]).default("CORRETO")
      })
      .strict()
      .safeParse(r.body);
    if (!p.success) throw new AppError(400, "bad_request");
    return s.confirm(
      r.storeId!,
      r.identity!.user.id,
      String(r.params.id),
      String(r.params.itemId),
      p.data,
      typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined
    );
  })
);
receivingRouter.post(
  "/entrada-definitiva",
  requirePermission("ENTRADA_DEFINITIVA_CONFIRMAR"),
  w((r) => {
    const p = z
      .object({
        viagemId: z.string(),
        malaId: z.string(),
        confirmadoEm: z.coerce.date(),
        observacao: z.string().optional()
      })
      .strict()
      .safeParse(r.body);
    if (!p.success) throw new AppError(400, "bad_request");
    return s.entradaDefinitiva(r.storeId!, r.identity!.user.id, p.data, typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined);
  })
);
