import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as service from "./positions.service";

// Posições são globais (a mesma base atende às duas lojas); a disponibilidade é lida por loja.
export const positionsRouter = Router();
positionsRouter.use(requireAuth);

const actor = (r: AuthenticatedRequest) => ({
  userId: r.identity!.user.id,
  permissions: r.identity!.permissoes.map((permission) => permission.code)
});
const run =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.status(status).json(await fn(r));
    } catch (error) {
      n(error);
    }
  };
const manage = requirePermission("LOGISTICA_POSICOES_GERENCIAR");

positionsRouter.get(
  "/",
  run((r) => service.list(actor(r)))
);
positionsRouter.get(
  "/assignable-users",
  manage,
  run(() => service.assignableUsers())
);
positionsRouter.get(
  "/:id",
  run((r) => service.get(actor(r), String(r.params.id)))
);
positionsRouter.get(
  "/:id/availability",
  requireStore,
  run((r) => service.availability(actor(r), r.storeId!, String(r.params.id)))
);
positionsRouter.post(
  "/",
  manage,
  run((r) => {
    const d = z
      .object({
        codigo: z
          .string()
          .trim()
          .min(2)
          .max(40)
          .regex(/^[A-Z0-9_-]+$/),
        nome: z.string().trim().min(1).max(120),
        tipo: z.enum(["PERMANENTE", "TEMPORARIA"]),
        inicioEm: z.coerce.date().optional(),
        fimEm: z.coerce.date().optional(),
        local: z
          .object({
            alias: z.string().trim().min(1).max(80),
            cidade: z.string().trim().min(1).max(80),
            estado: z.string().trim().max(80).optional(),
            pais: z.string().trim().length(2),
            timezone: z.string().trim().min(1),
            endereco: z.string().trim().max(500).optional()
          })
          .strict()
      })
      .strict()
      .parse(r.body);
    return service.create(actor(r), d);
  }, 201)
);
positionsRouter.patch(
  "/:id/status",
  manage,
  run((r) => {
    const d = z
      .object({
        action: z.enum(["ATIVAR", "ENCERRAR", "CANCELAR", "REABRIR"]),
        motivo: z.string().trim().max(2000).optional()
      })
      .strict()
      .parse(r.body);
    return service.transition(
      actor(r),
      String(r.params.id),
      d.action,
      d.motivo
    );
  })
);
positionsRouter.post(
  "/:id/responsibilities",
  manage,
  run((r) => {
    const d = z
      .object({
        usuarioId: z.string(),
        papel: z.enum(["PRINCIPAL", "DELEGADO"]),
        validoDe: z.coerce.date(),
        validoAte: z.coerce.date().optional()
      })
      .strict()
      .parse(r.body);
    return service.addResponsibility(actor(r), String(r.params.id), d);
  }, 201)
);
positionsRouter.delete(
  "/:id/responsibilities/:responsibilityId",
  manage,
  run((r) =>
    service.revokeResponsibility(
      actor(r),
      String(r.params.id),
      String(r.params.responsibilityId)
    )
  )
);
