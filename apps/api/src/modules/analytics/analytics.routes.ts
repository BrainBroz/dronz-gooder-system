import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { zonedDayStart } from "../../lib/calendar";
import {
  hasPermission,
  requireAuth,
  requirePermission,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as s from "./analytics.service";
import { indicators, indicatorsCsv } from "./indicators.service";
export const analyticsRouter = Router();
analyticsRouter.use(
  requireAuth,
  requireStore,
  requirePermission("ANALYTICS_VISUALIZAR")
);
const run =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await fn(r));
    } catch (e) {
      n(e);
    }
  };
// Analytics preserva o acesso financeiro: valores, preços e custos exigem FINANCEIRO_VISUALIZAR.
const financial = (r: AuthenticatedRequest) =>
  hasPermission(r, "FINANCEIRO_VISUALIZAR");
const FINANCIAL_REPORTS = new Set([
  "purchase-orders",
  "purchase-items",
  "costs",
  "payments",
  "markup"
]);
const indicatorDate = z.union([
  z
    .string()
    .date()
    .transform((value) => {
      const [year, month, day] = value.split("-").map(Number);
      return zonedDayStart(year!, month!, day!, "America/Sao_Paulo");
    }),
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
]);
const indicatorFilters = z
  .object({
    from: indicatorDate.optional(),
    to: indicatorDate.optional(),
    moeda: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from < value.to, {
    message: "invalid_period"
  });
analyticsRouter.get(
  "/indicators",
  run((r) =>
    indicators(r.storeId!, indicatorFilters.parse(r.query), financial(r))
  )
);
analyticsRouter.get(
  "/indicators.csv",
  requirePermission("ANALYTICS_EXPORTAR"),
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      const result = await indicators(
        r.storeId!,
        indicatorFilters.parse(r.query),
        financial(r)
      );
      x.type("text/csv; charset=utf-8")
        .attachment(
          `indicadores-${result.referenciaEm.toISOString().slice(0, 10)}.csv`
        )
        .send(indicatorsCsv(result));
    } catch (e) {
      n(e);
    }
  }
);
analyticsRouter.get(
  "/dashboard",
  run((r) => {
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional()
      })
      .parse(r.query);
    return s.dashboard(r.storeId!, q.from, q.to, financial(r));
  })
);
analyticsRouter.get(
  "/reports/:type",
  run((r) => {
    const filters = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        status: z.string().min(1).optional()
      })
      .strict()
      .parse(r.query);
    const type = String(r.params.type);
    if (FINANCIAL_REPORTS.has(type) && !financial(r))
      throw new AppError(403, "insufficient_permission");
    return s.report(r.storeId!, type, filters, financial(r));
  })
);
