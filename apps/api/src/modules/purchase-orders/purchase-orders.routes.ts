import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  requireReadWrite,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as tracking from "./tracking.service";
import * as c from "./purchase-orders.controller";
import * as tc from "./triagem.controller";

export const purchaseOrdersRouter = Router();

purchaseOrdersRouter.use(requireAuth, requireStore);

// Leitura de etiqueta no recebimento: localiza o pedido da loja ativa pelo tracking, sem valores.
purchaseOrdersRouter.get(
  "/tracking/lookup",
  requirePermission("PEDIDOS_COMPRA_VISUALIZAR", "MIAMI_RECEBIMENTO_CONFIRMAR"),
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(
        await tracking.lookupTracking(r.storeId!, String(r.query.codigo ?? ""))
      );
    } catch (e) {
      n(e);
    }
  }
);
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
purchaseOrdersRouter.put("/:id/destination", c.destination);
purchaseOrdersRouter.get(
  "/:id/trackings",
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await tracking.listTrackings(r.storeId!, String(r.params.id)));
    } catch (e) {
      n(e);
    }
  }
);
purchaseOrdersRouter.post(
  "/:id/trackings",
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      const d = z
        .object({
          codigo: z.string().trim().min(4).max(120),
          transportadora: z.string().trim().min(1).max(80).optional(),
          substituiTrackingId: z.string().optional()
        })
        .strict()
        .parse(r.body);
      x.status(201).json(
        await tracking.addManualTracking(
          r.storeId!,
          r.identity!.user.id,
          String(r.params.id),
          d
        )
      );
    } catch (e) {
      n(e);
    }
  }
);
purchaseOrdersRouter.delete("/:id", c.remove);
purchaseOrdersRouter.post("/:id/items", c.addItem);
purchaseOrdersRouter.patch("/:id/items/:itemId", c.updateItem);
purchaseOrdersRouter.delete("/:id/items/:itemId", c.removeItem);
purchaseOrdersRouter.post("/:id/items/:itemId/atribuir", tc.atribuirItem);
purchaseOrdersRouter.get("/:id/atribuicoes", tc.listarAtribuicoes);
