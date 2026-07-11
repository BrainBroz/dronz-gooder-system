import { Router } from "express";
import { requireAuth, requireStore } from "../../middlewares/auth";
import * as controller from "./products.controller";

export const productsRouter = Router();
productsRouter.use(requireAuth, requireStore);
productsRouter.get("/", controller.list);
productsRouter.get("/:id", controller.get);
productsRouter.post("/", controller.create);
productsRouter.patch("/:id", controller.update);
productsRouter.patch("/:id/status", controller.toggle);
productsRouter.delete("/:id", controller.remove);
