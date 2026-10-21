import jwt from "jsonwebtoken";
import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { env } from "../../lib/env";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { audit } from "../operations/operations.persistence";
import { marketplaceAdapterRegistry } from "./marketplace-integrations.adapters";
import { COMPATIBILITY_LEVEL, SCOPE, TOKEN_URL, TRADING_URL } from "./ebay-buyer.adapter";
import { ebayAppFromEnvironment, writeEbayRefreshToken } from "./marketplace-integrations.secrets";
import { child, parseXml, textOf } from "./xml";

const AUTHORIZE_URL = "https://auth.ebay.com/oauth2/authorize";
const ORIGIN = "API_MARKETPLACE_INTEGRATIONS";
const STATE_AUDIENCE = "ebay-connect";

export const startSchema = z.object({ lojaId: z.string().cuid(), nome: z.string().trim().min(1).max(200).optional() }).strict();
export const completeSchema = z
  .object({ state: z.string().min(10).max(4000).optional(), code: z.string().min(10).max(4000).optional(), redirectedUrl: z.string().url().max(8000).optional() })
  .strict()
  .refine((value) => value.code || value.redirectedUrl, "code_or_url_required");

const hasStore = (identity: AuthIdentity, storeId: string) => identity.lojas.some((store) => store.id === storeId);
const app = () => {
  const value = ebayAppFromEnvironment();
  if (!value) throw new AppError(409, "ebay_app_not_configured");
  return value;
};

/** URL de consentimento do eBay. `state` é assinado e leva loja e usuário; `prompt=login` permite escolher outra conta eBay. */
export function startConnection(identity: AuthIdentity, input: z.infer<typeof startSchema>) {
  if (!hasStore(identity, input.lojaId)) throw new AppError(403, "marketplace_connection_store_mismatch");
  const credentials = app();
  const state = jwt.sign({ lojaId: input.lojaId, nome: input.nome ?? null, uid: identity.user.id }, env.JWT_ACCESS_SECRET, { audience: STATE_AUDIENCE, expiresIn: "15m" });
  const query = new URLSearchParams({ client_id: credentials.clientId, response_type: "code", redirect_uri: credentials.ruName, scope: SCOPE, state, prompt: "login" });
  return { url: `${AUTHORIZE_URL}?${query.toString()}`, validoPorMinutos: 15 };
}

function readState(identity: AuthIdentity, state: string | undefined) {
  try {
    const payload = jwt.verify(state ?? "", env.JWT_ACCESS_SECRET, { audience: STATE_AUDIENCE }) as { lojaId?: string; nome?: string | null; uid?: string };
    if (!payload.lojaId || payload.uid !== identity.user.id || !hasStore(identity, payload.lojaId)) throw new Error("mismatch");
    return { lojaId: payload.lojaId, nome: payload.nome ?? null };
  } catch {
    throw new AppError(400, "ebay_state_invalid");
  }
}

async function exchangeCode(code: string) {
  const credentials = app();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: credentials.ruName }).toString()
  });
  if (response.status === 400 || response.status === 401) throw new AppError(400, "ebay_code_rejected");
  if (!response.ok) throw new AppError(502, "ebay_unavailable");
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; refresh_token_expires_in?: number };
  if (!body.access_token || !body.refresh_token) throw new AppError(502, "ebay_invalid_response");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    // A validade vem do eBay (cerca de 18 meses); nunca uma constante local.
    refreshTokenExpiresAt: new Date(Date.now() + (body.refresh_token_expires_in ?? 0) * 1000)
  };
}

async function fetchEbayUserId(accessToken: string) {
  const response = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml; charset=utf-8"
    },
    body: '<?xml version="1.0" encoding="utf-8"?><GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"/>'
  });
  if (!response.ok) throw new AppError(502, "ebay_unavailable");
  try {
    const root = parseXml(await response.text());
    const userId = textOf(child(root, "User"), "UserID");
    if (!userId || textOf(root, "Ack")?.startsWith("Failure")) throw new Error("no user");
    return userId;
  } catch {
    throw new AppError(502, "ebay_invalid_response");
  }
}

/**
 * Conclui a conexão: troca o código (uso único) pelo token, descobre a conta eBay, cria ou reautoriza a conexão da loja
 * e guarda o refresh token fora do banco. A mesma conta eBay não pode servir a duas lojas.
 */
export async function completeConnection(identity: AuthIdentity, input: z.infer<typeof completeSchema>) {
  const link = input.redirectedUrl ? new URL(input.redirectedUrl).searchParams : null;
  const state = readState(identity, input.state ?? link?.get("state") ?? undefined);
  const rawCode = input.code ?? link?.get("code") ?? "";
  const code = rawCode.includes("%") ? decodeURIComponent(rawCode) : rawCode;
  const tokens = await exchangeCode(code);
  const ebayUserId = await fetchEbayUserId(tokens.accessToken);

  const prepared = await prisma.$transaction(async (tx) => {
    const account = await tx.contaExterna.upsert({
      where: { plataforma_identificadorExterno: { plataforma: "EBAY", identificadorExterno: ebayUserId } },
      update: { nomeExibicao: ebayUserId, status: "ATIVA" },
      create: { plataforma: "EBAY", identificadorExterno: ebayUserId, nomeExibicao: ebayUserId, origemIntegracao: "API", criadoPorId: identity.user.id }
    });
    const existing = await tx.conexaoMarketplace.findFirst({ where: { OR: [{ contaExternaId: account.id }, { provider: "EBAY", identificadorExterno: ebayUserId }] } });
    if (existing && existing.lojaPermitidaId !== state.lojaId) throw new AppError(409, "ebay_account_other_store");
    const connection = existing
      ? await tx.conexaoMarketplace.update({ where: { id: existing.id }, data: { status: "NOT_CONFIGURED", ultimoErroSanitizado: null, version: { increment: 1 } } })
      : await tx.conexaoMarketplace.create({
          data: {
            provider: "EBAY",
            contaExternaId: account.id,
            nome: state.nome ?? ebayUserId,
            identificadorExterno: ebayUserId,
            marketplace: "EBAY_US",
            escopo: "STORE_DEDICATED",
            lojaPermitidaId: state.lojaId,
            status: "NOT_CONFIGURED",
            capabilities: [...marketplaceAdapterRegistry.EBAY.capabilities],
            criadoPorId: identity.user.id
          }
        });
    return connection;
  });

  // O token só vale depois de gravado; se a gravação falhar, a conexão fica "não configurada" e nada é exposto.
  const secretReference = await writeEbayRefreshToken(prepared.id, {
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString()
  });
  const connection = await prisma.$transaction(async (tx) => {
    const updated = await tx.conexaoMarketplace.update({
      where: { id: prepared.id },
      data: { secretReference, status: "ACTIVE", autorizadoEm: new Date(), autorizacaoExpiraEm: tokens.refreshTokenExpiresAt }
    });
    await audit(tx, {
      usuarioId: identity.user.id,
      lojaId: state.lojaId,
      permissionCode: "INTEGRACAO_MARKETPLACE_GERENCIAR",
      action: "MARKETPLACE_CONNECTION_AUTHORIZED",
      entity: "ConexaoMarketplace",
      entityId: updated.id,
      correlationId: updated.id,
      after: { id: updated.id, provider: updated.provider, storeId: updated.lojaPermitidaId, ebayUserId },
      origin: ORIGIN
    });
    return updated;
  });
  return { id: connection.id, nome: connection.nome, ebayUserId, lojaId: state.lojaId, status: connection.status, autorizacaoExpiraEm: connection.autorizacaoExpiraEm };
}
