import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { getAuthenticatedUser } from "../auth/auth.service";
import { marketplaceAdapterRegistry } from "./marketplace-integrations.adapters";
import { syncConnection } from "./marketplace-integrations.service";
import { pushTrackingsToParcel } from "./parcel-push.service";
import { healShipmentDivergences } from "./shipment-divergence.service";
import { syncParcelStatuses } from "./parcel-tracking.service";
import type { MarketplaceAdapterRegistry } from "./marketplace-integrations.types";

export type RefreshResult = { conexao: string; status: string; criados?: number; atualizados?: number; erro?: string; detalhe?: string };

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

/**
 * Parcel (só com chave configurada): manda os rastreios novos para ele cuidar do status e lê os status de entrega.
 * Falha dele não derruba o resto nem a leitura do eBay.
 */
async function refreshTracking(): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  const failure = (conexao: string, error: unknown) =>
    results.push({ conexao, status: "FALHOU", erro: error instanceof AppError ? error.code : "erro_inesperado" });
  try {
    const pushed = await pushTrackingsToParcel();
    if (pushed && (pushed.adicionados || pushed.recusados || pushed.pendentes))
      results.push({
        conexao: "Parcel (cadastro de rastreios)",
        status: "SUCCEEDED",
        detalhe: `${pushed.adicionados} enviados ao Parcel${pushed.recusados ? `, ${pushed.recusados} recusados` : ""}${pushed.pendentes ? `; ${pushed.pendentes} aguardam o limite diário de ${pushed.limite}` : ""}`
      });
  } catch (error) {
    failure("Parcel (cadastro de rastreios)", error);
  }
  try {
    const counts = await syncParcelStatuses();
    if (counts && !counts.pulado) results.push({ conexao: "Parcel (rastreio)", status: "SUCCEEDED", criados: counts.novos + counts.mudaram, atualizados: counts.iguais });
  } catch (error) {
    failure("Parcel (rastreio)", error);
  }
  return results;
}

/** Divergências que são só mudança de envio voltam sozinhas para "Aprovada" (o resto segue para revisão). */
async function healDivergences(): Promise<RefreshResult[]> {
  const conexao = "Divergências só de envio";
  try {
    const healed = await healShipmentDivergences();
    return healed ? [{ conexao, status: "SUCCEEDED", detalhe: `${healed} ${healed === 1 ? "resolvida" : "resolvidas"} automaticamente` }] : [];
  } catch (error) {
    return [{ conexao, status: "FALHOU", erro: error instanceof AppError ? error.code : "erro_inesperado" }];
  }
}

/** Botão "Atualizar agora": só as conexões que o usuário pode ver (compartilhadas ou das suas lojas). */
export const refreshForUser = async (identity: AuthIdentity) => [
  ...(await refreshActiveConnections(async (connection) =>
    connection.escopo === "SHARED" || (connection.lojaPermitidaId && identity.lojas.some((store) => store.id === connection.lojaPermitidaId)) ? identity : null
  )),
  ...(await healDivergences()),
  ...(await refreshTracking())
];

/** Atualização agendada: roda como o usuário que criou a conexão (a quem a sincronização já pertence). */
export const refreshAsOwners = async () => [
  ...(await refreshActiveConnections(async (connection) => getAuthenticatedUser(connection.criadoPorId).catch(() => null))),
  ...(await healDivergences()),
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
