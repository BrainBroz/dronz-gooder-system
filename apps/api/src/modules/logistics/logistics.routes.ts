import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as s from "./logistics.service";
import { AppError } from "../../lib/app-error";
export const logisticsRouter = Router();
logisticsRouter.use(requireAuth, requireStore);
const wrap =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>) =>
  async (r: AuthenticatedRequest, x: Response, n: NextFunction) => {
    try {
      x.json(await fn(r));
    } catch (e) {
      n(e);
    }
  };
const parse = (schema: z.ZodTypeAny, body: unknown) => {
  const p = schema.safeParse(body);
  if (!p.success)
    throw new AppError(400, "bad_request");
  return p.data;
};
logisticsRouter.get(
  "/travelers",
  wrap((r) => s.travelers(r.storeId!))
);
logisticsRouter.post(
  "/travelers",
  wrap((r) =>
    s.createTraveler(
      r.storeId!,
      parse(
        z
          .object({
            nome: z.string().min(1),
            email: z.string().email().optional(),
            telefone: z.string().optional(),
            documento: z.string().optional(),
            observacoes: z.string().optional(),
            ativo: z.boolean().optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.patch(
  "/travelers/:id",
  wrap((r) =>
    s.updateTraveler(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            nome: z.string().min(1).optional(),
            email: z.string().email().optional(),
            telefone: z.string().optional(),
            observacoes: z.string().optional(),
            ativo: z.boolean().optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.delete(
  "/travelers/:id",
  wrap((r) => s.deleteTraveler(r.storeId!, String(r.params.id)))
);
logisticsRouter.get(
  "/trips",
  wrap((r) => s.trips(r.storeId!))
);
logisticsRouter.post(
  "/trips",
  wrap((r) =>
    s.createTrip(
      r.storeId!,
      parse(
        z
          .object({
            viajanteId: z.string(),
            origem: z.string(),
            destino: z.string(),
            partidaEm: z.coerce.date(),
            chegadaPrevistaEm: z.coerce.date()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.patch(
  "/trips/:id",
  wrap((r) =>
    s.updateTrip(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            origem: z.string().optional(),
            destino: z.string().optional(),
            partidaEm: z.coerce.date().optional(),
            chegadaPrevistaEm: z.coerce.date().optional(),
            observacoes: z.string().optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.patch(
  "/trips/:id/status",
  wrap((r) =>
    s.tripStatus(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            status: z.enum([
              "PLANNED",
              "OPEN_FOR_ALLOCATION",
              "CLOSED_FOR_ALLOCATION",
              "IN_TRANSIT",
              "ARRIVED_BRAZIL",
              "CANCELLED"
            ])
          })
          .strict(),
        r.body
      ).status
    )
  )
);
logisticsRouter.delete(
  "/trips/:id",
  wrap((r) => s.deleteTrip(r.storeId!, String(r.params.id)))
);
logisticsRouter.get(
  "/suitcases",
  wrap((r) => s.suitcases(r.storeId!))
);
logisticsRouter.post(
  "/suitcases",
  wrap((r) =>
    s.createSuitcase(
      r.storeId!,
      parse(
        z
          .object({
            viagemId: z.string(),
            codigo: z.string(),
            limitePesoKg: z.number().positive().max(23).optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.patch(
  "/suitcases/:id",
  wrap((r) =>
    s.updateSuitcase(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            codigo: z.string().optional(),
            limitePesoKg: z.number().positive().max(23).optional(),
            observacoes: z.string().optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.delete(
  "/suitcases/:id",
  wrap((r) => s.deleteSuitcase(r.storeId!, String(r.params.id)))
);
logisticsRouter.post(
  "/suitcases/:id/volumes",
  wrap((r) =>
    s.addVolume(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            codigo: z.string(),
            taraKg: z.number().min(0).default(0.5)
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.patch(
  "/suitcases/:id/volumes/:volId",
  wrap((r) =>
    s.updateVolume(
      r.storeId!,
      String(r.params.id),
      String(r.params.volId),
      parse(
        z
          .object({
            codigo: z.string().optional(),
            taraKg: z.number().min(0).optional()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.delete(
  "/suitcases/:id/volumes/:volId",
  wrap((r) =>
    s.deleteVolume(
      r.storeId!,
      String(r.params.id),
      String(r.params.volId)
    )
  )
);
logisticsRouter.get(
  "/suitcases/:id/weight",
  wrap((r) => s.weight(r.storeId!, String(r.params.id)))
);
logisticsRouter.patch(
  "/suitcases/:id/status",
  wrap((r) =>
    s.suitcaseStatus(
      r.storeId!,
      String(r.params.id),
      parse(
        z
          .object({
            status: z.enum([
              "PLANNING",
              "CLOSED",
              "CHECKED_IN",
              "ARRIVED_BRAZIL",
              "RECEIVED",
              "CANCELLED"
            ])
          })
          .strict(),
        r.body
      ).status
    )
  )
);
logisticsRouter.post(
  "/allocations",
  wrap((r) =>
    s.allocate(
      r.storeId!,
      parse(
        z
          .object({
            pedidoCompraItemId: z.string(),
            malaId: z.string(),
            volumeLogisticoId: z.string(),
            quantidade: z.number().int().positive()
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
logisticsRouter.delete(
  "/allocations/:id",
  wrap((r) => s.deallocate(r.storeId!, String(r.params.id)))
);
logisticsRouter.post(
  "/miami-confirmations",
  wrap((r) =>
    s.confirmMiami(
      r.storeId!,
      r.identity!.user.id,
      parse(
        z
          .object({
            pedidoCompraItemId: z.string(),
            quantidadeRecebida: z.number().int().positive(),
            recebidoEm: z.coerce.date(),
            observacao: z.string().optional(),
            tipoDivergencia: z
              .enum([
                "CORRETO",
                "FALTANTE",
                "QUANTIDADE_DIVERGENTE",
                "DANIFICADO",
                "DESCONHECIDO",
                "TRACKING_NAO_LOCALIZADO"
              ])
              .default("CORRETO")
          })
          .strict(),
        r.body
      ) as never
    )
  )
);
