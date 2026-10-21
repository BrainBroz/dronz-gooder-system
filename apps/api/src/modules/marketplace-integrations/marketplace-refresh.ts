import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { getAuthenticatedUser } from "../auth/auth.service";
import { marketplaceAdapterRegistry } from "./marketplace-integrations.adapters";
import { syncConnection } from "./marketplace-integrations.service";
import { syncParcelStatuses } from "./parcel-tracking.service";
import type { MarketplaceAdapterRegistry } from "./marketplace-integrations.types";

export type RefreshResult = { conexao: string; status: string; criados?: number; atualizados?: number; erro?: string };

/**
 * Atualiza com o marketplace todas as conexões ativas que `identityFor` autoriza (null = pula).
 * Compra nova entra confirmada; rastreio, status e cancelamento de compra já confirmada se atualizam sozinhos.
 * Uma conexão com problema não impede as outras.
 */
export async function refreshActiveConnections(
  identityFor: (connection: { id: string; criadoPorId: string; escopo: string; lojaPermitidaId: string | null }) => Promise<AuthIdentity | null>,
  registry: MarketplaceAdapterRegistry = marketplaceAdapterRegistry
): Promise<RefreshResult[]> {
  const connections = await prisma.conexaoMarketplace.findMany({
    where: { status: "ACTIVE", provider: "EBAY" },
    select: { id: true, nome: true, criadoPorId: true, escopo: true, lojaPermitidaId: true },
    orderBy: { nome: "asc" }
  });
  const results: RefreshResult[] = [];
  for (const connection of connections) {
    try {
      const identity = await identityFor(connection);
      if (!identity) continue;
      const run = await syncConnection(identity, connection.id, { replay: false }, `atualizar-${connection.id}-${Date.now()}`, registry);
      results.push({ conexao: connection.nome, status: run.status, criados: run.criados, atualizados: run.atualizados });
    } catch (error) {
      results.push({ conexao: connection.nome, status: "FALHOU", erro: error instanceof AppError ? error.code : "erro_inesperado" });
    }
  }
  return results;
}

/** Status de entrega dos rastreios no Parcel (só se houver chave configurada); falha dele não derruba o resto. */
async function refreshTracking(): Promise<RefreshResult[]> {
  const conexao = "Parcel (rastreio)";
  try {
    const counts = await syncParcelStatuses();
    return !counts || counts.pulado ? [] : [{ conexao, status: "SUCCEEDED", criados: counts.novos + counts.mudaram, atualizados: counts.iguais }];
  } catch (error) {
    return [{ conexao, status: "FALHOU", erro: error instanceof AppError ? error.code : "erro_inesperado" }];
  }
}

/** Botão "Atualizar agora": só as conexões que o usuário pode ver (compartilhadas ou das suas lojas). */
export const refreshForUser = async (identity: AuthIdentity) => [
  ...(await refreshActiveConnections(async (connection) =>
    connection.escopo === "SHARED" || (connection.lojaPermitidaId && identity.lojas.some((store) => store.id === connection.lojaPermitidaId)) ? identity : null
  )),
  ...(await refreshTracking())
];

/** Atualização agendada: roda como o usuário que criou a conexão (a quem a sincronização já pertence). */
export const refreshAsOwners = async () => [
  ...(await refreshActiveConnections(async (connection) => getAuthenticatedUser(connection.criadoPorId).catch(() => null))),
  ...(await refreshTracking())
];

/**
 * Atualiza as conexões do eBay a cada N minutos (padrão 30; 0 desliga) enquanto a API estiver rodando.
 * Só liga com MARKETPLACE_EBAY_BUYER_ENABLED=true. Uma rodada nunca começa em cima da anterior.
 */
export function startMarketplaceScheduler(env: NodeJS.ProcessEnv = process.env, run: () => Promise<RefreshResult[]> = refreshAsOwners) {
  const minutes = Number(env.MARKETPLACE_SYNC_INTERVAL_MINUTES ?? "30");
  if (env.MARKETPLACE_EBAY_BUYER_ENABLED !== "true" || !Number.isFinite(minutes) || minutes <= 0) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const results = await run();
      const failed = results.filter((result) => result.erro).length;
      console.log(`[marketplace] atualização automática: ${results.length} conexões, ${failed} com falha`);
    } catch {
      console.log("[marketplace] atualização automática falhou");
    } finally {
      running = false;
    }
  }, minutes * 60_000);
  timer.unref();
  return timer;
}
