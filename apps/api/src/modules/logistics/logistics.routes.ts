import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as s from "./logistics.service";
import { AppError } from "../../lib/app-error";
export const logisticsRouter = Router();
const actor = (r: AuthenticatedRequest) => ({
  userId: r.identity!.user.id,
  permissions: r.identity!.permissoes.map((permission) => permission.code)
});
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
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
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
            modalidade: z.enum(["MALA_VIAJANTE", "CAIXA_AEREA"]).optional(),
            viajanteId: z.string().optional(),
            transportadora: z.string().trim().max(120).optional(),
            origem: z.string(),
            destino: z.string(),
            partidaEm: z.coerce.date(),
            chegadaPrevistaEm: z.coerce.date(),
            rotaCodigo: z.enum(["MIAMI_PARAGUAI_BRASIL", "MIAMI_BRASIL"]).optional()
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
      r.identity!.user.id,
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
            limitePesoKg: z.number().positive().max(1000).optional(),
            posicaoId: z.string().optional()
          })
          .strict(),
        r.body
      ) as never,
      actor(r)
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
      r.identity!.user.id,
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
            ]),
            motivo: z.string().trim().max(2000).optional(),
            recebidoPor: z.string().trim().max(200).optional(),
            referencia: z.string().trim().max(200).optional(),
            observacao: z.string().trim().max(2000).optional()
          })
          .strict(),
        r.body
      ).status,
      typeof r.body?.motivo === "string" ? r.body.motivo : undefined,
      {
        recebidoPor: typeof r.body?.recebidoPor === "string" ? r.body.recebidoPor : undefined,
        referencia: typeof r.body?.referencia === "string" ? r.body.referencia : undefined,
        observacao: typeof r.body?.observacao === "string" ? r.body.observacao : undefined
      }
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
      ) as never,
      actor(r)
    )
  )
);
logisticsRouter.delete(
  "/allocations/:id",
  wrap((r) => s.deallocate(r.storeId!, String(r.params.id)))
);
logisticsRouter.post(
  "/miami-confirmations",
  requirePermission("MIAMI_RECEBIMENTO_CONFIRMAR"),
  wrap((r) =>
    s.confirmMiami(
      r.storeId!,
      actor(r),
      parse(
        z
          .object({
            posicaoId: z.string().optional(),
            condicaoComercial: z.enum(["NAO_DEFINIDA", "NOVO", "CAIXA_ABERTA", "USADO"]).optional(),
            funcionamento: z.enum(["NAO_TESTADO", "FUNCIONAL", "DEFEITO_PARCIAL", "INOPERANTE"]).optional(),
            acessoriosAusentes: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
            observacaoCondicao: z.string().trim().max(2000).optional(),
            registroTerceiro: z.boolean().optional(),
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
      ),
      typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined
    )
  )
);
logisticsRouter.post(
  "/checkpoint-paraguai",
  requirePermission("PARAGUAI_CHECKPOINT_CONFIRMAR"),
  wrap((r) =>
    s.confirmParaguai(
      r.storeId!,
      r.identity!.user.id,
      parse(
        z
          .object({
            viagemId: z.string(),
            malaId: z.string(),
            confirmadoEm: z.coerce.date(),
            observacao: z.string().optional(),
            tipoDivergencia: z
              .enum([
                "CORRETO",
                "MALA_AUSENTE",
                "VOLUME_AUSENTE",
                "ITEM_NAO_LOCALIZADO",
                "QUANTIDADE_DIVERGENTE",
                "AVARIA",
                "ITEM_EXTRA",
                "CHECKPOINT_PARCIAL"
              ])
              .default("CORRETO")
          })
          .strict(),
        r.body
      ),
      typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined
    )
  )
);
logisticsRouter.post(
  "/checkpoint-brasil",
  requirePermission("BRASIL_CHECKPOINT_CONFIRMAR"),
  wrap((r) =>
    s.confirmBrasil(
      r.storeId!,
      r.identity!.user.id,
      parse(
        z
          .object({
            viagemId: z.string(),
            malaId: z.string(),
            confirmadoEm: z.coerce.date(),
            observacao: z.string().optional(),
            tipoDivergencia: z
              .enum([
                "CORRETO",
                "MALA_AUSENTE",
                "ITEM_NAO_LOCALIZADO",
                "QUANTIDADE_DIVERGENTE",
                "AVARIA",
                "ITEM_EXTRA",
                "REGISTRO_ADUANEIRO_DIVERGENTE",
                "LACRE_ROMPIDO"
              ])
              .default("CORRETO")
          })
          .strict(),
        r.body
      ),
      typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined
    )
  )
);

const storesOf = (r: AuthenticatedRequest) => r.identity!.lojas.map((store) => store.id);
logisticsRouter.post(
  "/physical-groups",
  wrap((r) =>
    s.createPhysicalGroup(
      parse(
        z
          .object({
            codigo: z.string().trim().min(1).max(60),
            tipo: z.enum(["MALA", "CAIXA"]),
            limitePesoKg: z.number().positive().max(1000).optional()
          })
          .strict(),
        r.body
      )
    )
  )
);
logisticsRouter.get(
  "/physical-groups",
  wrap(() => s.physicalGroups())
);
logisticsRouter.get(
  "/physical-groups/:id",
  wrap((r) => s.physicalGroup(storesOf(r), String(r.params.id)))
);
logisticsRouter.put(
  "/suitcases/:id/physical-group",
  wrap((r) =>
    s.setPhysicalGroup(
      r.storeId!,
      r.identity!.user.id,
      storesOf(r),
      String(r.params.id),
      parse(z.object({ grupoFisicoId: z.string().nullable() }).strict(), r.body).grupoFisicoId
    )
  )
);
