import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { loadRows, type FeedRow } from "./purchases-feed.service";
import { normalizeTracking, parcelApiKey } from "./parcel-tracking.service";

const ADD_URL = "https://api.parcel.app/external/add-delivery/";
const DAY_MS = 24 * 60 * 60 * 1000;
const PARCEL_MAX_PER_DAY = 20;

// Nome da transportadora que o eBay informa -> código do Parcel (https://api.parcel.app/external/supported_carriers.json).
const CARRIER_CODES: Record<string, string> = {
  USPS: "usps",
  UPS: "ups",
  FEDEX: "fedex",
  "FEDEX GROUND": "fedex",
  DHL: "dhl",
  ONTRAC: "ont",
  "GOFO EXPRESS": "gofous"
};
export const parcelCarrier = (name: string | null | undefined) => (name ? (CARRIER_CODES[name.trim().toUpperCase()] ?? null) : null);

export type PushCandidate = { codigo: string; transportadora: string; carrierCode: string; descricao: string };

/** Quantos rastreios novos o sistema pode mandar ao Parcel por dia (o Parcel aceita 20; sobra margem para uso manual). */
export const dailyLimit = () => {
  const value = Number(process.env.PARCEL_DAILY_ADD_LIMIT ?? "15");
  return Number.isFinite(value) ? Math.min(PARCEL_MAX_PER_DAY, Math.max(0, Math.floor(value))) : 15;
};

/**
 * Rastreios de compras confirmadas que ainda não chegaram em Miami e não constam como entregues, os mais recentes primeiro.
 * Ignora os que o Parcel já conhece (ou que o sistema já enviou) e transportadoras sem código no Parcel.
 */
export function selectTrackingsToPush(rows: FeedRow[], skip: Set<string>): PushCandidate[] {
  const picked = new Map<string, PushCandidate & { orderedAt: string }>();
  for (const row of rows) {
    if (row.cancelled || row.status !== "APROVADA" || row.entregue) continue;
    if (row.fase !== "COMPRADO" && row.fase !== "A_CAMINHO_MIAMI") continue;
    const first = row.rawItems[0];
    const more = row.rawItems.length > 1 ? ` +${row.rawItems.length - 1}` : "";
    const descricao = `[${row.store?.nome ?? "Sem loja"}] ${(first?.title ?? "Compra").slice(0, 60)}${more} · pedido ${row.orderId}`;
    for (const tracking of row.trackings) {
      const codigo = normalizeTracking(tracking.code);
      const carrierCode = parcelCarrier(tracking.carrier);
      if (!carrierCode || skip.has(codigo) || picked.has(codigo)) continue;
      picked.set(codigo, { codigo, transportadora: tracking.carrier!.toUpperCase(), carrierCode, descricao, orderedAt: row.orderedAt });
    }
  }
  return [...picked.values()].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)).map(({ codigo, transportadora, carrierCode, descricao }) => ({ codigo, transportadora, carrierCode, descricao }));
}

// O servidor lê as compras de todas as lojas; só este job usa isso, nunca uma rota.
const allStoresIdentity = async () =>
  ({ lojas: await prisma.loja.findMany({ select: { id: true, slug: true, nome: true } }), permissoes: [{ code: "SYSTEM_ADMIN" }] }) as unknown as AuthIdentity;

let running = false;

/**
 * Cadastra no Parcel (add-delivery) os rastreios das compras que ele ainda não conhece, até o limite diário
 * (janela de 24 h), e registra cada tentativa para nunca repetir. O Parcel passa a cuidar do status de entrega.
 * Sem chave configurada (ou PARCEL_ADD_DELIVERIES=false) fica desligado e devolve null.
 */
export async function pushTrackingsToParcel(fetchImpl: typeof fetch = fetch, now = new Date()) {
  const key = await parcelApiKey();
  if (!key || process.env.PARCEL_ADD_DELIVERIES === "false" || running) return null;
  running = true;
  try {
    const limit = dailyLimit();
    const rows = await loadRows(await allStoresIdentity(), {});
    const codes = rows.flatMap((row) => row.trackings.map((tracking) => normalizeTracking(tracking.code)));
    const [known, sent, used] = await Promise.all([
      codes.length ? prisma.statusRastreio.findMany({ where: { codigo: { in: codes } }, select: { codigo: true } }) : [],
      codes.length ? prisma.envioParcel.findMany({ where: { codigo: { in: codes } }, select: { codigo: true } }) : [],
      prisma.envioParcel.count({ where: { tentadoEm: { gt: new Date(now.getTime() - DAY_MS) } } })
    ]);
    const pending = selectTrackingsToPush(rows, new Set([...known, ...sent].map((entry) => entry.codigo)));
    const result = { adicionados: 0, recusados: 0, pendentes: pending.length, limite: limit };
    for (const candidate of pending.slice(0, Math.max(0, limit - used))) {
      let response: Response;
      try {
        response = await fetchImpl(ADD_URL, {
          method: "POST",
          headers: { "api-key": key, "content-type": "application/json" },
          body: JSON.stringify({ tracking_number: candidate.codigo, carrier_code: candidate.carrierCode, description: candidate.descricao, send_push_confirmation: false }),
          signal: AbortSignal.timeout(20_000)
        });
      } catch {
        throw new AppError(502, "parcel_unavailable");
      }
      const body = (await response.json().catch(() => null)) as { success?: boolean; error_message?: string } | null;
      if (response.status === 401) throw new AppError(502, "parcel_rejected");
      if (response.status === 429) break; // o Parcel pediu para esperar: tenta na próxima rodada
      const ok = response.ok && body?.success === true;
      await prisma.envioParcel.create({
        data: { codigo: candidate.codigo, transportadora: candidate.transportadora, ok, erro: ok ? null : (body?.error_message ?? `http_${response.status}`).slice(0, 200), tentadoEm: now }
      });
      if (ok) result.adicionados += 1;
      else result.recusados += 1;
      result.pendentes -= 1;
    }
    return result;
  } finally {
    running = false;
  }
}
