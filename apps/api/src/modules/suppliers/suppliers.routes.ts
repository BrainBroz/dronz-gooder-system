import { Router } from "express";
import {
  requireAuth,
  requireReadWrite,
  requireStore
} from "../../middlewares/auth";
import * as c from "./suppliers.controller";
export const suppliersRouter = Router();
suppliersRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(
    [
      "CATALOGO_VISUALIZAR",
      "MAPPING_FORNECEDOR_GERENCIAR",
      "PEDIDOS_COMPRA_VISUALIZAR",
      "COMPRAS_IMPORTADAS_IMPORTAR"
    ],
    ["CATALOGO_GERENCIAR"]
  )
);
suppliersRouter.get("/", c.list);
suppliersRouter.get("/:id", c.get);
suppliersRouter.post("/", c.create);
suppliersRouter.patch("/:id", c.update);
suppliersRouter.patch("/:id/status", c.toggle);
suppliersRouter.delete("/:id", c.remove);
