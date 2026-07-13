import { Router, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as service from "./unified-purchases.service";
import {
  accountSchema,
  assignmentSchema,
  importPurchaseSchema,
  listSchema,
  manualPurchaseSchema,
  materializationSchema,
  merchantSchema,
  productMappingSchema,
  resolveConflictSchema,
  supplierMappingSchema
} from "./unified-purchases.schemas";

export const unifiedPurchasesRouter = Router();
unifiedPurchasesRouter.use(requireAuth);

const wrap =
  (
    handler: (
      request: AuthenticatedRequest,
      response: Response
    ) => Promise<void>
  ) =>
  async (
    request: AuthenticatedRequest,
    response: Response,
    next: (error?: unknown) => void
  ) => {
    try {
      await handler(request, response);
    } catch (error) {
      next(error);
    }
  };
const identity = (request: AuthenticatedRequest) => {
  if (!request.identity) throw new Error("authenticated identity unavailable");
  return request.identity;
};
const key = (request: AuthenticatedRequest) => {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.length <= 200 ? value : undefined;
};

unifiedPurchasesRouter.post(
  "/accounts",
  requirePermission("CONTA_EXTERNA_GERENCIAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.createExternalAccount(
          identity(request),
          accountSchema.parse(request.body),
          key(request)
        )
      );
  })
);
unifiedPurchasesRouter.post(
  "/conflicts/:conflictId/resolve",
  requirePermission("COMPRAS_IMPORTADAS_REVISAR"),
  wrap(async (request, response) => {
    const body = resolveConflictSchema.parse(request.body);
    response.json(
      await service.resolveConflict(
        identity(request),
        z.string().cuid().parse(request.params.conflictId),
        body.motivo,
        key(request)
      )
    );
  })
);
unifiedPurchasesRouter.post(
  "/merchants",
  requirePermission("MAPPING_FORNECEDOR_GERENCIAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.upsertMerchant(
          identity(request),
          merchantSchema.parse(request.body),
          key(request)
        )
      );
  })
);
unifiedPurchasesRouter.post(
  "/manual",
  requirePermission("COMPRAS_IMPORTADAS_IMPORTAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.createManualPurchase(
          identity(request),
          manualPurchaseSchema.parse(request.body),
          z.string().min(8).max(200).parse(key(request))
        )
      );
  })
);
unifiedPurchasesRouter.post(
  "/",
  requirePermission("COMPRAS_IMPORTADAS_IMPORTAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.importPurchase(
          identity(request),
          importPurchaseSchema.parse(request.body),
          key(request)
        )
      );
  })
);
unifiedPurchasesRouter.get(
  "/overview",
  requirePermission("COMPRAS_IMPORTADAS_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.overview(identity(request)));
  })
);
unifiedPurchasesRouter.get(
  "/",
  requirePermission("COMPRAS_IMPORTADAS_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(
      await service.listPurchases(
        identity(request),
        listSchema.parse(request.query)
      )
    );
  })
);
unifiedPurchasesRouter.get(
  "/:id/history",
  requirePermission("COMPRAS_IMPORTADAS_VISUALIZAR"),
  wrap(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    response.json(
      await service.historyForPurchase(
        z.string().cuid().parse(request.params.id),
        query.page,
        query.limit
      )
    );
  })
);
unifiedPurchasesRouter.get(
  "/:id",
  requirePermission("COMPRAS_IMPORTADAS_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(
      await service.purchaseDetail(
        identity(request),
        z.string().cuid().parse(request.params.id)
      )
    );
  })
);
unifiedPurchasesRouter.put(
  "/items/:itemId/assignments/:lojaId",
  requirePermission("COMPRAS_IMPORTADAS_ATRIBUIR"),
  wrap(async (request, response) => {
    response.json(
      await service.setAssignment(
        identity(request),
        z.string().cuid().parse(request.params.itemId),
        z.string().cuid().parse(request.params.lojaId),
        assignmentSchema.parse(request.body),
        key(request)
      )
    );
  })
);
unifiedPurchasesRouter.delete(
  "/items/:itemId/assignments/:lojaId",
  requirePermission("COMPRAS_IMPORTADAS_ATRIBUIR"),
  wrap(async (request, response) => {
    const body = z
      .object({ motivo: z.string().trim().min(3).max(500) })
      .strict()
      .parse(request.body);
    response.json(
      await service.removeAssignment(
        identity(request),
        z.string().cuid().parse(request.params.itemId),
        z.string().cuid().parse(request.params.lojaId),
        body.motivo,
        key(request)
      )
    );
  })
);
unifiedPurchasesRouter.put(
  "/items/:itemId/product-mappings/:lojaId",
  requirePermission("MAPPING_PRODUTO_GERENCIAR"),
  wrap(async (request, response) => {
    response.json(
      await service.setProductMapping(
        identity(request),
        z.string().cuid().parse(request.params.itemId),
        z.string().cuid().parse(request.params.lojaId),
        productMappingSchema.parse(request.body),
        key(request)
      )
    );
  })
);
unifiedPurchasesRouter.put(
  "/merchants/:merchantId/supplier-mappings/:lojaId",
  requirePermission("MAPPING_FORNECEDOR_GERENCIAR"),
  wrap(async (request, response) => {
    response.json(
      await service.setSupplierMapping(
        identity(request),
        z.string().cuid().parse(request.params.merchantId),
        z.string().cuid().parse(request.params.lojaId),
        supplierMappingSchema.parse(request.body),
        key(request)
      )
    );
  })
);
unifiedPurchasesRouter.post(
  "/:id/materializations/:lojaId",
  requirePermission("COMPRAS_IMPORTADAS_MATERIALIZAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.materialize(
          identity(request),
          z.string().cuid().parse(request.params.id),
          z.string().cuid().parse(request.params.lojaId),
          materializationSchema.parse(request.body),
          key(request)
        )
      );
  })
);
