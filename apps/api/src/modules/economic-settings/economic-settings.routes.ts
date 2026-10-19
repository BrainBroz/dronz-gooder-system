import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, requireStore, type AuthenticatedRequest } from "../../middlewares/auth";
import * as service from "./economic-settings.service";

export const economicSettingsRouter = Router();
economicSettingsRouter.use(requireAuth, requireStore);

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

/** Decimal recebido como número ou texto; devolvido como texto para não perder precisão. */
export const decimal = (max?: number) =>
  z
    .union([z.number().finite(), z.string().trim().regex(/^\d+(\.\d+)?$/)])
    .transform(String)
    .refine((value) => Number(value) >= 0 && (max === undefined || Number(value) < max), "out_of_range");

const settingsSchema = z
  .object({
    acrescimoCambialBrl: decimal(100),
    frete: z.object({ valorPorKg: decimal(), moeda: z.enum(["USD", "BRL"]) }).strict().nullable(),
    markupAlertaPercentual: decimal(10_000),
    notaFiscalPercentual: decimal(100).nullable(),
    notaFiscalBase: z.enum(["VENDA_BRUTA", "BASE_INFORMADA"]).nullable(),
    iofPercentual: decimal(100).nullable(),
    observacoes: z.string().trim().max(500).nullable(),
    taxasMarketplace: z
      .array(
        z
          .object({
            canal: z.enum(["MERCADO_LIVRE", "SHOPEE", "SITE_PROPRIO", "OUTRO"]),
            modalidade: z.enum(["A_VISTA", "PARCELADO"]),
            parcelas: z.number().int().min(1).max(24).nullable(),
            percentual: decimal(100),
            descricao: z.string().trim().max(200).nullable()
          })
          .strict()
      )
      .max(30)
  })
  .strict();

// Leitura: quem simula também precisa dos parâmetros vigentes. Gravação: capacidade financeira.
economicSettingsRouter.get(
  "/",
  requirePermission("FINANCEIRO_VISUALIZAR", "SIMULACAO_VISUALIZAR"),
  run((req) => service.getSettings(req.storeId!))
);
economicSettingsRouter.post(
  "/",
  requirePermission("FINANCEIRO_REGISTRAR"),
  run((req) => service.saveSettings(req.storeId!, req.identity!.user.id, settingsSchema.parse(req.body), key(req)), 201)
);
economicSettingsRouter.get(
  "/exchange-rate",
  requirePermission("FINANCEIRO_VISUALIZAR", "SIMULACAO_VISUALIZAR"),
  run(async (req) => ({ cotacao: await service.currentQuote(req.storeId!) }))
);
economicSettingsRouter.post(
  "/exchange-rate/ptax",
  requirePermission("FINANCEIRO_REGISTRAR"),
  run(async (req) => {
    const body = z.object({ acrescimoCambialBrl: decimal(100).optional() }).strict().parse(req.body ?? {});
    return service.capturePtax(req.storeId!, req.identity!.user.id, body.acrescimoCambialBrl ?? null, key(req));
  }, 201)
);
