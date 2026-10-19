import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, requireStore, type AuthenticatedRequest } from "../../middlewares/auth";
import { decimal } from "../economic-settings/economic-settings.routes";
import * as service from "./purchase-simulation.service";

export const purchaseSimulationRouter = Router();
purchaseSimulationRouter.use(requireAuth, requireStore);

const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
const key = (req: AuthenticatedRequest) =>
  typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;

const moeda = z.enum(["USD", "BRL"]);
const inputSchema = z
  .object({
    nome: z.string().trim().max(120).nullable().default(null),
    produtoId: z.string().min(1).nullable(),
    produtoNome: z.string().trim().max(200).nullable().default(null),
    quantidade: z.number().int().min(1).max(100_000),
    compra: z.object({ precoUnitario: decimal().nullable(), moeda }).strict(),
    pesoUnitarioKg: decimal().nullable(),
    cambio: z.discriminatedUnion("origem", [
      z.object({ origem: z.literal("COTACAO_REGISTRADA"), cotacaoCambioId: z.string().min(1) }).strict(),
      z
        .object({
          origem: z.literal("INFORMADA"),
          referencia: decimal(1000).refine((value) => Number(value) > 0, "positive"),
          acrescimo: decimal(100),
          fonte: z.string().trim().max(200).nullable().default(null)
        })
        .strict(),
      z.object({ origem: z.literal("SEM_COTACAO") }).strict()
    ]),
    frete: z.object({ valorPorKg: decimal(), moeda }).strict().nullable(),
    encargosCompra: z
      .array(
        z
          .object({
            descricao: z.string().trim().min(1).max(120),
            tipo: z.enum(["PERCENTUAL_COMPRA", "VALOR_UNIDADE", "VALOR_TOTAL"]),
            valor: decimal(),
            moeda: moeda.optional()
          })
          .strict()
      )
      .max(20)
      .default([]),
    venda: z
      .object({
        precoUnitarioBrl: decimal().nullable(),
        marketplace: z
          .object({
            canal: z.enum(["MERCADO_LIVRE", "SHOPEE", "SITE_PROPRIO", "OUTRO"]),
            modalidade: z.enum(["A_VISTA", "PARCELADO"]),
            parcelas: z.number().int().min(1).max(24).nullable(),
            percentual: decimal(100)
          })
          .strict()
          .refine((value) => (value.modalidade === "A_VISTA" ? value.parcelas === null : value.parcelas !== null), "parcelas")
          .nullable(),
        notaFiscal: z.discriminatedUnion("modo", [
          z.object({ modo: z.literal("PERCENTUAL_VENDA_BRUTA"), percentual: decimal(100) }).strict(),
          z.object({ modo: z.literal("PERCENTUAL_BASE_INFORMADA"), percentual: decimal(100), baseUnitariaBrl: decimal() }).strict(),
          z.object({ modo: z.literal("VALOR_INFORMADO"), valorUnitarioBrl: decimal() }).strict(),
          z.object({ modo: z.literal("BASE_PENDENTE"), percentual: decimal(100).optional() }).strict()
        ]),
        outrosEncargos: z
          .array(
            z
              .object({
                descricao: z.string().trim().min(1).max(120),
                tipo: z.enum(["PERCENTUAL_VENDA_BRUTA", "VALOR_UNIDADE", "VALOR_TOTAL"]),
                valor: decimal()
              })
              .strict()
          )
          .max(20)
          .default([])
      })
      .strict(),
    markupAlertaPercentual: decimal(10_000),
    parametroEconomicoId: z.string().min(1).nullable().default(null)
  })
  .strict()
  // Percentual de encargo de compra é sempre sobre a compra; valor precisa declarar a moeda.
  .refine((value) => value.encargosCompra.every((encargo) => encargo.tipo === "PERCENTUAL_COMPRA" || encargo.moeda), "moeda_encargo");

purchaseSimulationRouter.post(
  "/calculate",
  requirePermission("SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR"),
  run((req) => service.calculate(req.storeId!, inputSchema.parse(req.body)))
);
purchaseSimulationRouter.post(
  "/",
  requirePermission("SIMULACAO_GERENCIAR"),
  run((req) => service.save(req.storeId!, req.identity!.user.id, inputSchema.parse(req.body), key(req)), 201)
);
purchaseSimulationRouter.get(
  "/",
  requirePermission("SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR"),
  run((req) => service.list(req.storeId!))
);
purchaseSimulationRouter.get(
  "/:id",
  requirePermission("SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR"),
  run((req) => service.get(req.storeId!, String(req.params.id)))
);
