import { Router } from "express";
import {
  requireAuth,
  requirePermission,
  requireReadWrite,
  requireStore
} from "../../middlewares/auth";
import * as c from "./purchase-orders.controller";
import * as tc from "./triagem.controller";

export const purchaseOrdersRouter = Router();

purchaseOrdersRouter.use(requireAuth, requireStore);

// Check-in Miami localiza o pedido por número; sem PEDIDOS_COMPRA_VISUALIZAR a resposta omite valores.
purchaseOrdersRouter.get(
  "/search/numero",
  requirePermission("PEDIDOS_COMPRA_VISUALIZAR", "MIAMI_RECEBIMENTO_CONFIRMAR"),
  c.searchByNumero
);
purchaseOrdersRouter.use(
  requireReadWrite(["PEDIDOS_COMPRA_VISUALIZAR"], ["PEDIDOS_COMPRA_GERENCIAR"])
);
purchaseOrdersRouter.get("/", c.list);
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
