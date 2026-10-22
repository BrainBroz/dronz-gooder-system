import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";
import { secretDirectory } from "./marketplace-integrations.secrets";

const DELIVERIES_URL = "https://api.parcel.app/external/deliveries/?filter_mode=recent";

/** Status do Parcel (https://parcelapp.net/help/api-view-deliveries.html). */
export const PARCEL_STATUS: Record<number, string> = {
  0: "Entregue",
  1: "Sem atualização",
  2: "Em trânsito",
  3: "Aguardando retirada",
  4: "Saiu para entrega",
  5: "Não encontrado",
  6: "Tentativa de entrega falhou",
  7: "Exceção",
  8: "Transportadora avisada"
};
export const statusLabel = (code: number) => PARCEL_STATUS[code] ?? "Status desconhecido";
export const DELIVERED = 0;

/** Mesmo código escrito pelo eBay e pelo Parcel: sem espaços e em maiúsculas. */
export const normalizeTracking = (code: string) => code.replace(/\s+/g, "").toUpperCase();

const responseSchema = z.object({
  success: z.boolean(),
  error_message: z.string().optional(),
  deliveries: z
    .array(
      z.object({
        tracking_number: z.string().min(1),
        carrier_code: z.string().optional(),
        status_code: z.number().int(),
        date_expected: z.string().optional(),
        // O Parcel lista o evento mais recente primeiro.
        events: z.array(z.object({ event: z.string(), date: z.string(), location: z.string().optional() })).default([])
      })
    )
    .default([])
});

/** Chave da API do Parcel (plano Premium): variável PARCEL_API_KEY ou o arquivo parcel-api-key na pasta de segredos (fora do repositório). */
export async function parcelApiKey(): Promise<string | null> {
  const fromEnv = process.env.PARCEL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await readFile(path.join(secretDirectory(), "parcel-api-key"), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

// O Parcel limita a 20 consultas por hora e guarda a resposta em cache: duas consultas seguidas não trazem nada novo.
const MIN_INTERVAL_MS = 3 * 60_000;
let lastCall = 0;

/**
 * Lê as entregas recentes do Parcel e grava o último status de cada rastreio.
 * Sem chave configurada devolve null (recurso desligado). Só leitura: não muda compra, etapa nem estoque.
 */
export async function syncParcelStatuses(fetchImpl: typeof fetch = fetch, now = new Date()) {
  const key = await parcelApiKey();
  if (!key) return null;
  if (now.getTime() - lastCall < MIN_INTERVAL_MS) return { novos: 0, mudaram: 0, iguais: 0, pulado: true as const };
  lastCall = now.getTime();
  let body: unknown;
  try {
    const response = await fetchImpl(DELIVERIES_URL, { headers: { "api-key": key }, signal: AbortSignal.timeout(20_000) });
    body = await response.json().catch(() => null);
    if (!response.ok && !body) throw new Error(String(response.status));
  } catch {
    throw new AppError(502, "parcel_unavailable");
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new AppError(502, "parcel_unavailable");
  if (!parsed.data.success) throw new AppError(502, "parcel_rejected");

  const known = new Map(
    (await prisma.statusRastreio.findMany({ where: { codigo: { in: parsed.data.deliveries.map((delivery) => normalizeTracking(delivery.tracking_number)) } }, select: { codigo: true, statusCodigo: true, ultimoEvento: true } })).map((entry) => [entry.codigo, entry])
  );
  const counts = { novos: 0, mudaram: 0, iguais: 0, pulado: false as boolean };
  await prisma.$transaction(
    parsed.data.deliveries.map((delivery) => {
      const codigo = normalizeTracking(delivery.tracking_number);
      const latest = delivery.events[0];
      const before = known.get(codigo);
      if (!before) counts.novos += 1;
      else if (before.statusCodigo !== delivery.status_code || before.ultimoEvento !== (latest?.event ?? null)) counts.mudaram += 1;
      else counts.iguais += 1;
      const data = {
        transportadora: delivery.carrier_code ?? null,
        statusCodigo: delivery.status_code,
        ultimoEvento: latest?.event ?? null,
        ultimoEventoLocal: latest?.location ?? null,
        ultimoEventoData: latest?.date ?? null,
        previstaEm: delivery.date_expected ?? null,
        consultadoEm: now
      };
      return prisma.statusRastreio.upsert({ where: { codigo }, create: { codigo, ...data }, update: data });
    })
  );
  return counts;
}

/** Só para testes: libera a trava de intervalo. */
export const resetParcelThrottle = () => {
  lastCall = 0;
};
