import { Router } from "express";
import { requireAuth, requireStore } from "../../middlewares/auth";
import * as c from "./purchase-orders.controller";
import * as tc from "./triagem.controller";

export const purchaseOrdersRouter = Router();

purchaseOrdersRouter.use(requireAuth, requireStore);

purchaseOrdersRouter.get("/", c.list);
purchaseOrdersRouter.get("/search/numero", c.searchByNumero);
purchaseOrdersRouter.get("/:id", c.get);
purchaseOrdersRouter.post("/", c.create);
purchaseOrdersRouter.patch("/:id", c.update);
purchaseOrdersRouter.patch("/:id/status", c.status);
purchaseOrdersRouter.delete("/:id", c.remove);
purchaseOrdersRouter.post("/:id/items", c.addItem);
purchaseOrdersRouter.patch("/:id/items/:itemId", c.updateItem);
purchaseOrdersRouter.delete("/:id/items/:itemId", c.removeItem);
purchaseOrdersRouter.post("/:id/items/:itemId/atribuir", tc.atribuirItem);
purchaseOrdersRouter.get("/:id/atribuicoes", tc.listarAtribuicoes);
