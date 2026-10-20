import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireReadWrite, type AuthenticatedRequest } from "../../middlewares/auth";
import * as service from "./product-bases.service";

// Cadastro geral sem loja: por isso não há requireStore; o acesso segue as permissões do catálogo.
export const productBasesRouter = Router();
productBasesRouter.use(requireAuth, requireReadWrite(["CATALOGO_VISUALIZAR"], ["CATALOGO_GERENCIAR"]));

const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
const bad = (res: Response) => res.status(400).json({ error: "bad_request" });

productBasesRouter.get("/", (req, res, next) => {
  const query = service.querySchema.safeParse(req.query);
  if (!query.success) return bad(res);
  return run(() => service.list(query.data))(req, res, next);
});
productBasesRouter.post("/import", (req, res, next) => {
  const body = service.importSchema.safeParse(req.body);
  if (!body.success) return bad(res);
  return run(() => service.importar(body.data, req.query.dryRun === "true"))(req, res, next);
});
productBasesRouter.patch("/:id", (req, res, next) => {
  const body = service.updateSchema.safeParse(req.body);
  if (!body.success) return bad(res);
  return run(() => service.update(String(req.params.id), body.data))(req, res, next);
});
