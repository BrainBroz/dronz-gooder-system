import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { audit } from "../operations/operations.persistence";
import { loadRows } from "./purchases-feed.service";

// COMPRADO = antes de Miami (o "a caminho de Miami" vem do rastreio do vendedor, não de uma etapa gravada).
const ORDER = ["COMPRADO", "EM_MIAMI", "EM_REMESSA", "NO_BRASIL"] as const;
type Target = (typeof ORDER)[number];

export const stageSchema = z
  .object({
    candidateIds: z.array(z.string().cuid()).min(1).max(300),
    etapa: z.enum(ORDER),
    // Dia em que aconteceu (padrão: agora); serve para registrar o que já chegou antes de usar o sistema.
    ocorreuEm: z.coerce.date().refine((date) => date.getTime() <= Date.now() + 24 * 60 * 60 * 1000, "future_date").optional(),
    remessa: z.string().trim().min(1).max(60).optional()
  })
  .strict();

const can = (identity: AuthIdentity, code: string) =>
  identity.permissoes.some((permission) => permission.code === "SYSTEM_ADMIN" || permission.code === code);

/**
 * Muda a etapa de compras confirmadas: um passo para frente ou para trás (nunca pula etapa), sempre o pedido inteiro.
 * Miami (chegou, remessa) pede MIAMI_RECEBIMENTO_CONFIRMAR; entrar no Brasil ou voltar de lá pede RECEBIMENTO_CONFIRMAR.
 * Tudo ou nada: se uma compra não puder mudar, nenhuma muda.
 */
export async function setPurchaseStage(identity: AuthIdentity, input: z.infer<typeof stageSchema>) {
  const wanted = [...new Set(input.candidateIds)];
  const visible = new Map((await loadRows(identity, {})).map((row) => [row.candidateId, row]));
  const target = ORDER.indexOf(input.etapa);
  const plan = wanted.map((candidateId) => {
    const row = visible.get(candidateId);
    if (!row) throw new AppError(404, "not_found");
    if (row.cancelled) throw new AppError(409, "purchase_cancelled");
    const from = ORDER.indexOf((row.etapa ? row.fase : "COMPRADO") as Target);
    if (row.status !== "APROVADA") throw new AppError(409, "purchase_not_confirmed");
    if (from === target) return { row, from, skip: true as const };
    if (Math.abs(from - target) !== 1) throw new AppError(409, "stage_transition_invalid");
    const permission = from === 3 || target === 3 ? "RECEBIMENTO_CONFIRMAR" : "MIAMI_RECEBIMENTO_CONFIRMAR";
    if (!can(identity, permission)) throw new AppError(403, "insufficient_permission");
    return { row, from, skip: false as const, permission };
  });
  const now = new Date();
  const when = input.ocorreuEm ?? now;
  await prisma.$transaction(async (tx) => {
    for (const entry of plan) {
      if (entry.skip) continue;
      const candidate = await tx.buyerPurchaseCandidate.findUniqueOrThrow({ where: { id: entry.row.candidateId }, select: { compraImportadaId: true } });
      const purchaseId = candidate.compraImportadaId;
      if (!purchaseId) throw new AppError(409, "purchase_not_confirmed");
      const before = await tx.etapaCompra.findUnique({ where: { compraImportadaId: purchaseId } });
      if (input.etapa === "COMPRADO") await tx.etapaCompra.deleteMany({ where: { compraImportadaId: purchaseId } });
      else {
        const forward = entry.from < target;
        const defaultRemessa = `Remessa ${when.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
        // Voltar uma etapa não apaga as datas já registradas das etapas anteriores.
        const data = {
          etapa: input.etapa,
          chegouMiamiEm: input.etapa === "EM_MIAMI" && forward ? when : (before?.chegouMiamiEm ?? when),
          enviadaEm: input.etapa === "EM_MIAMI" ? null : input.etapa === "EM_REMESSA" && forward ? when : (before?.enviadaEm ?? when),
          remessa: input.etapa === "EM_MIAMI" ? null : input.etapa === "EM_REMESSA" ? (input.remessa ?? (forward ? defaultRemessa : (before?.remessa ?? defaultRemessa))) : (before?.remessa ?? null),
          chegouBrasilEm: input.etapa === "NO_BRASIL" ? when : null,
          atualizadoPorId: identity.user.id
        };
        await tx.etapaCompra.upsert({ where: { compraImportadaId: purchaseId }, create: { compraImportadaId: purchaseId, ...data }, update: data });
      }
      await audit(tx, {
        usuarioId: identity.user.id,
        lojaId: entry.row.store?.id,
        permissionCode: entry.permission,
        action: "PURCHASE_STAGE_CHANGED",
        entity: "CompraImportada",
        entityId: purchaseId,
        correlationId: entry.row.candidateId,
        before: before ? { etapa: before.etapa, remessa: before.remessa } : { etapa: "COMPRADO" },
        after: { etapa: input.etapa, remessa: input.remessa ?? null, ocorreuEm: when.toISOString() },
        origin: "API_MARKETPLACE_INTEGRATIONS"
      });
    }
  });
  return { alteradas: plan.filter((entry) => !entry.skip).length, iguais: plan.filter((entry) => entry.skip).length };
}
