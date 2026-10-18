import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  hasPermission,
  requireAuth,
  requirePermission,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as service from "./sales.service";

export const salesRouter = Router();
salesRouter.use(requireAuth, requireStore);
const key = (req: AuthenticatedRequest) =>
  typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"]
    : undefined;
const requiredKey = (req: AuthenticatedRequest) =>
  z.string().trim().min(1).max(200).parse(req.headers["idempotency-key"]);
const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
// Custo, lucro e margem são dados financeiros: só aparecem com FINANCEIRO_VISUALIZAR.
const seesCost = (req: AuthenticatedRequest) =>
  hasPermission(req, "FINANCEIRO_VISUALIZAR");
const view = requirePermission("VENDA_VISUALIZAR");
const amount = z.number().min(0).max(1e15);
const canais = ["MERCADO_LIVRE", "SHOPEE", "SITE_PROPRIO", "OUTRO"] as const;

salesRouter.get(
  "/",
  view,
  run((req) => {
    const q = z
      .object({
        canal: z.enum(canais).optional(),
        estado: z.enum(["RASCUNHO", "CONFIRMADA", "CANCELADA"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional()
      })
      .strict()
      .parse(req.query);
    return service.listSales(req.storeId!, seesCost(req), q);
  })
);
salesRouter.get(
  "/:id",
  view,
  run((req) =>
    service.getSale(req.storeId!, String(req.params.id), seesCost(req))
  )
);
salesRouter.get(
  "/:id/lot-suggestion",
  requirePermission("VENDA_CONFIRMAR"),
  run((req) => service.lotSuggestion(req.storeId!, String(req.params.id)))
);
salesRouter.post(
  "/",
  requirePermission("VENDA_CRIAR"),
  run((req) => {
    const d = z
      .object({
        canal: z.enum(canais),
        referenciaExterna: z.string().trim().min(1).max(120).optional(),
        dataVenda: z.coerce.date(),
        moeda: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .transform((value) => value.toUpperCase()),
        observacao: z.string().trim().max(1000).optional(),
        itens: z
          .array(
            z
              .object({
                produtoId: z.string(),
                quantidade: z.number().int().positive().max(100000),
                precoUnitario: amount,
                desconto: amount.optional(),
                taxaMarketplace: amount.optional(),
                notaFiscal: amount.optional(),
                frete: amount.optional()
              })
              .strict()
          )
          .min(1)
          .max(100)
      })
      .strict()
      .parse(req.body);
    return service.createSale(
      req.storeId!,
      req.identity!.user.id,
      d,
      requiredKey(req)
    );
  }, 201)
);
salesRouter.post(
  "/:id/cancel",
  requirePermission("VENDA_CRIAR"),
  run((req) =>
    service.cancelDraft(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z
        .object({ motivo: z.string().trim().min(3).max(500) })
        .strict()
        .parse(req.body).motivo,
      key(req)
    )
  )
);
salesRouter.post(
  "/:id/confirm",
  requirePermission("VENDA_CONFIRMAR"),
  run((req) =>
    service.confirmSale(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z
        .object({
          lotes: z
            .array(
              z
                .object({
                  vendaItemId: z.string(),
                  movimentoEntradaId: z.string(),
                  quantidade: z.number().int().positive()
                })
                .strict()
            )
            .min(1)
            .max(500),
          recebivelPrevisto: amount.optional(),
          dataPrevista: z.coerce.date().optional()
        })
        .strict()
        .parse(req.body),
      key(req),
      seesCost(req)
    )
  )
);
salesRouter.post(
  "/:id/receipts",
  requirePermission("FINANCEIRO_REGISTRAR"),
  run(
    (req) =>
      service.receive(
        req.storeId!,
        req.identity!.user.id,
        String(req.params.id),
        z
          .object({
            valor: z.number().positive().max(1e15),
            recebidoEm: z.coerce.date(),
            transacaoFonteId: z.string().optional()
          })
          .strict()
          .parse(req.body),
        requiredKey(req)
      ),
    201
  )
);
