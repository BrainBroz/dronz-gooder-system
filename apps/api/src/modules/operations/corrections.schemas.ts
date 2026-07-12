import { z } from "zod";

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  quantityDelta: z.number().int().refine((value) => value !== 0),
  originalMovementId: z.string().min(1)
}).strict();

const base = {
  originalEventId: z.string().min(1),
  reason: z.string().min(3),
  adjustments: z.array(adjustmentSchema).optional()
};

export const correctionSchema = z.discriminatedUnion("entity", [
  z.object({
    ...base,
    entity: z.literal("CheckpointParaguai"),
    correctionType: z.enum(["DIVERGENCIA", "STOCK_COMPENSATION"]),
    after: z.object({
      tipoDivergencia: z.enum(["CORRETO", "MALA_AUSENTE", "VOLUME_AUSENTE", "ITEM_NAO_LOCALIZADO", "QUANTIDADE_DIVERGENTE", "AVARIA", "ITEM_EXTRA", "CHECKPOINT_PARCIAL"]),
      observacao: z.string().nullable().optional()
    }).strict()
  }).strict(),
  z.object({
    ...base,
    entity: z.literal("CheckpointBrasil"),
    correctionType: z.enum(["DIVERGENCIA", "STOCK_COMPENSATION"]),
    after: z.object({
      tipoDivergencia: z.enum(["CORRETO", "MALA_AUSENTE", "ITEM_NAO_LOCALIZADO", "QUANTIDADE_DIVERGENTE", "AVARIA", "ITEM_EXTRA", "REGISTRO_ADUANEIRO_DIVERGENTE", "LACRE_ROMPIDO"]),
      observacao: z.string().nullable().optional()
    }).strict()
  }).strict(),
  z.object({
    ...base,
    entity: z.literal("RecebimentoMiami"),
    correctionType: z.enum(["DIVERGENCIA", "STOCK_COMPENSATION"]),
    after: z.object({
      tipoDivergencia: z.enum(["CORRETO", "FALTANTE", "QUANTIDADE_DIVERGENTE", "DANIFICADO", "DESCONHECIDO", "TRACKING_NAO_LOCALIZADO"]),
      observacao: z.string().nullable().optional()
    }).strict()
  }).strict(),
  z.object({
    ...base,
    entity: z.literal("RecebimentoItem"),
    correctionType: z.enum(["AJUSTE_RECEBIMENTO", "STOCK_COMPENSATION"]),
    after: z.object({
      quantidadeRecebida: z.number().int().min(0),
      quantidadeRejeitada: z.number().int().min(0),
      tipoDivergencia: z.enum(["CORRETO", "FALTA", "EXCESSO", "AVARIA", "ITEM_INCORRETO", "OUTRO"]),
      divergenciaResolvida: z.boolean(),
      observacoes: z.string().nullable().optional()
    }).strict()
  }).strict()
]).superRefine((input, context) => {
  if (input.correctionType === "STOCK_COMPENSATION" && !input.adjustments?.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["adjustments"], message: "stock compensation requires adjustments" });
  if (input.correctionType !== "STOCK_COMPENSATION" && input.adjustments?.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["adjustments"], message: "adjustments require stock compensation" });
});

export type CorrectionInput = z.infer<typeof correctionSchema>;
