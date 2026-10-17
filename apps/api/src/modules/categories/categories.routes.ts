import { Router } from "express";
import {
  requireAuth,
  requireReadWrite,
  requireStore
} from "../../middlewares/auth";
import * as controller from "./categories.controller";

export const categoriesRouter = Router();
categoriesRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(["CATALOGO_VISUALIZAR"], ["CATALOGO_GERENCIAR"])
);
categoriesRouter.get("/", controller.list);
categoriesRouter.get("/:id", controller.get);
categoriesRouter.post("/", controller.create);
categoriesRouter.patch("/:id", controller.update);
categoriesRouter.patch("/:id/status", controller.toggle);
categoriesRouter.delete("/:id", controller.remove);
