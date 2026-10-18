import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireReadWrite,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as service from "./finance.service";

export const financeRouter = Router();
financeRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(["FINANCEIRO_VISUALIZAR"], ["FINANCEIRO_REGISTRAR"])
);
const key = (req: AuthenticatedRequest) =>
  typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"]
    : undefined;
const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
financeRouter.get(
  "/payments",
  run((req) => service.listPayments(req.storeId!))
);
financeRouter.post(
  "/exchange-rates",
  run((req) => {
    const d = z
      .object({
        moedaOrigem: z.string().length(3),
        moedaDestino: z.string().length(3),
        valorMercado: z.number().positive(),
        margem: z.number().min(0),
        fonte: z.string().trim().min(1).max(200),
        cotadoEm: z.coerce.date()
      })
      .strict()
      .parse(req.body);
    return service.createExchange(
      req.storeId!,
      req.identity!.user.id,
      d,
      key(req)
    );
  }, 201)
);
financeRouter.post(
  "/payments",
  run((req) => {
    const d = z
      .object({
        pedidoCompraId: z.string(),
        formaPagamento: z.enum([
          "CREDIT_CARD",
          "PAYPAL",
          "BANK_TRANSFER",
          "CASH",
          "OTHER"
        ]),
        moeda: z.string().length(3),
        valor: z.number().positive(),
        pagoEm: z.coerce.date().optional(),
        referencia: z.string().optional(),
        observacoes: z.string().optional()
      })
      .strict()
      .parse(req.body);
    return service.pay(
      req.storeId!,
      req.identity!.user.id,
      d.pedidoCompraId,
      d,
      key(req)
    );
  }, 201)
);
financeRouter.post(
  "/payments/:id/refund",
  run(
    (req) =>
      service.refund(
        req.storeId!,
        req.identity!.user.id,
        String(req.params.id),
        z.object({ valor: z.number().positive() }).strict().parse(req.body)
          .valor,
        key(req)
      ),
    201
  )
);
financeRouter.put(
  "/orders/:id/costs",
  run((req) =>
    service.setCosts(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z
        .object({
          cotacaoCambioId: z.string().optional(),
          iofPercentual: z.number().min(0),
          taxas: z.number().min(0),
          custoAdicional: z.number().min(0)
        })
        .strict()
        .parse(req.body),
      key(req)
    )
  )
);
