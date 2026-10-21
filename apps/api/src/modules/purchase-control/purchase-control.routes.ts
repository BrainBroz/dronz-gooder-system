import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requirePermission, requireStore, type AuthenticatedRequest } from "../../middlewares/auth";
import * as service from "./purchase-control.service";

export const purchaseControlRouter = Router();
purchaseControlRouter.use(requireAuth, requireStore);

const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
const bad = (res: Response) => res.status(400).json({ error: "bad_request" });

// Leitura: quem vê compras importadas. Gravação: as projeções são estimativas, mesma capacidade de gerenciar simulações.
purchaseControlRouter.get("/", requirePermission("COMPRAS_IMPORTADAS_VISUALIZAR"), (request, res, next) => {
  const req = request as AuthenticatedRequest;
  const query = service.monthSchema.safeParse(req.query);
  if (!query.success) return bad(res);
  return run(() => service.control(req.storeId!, query.data))(req, res, next);
});
purchaseControlRouter.put("/items/:itemId", requirePermission("SIMULACAO_GERENCIAR"), (request, res, next) => {
  const req = request as AuthenticatedRequest;
  const body = service.projectionSchema.safeParse(req.body);
  if (!body.success) return bad(res);
  return run(() => service.saveProjection(req.storeId!, req.identity!.user.id, String(req.params.itemId), body.data))(req, res, next);
});
