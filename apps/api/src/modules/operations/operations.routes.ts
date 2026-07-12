import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, requireStore, type AuthenticatedRequest } from "../../middlewares/auth";
import { AppError } from "../../lib/app-error";
import * as service from "./operations.service";
import { correct } from "./corrections.service";

export const operationsRouter = Router();
operationsRouter.use(requireAuth, requireStore);

const wrap = (fn: (request: AuthenticatedRequest) => Promise<unknown>) =>
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    try { response.json(await fn(request)); } catch (error) { next(error); }
  };
const permissions = (request: AuthenticatedRequest) => request.identity!.permissoes.map((entry) => entry.code);

operationsRouter.get("/overview", requirePermission(
  "MIAMI_RECEBIMENTO_VISUALIZAR", "PARAGUAI_CHECKPOINT_VISUALIZAR", "BRASIL_CHECKPOINT_VISUALIZAR", "RECEBIMENTO_VISUALIZAR", "ENTRADA_DEFINITIVA_VISUALIZAR"
), wrap((request) => service.overview(request.storeId!, permissions(request))));

operationsRouter.get("/miami/candidates", requirePermission("MIAMI_RECEBIMENTO_VISUALIZAR"), wrap((request) =>
  service.miamiCandidates(request.storeId!, permissions(request))));
operationsRouter.get("/miami/items/:id", requirePermission("MIAMI_RECEBIMENTO_VISUALIZAR"), wrap((request) =>
  service.miamiDetail(request.storeId!, String(request.params.id), permissions(request))));

operationsRouter.get("/paraguay/candidates", requirePermission("PARAGUAI_CHECKPOINT_VISUALIZAR"), wrap((request) =>
  service.paraguayCandidates(request.storeId!, permissions(request))));
operationsRouter.get("/paraguay/:id", requirePermission("PARAGUAI_CHECKPOINT_VISUALIZAR"), wrap(async (request) => {
  const result = (await service.paraguayCandidates(request.storeId!, permissions(request))).find((entry) => entry.id === String(request.params.id));
  if (!result) throw new AppError(404, "not_found");
  return { ...result, history: await service.operationalHistory(request.storeId!, "CheckpointParaguai", result.checkpoint?.id) };
}));

operationsRouter.get("/brazil/candidates", requirePermission("BRASIL_CHECKPOINT_VISUALIZAR"), wrap((request) =>
  service.brazilCandidates(request.storeId!, permissions(request))));
operationsRouter.get("/brazil/:id", requirePermission("BRASIL_CHECKPOINT_VISUALIZAR"), wrap(async (request) => {
  const result = (await service.brazilCandidates(request.storeId!, permissions(request))).find((entry) => entry.id === String(request.params.id));
  if (!result) throw new AppError(404, "not_found");
  return { ...result, history: await service.operationalHistory(request.storeId!, "CheckpointBrasil", result.checkpoint?.id) };
}));

operationsRouter.get("/receiving/candidates", requirePermission("RECEBIMENTO_VISUALIZAR"), wrap((request) =>
  service.receivingCandidates(request.storeId!, permissions(request))));
operationsRouter.get("/definitive-entry/candidates", requirePermission("ENTRADA_DEFINITIVA_VISUALIZAR"), wrap((request) =>
  service.definitiveEntryCandidates(request.storeId!, permissions(request))));

operationsRouter.get("/history", requirePermission(
  "MIAMI_RECEBIMENTO_VISUALIZAR", "PARAGUAI_CHECKPOINT_VISUALIZAR", "BRASIL_CHECKPOINT_VISUALIZAR", "RECEBIMENTO_VISUALIZAR", "ENTRADA_DEFINITIVA_VISUALIZAR"
), wrap((request) => {
  const parsed = z.object({ entity: z.enum(["PedidoCompraItem", "CheckpointParaguai", "CheckpointBrasil", "Recebimento", "RecebimentoItem", "EstoqueEntrada"]).optional(), entityId: z.string().optional(), cursor: z.string().optional(), take: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(request.query);
  if (!parsed.success) throw new AppError(400, "bad_request");
  return service.operationalHistory(request.storeId!, parsed.data.entity, parsed.data.entityId, parsed.data.cursor, parsed.data.take);
}));

operationsRouter.post("/corrections", requirePermission("CHECKPOINT_CORRIGIR"), wrap((request) => {
  const parsed = z.object({
    entity: z.enum(["CheckpointParaguai", "CheckpointBrasil", "RecebimentoMiami", "RecebimentoItem"]),
    originalEventId: z.string().min(1), correctionType: z.string().min(1), reason: z.string().min(3),
    after: z.record(z.string(), z.unknown()),
    adjustments: z.array(z.object({ productId: z.string(), quantityDelta: z.number().int().refine((value) => value !== 0), originalMovementId: z.string() }).strict()).optional()
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError(400, "bad_request");
  return correct(request.storeId!, request.identity!.user.id, parsed.data, typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined);
}));
