import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as s from "./analytics.service";
export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireStore);
const run =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await fn(r));
    } catch (e) {
      n(e);
    }
  };
analyticsRouter.get(
  "/dashboard",
  run((r) => {
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional()
      })
      .parse(r.query);
    return s.dashboard(r.storeId!, q.from, q.to);
  })
);
analyticsRouter.get(
  "/reports/:type",
  run((r) => s.report(r.storeId!, String(r.params.type)))
);
