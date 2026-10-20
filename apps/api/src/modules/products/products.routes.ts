import { Router } from "express";
import {
  requireAuth,
  requireReadWrite,
  requireStore
} from "../../middlewares/auth";
import * as controller from "./products.controller";

export const productsRouter = Router();
productsRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(
    [
      "CATALOGO_VISUALIZAR",
      "MAPPING_PRODUTO_GERENCIAR",
      "COMPRAS_IMPORTADAS_IMPORTAR"
    ],
    ["CATALOGO_GERENCIAR"]
  )
);
productsRouter.get("/", controller.list);
productsRouter.get("/:id", controller.get);
productsRouter.post("/", controller.create);
productsRouter.post("/import", controller.importar);
productsRouter.patch("/:id", controller.update);
productsRouter.patch("/:id/status", controller.toggle);
productsRouter.delete("/:id", controller.remove);
