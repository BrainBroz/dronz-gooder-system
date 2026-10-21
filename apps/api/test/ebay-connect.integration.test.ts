import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";
const APP = { clientId: "app-client-id", clientSecret: "app-client-secret", ruName: "Teste-Ru-Name" };
const secretDir = mkdtempSync(path.join(os.tmpdir(), "ebay-secrets-"));
process.env.MARKETPLACE_SECRET_DIR = secretDir;

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
let secretProvider: typeof import("../src/modules/marketplace-integrations/marketplace-integrations.secrets").secretProvider;
const EBAY_USER = "test-gooder-buyer";
const EBAY_PERSONAL = "test-personal-buyer";
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  ({ secretProvider } = await import("../src/modules/marketplace-integrations/marketplace-integrations.secrets"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.env.MARKETPLACE_EBAY_APP = JSON.stringify(APP);
  const accounts = await prisma.contaExterna.findMany({ where: { identificadorExterno: { in: [EBAY_USER, EBAY_PERSONAL] } }, select: { id: true } });
  const ids = accounts.map((account) => account.id);
  const candidates = await prisma.buyerPurchaseCandidate.findMany({ where: { contaExternaId: { in: ids } }, select: { id: true } });
  const candidateIds = candidates.map((c) => c.id);
  await prisma.buyerReconciliationConflict.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await prisma.buyerApprovalDecision.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await prisma.buyerEvidenceLink.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await prisma.buyerPurchaseCandidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.buyerEvidenceItem.deleteMany({ where: { evidence: { contaExternaId: { in: ids } } } });
  await prisma.buyerEvidence.deleteMany({ where: { contaExternaId: { in: ids } } });
  await prisma.conexaoMarketplace.deleteMany({ where: { contaExternaId: { in: ids } } });
  await prisma.contaExterna.deleteMany({ where: { id: { in: ids } } });
});
afterAll(async () => {
  rmSync(secretDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function setup() {
  process.env.MARKETPLACE_EBAY_APP = JSON.stringify(APP);
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  const stores = login.body.stores as { id: string; slug: string }[];
  const auth = { Authorization: `Bearer ${login.body.accessToken}` };
  return { app, auth, dronz: stores.find((s) => s.slug === "dronz")!, gooder: stores.find((s) => s.slug === "gooder")! };
}
const intent = async (ctx: Awaited<ReturnType<typeof setup>>, lojaId: string, nome?: string, finalidade?: string) => {
  const response = await request(ctx.app).post("/integrations/marketplaces/ebay/connect-intents").set(ctx.auth).send({ lojaId, nome, finalidade });
  return { response, state: response.status === 200 ? new URL(response.body.url).searchParams.get("state")! : "" };
};
const ebayReplies = (code: string, calls: { url: string; init: RequestInit }[] = [], user = EBAY_USER) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.includes("/oauth2/token"))
      return code === "ok"
        ? new Response(JSON.stringify({ access_token: "ACCESS-TOKEN", refresh_token: "REFRESH-TOKEN-SECRET", refresh_token_expires_in: 47304000, expires_in: 7200 }))
        : new Response("{}", { status: 400 });
    return new Response(`<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>${user}</UserID></User></GetUserResponse>`);
  });

describe("conectar conta eBay pela tela", () => {
  it("monta a URL de consentimento com state assinado e exige loja da identidade e aplicativo configurado", async () => {
    const ctx = await setup();
    const { response, state } = await intent(ctx, ctx.gooder.id, "Conta Gooder");
    expect(response.status).toBe(200);
    const url = new URL(response.body.url);
    expect(url.origin + url.pathname).toBe("https://auth.ebay.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: APP.clientId, redirect_uri: APP.ruName, response_type: "code", prompt: "login" });
    expect(url.searchParams.get("scope")).toBe("https://api.ebay.com/oauth/api_scope");
    expect(jwt.verify(state, "change-me-access", { audience: "ebay-connect" })).toMatchObject({ lojaId: ctx.gooder.id, nome: "Conta Gooder" });
    expect(response.text).not.toContain(APP.clientSecret);

    expect((await intent(ctx, "cmvh0c43q0000j5p9f9qsgnmt")).response.status).toBe(403);
    delete process.env.MARKETPLACE_EBAY_APP;
    expect((await intent(ctx, ctx.gooder.id)).response.body.error).toBe("ebay_app_not_configured");
  });

  it("conclui com o endereço devolvido pelo eBay, guarda o token fora do banco e reautoriza sem duplicar", async () => {
    const ctx = await setup();
    const { state } = await intent(ctx, ctx.gooder.id, "Conta Gooder");
    const calls: { url: string; init: RequestInit }[] = [];
    ebayReplies("ok", calls);
    const redirectedUrl = `https://painel.exemplo.com/callback?code=${encodeURIComponent("v^1.1#i^1#code")}&state=${encodeURIComponent(state)}&expires_in=299`;
    const done = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ redirectedUrl });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ nome: "Conta Gooder", ebayUserId: EBAY_USER, lojaId: ctx.gooder.id, status: "ACTIVE" });

    const tokenCall = calls.find((c) => c.url.includes("/oauth2/token"))!;
    expect(String(tokenCall.init.body)).toContain("grant_type=authorization_code");
    expect(new URLSearchParams(String(tokenCall.init.body)).get("code")).toBe("v^1.1#i^1#code");
    expect(new URLSearchParams(String(tokenCall.init.body)).get("redirect_uri")).toBe(APP.ruName);
    expect((tokenCall.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${APP.clientId}:${APP.clientSecret}`).toString("base64")}`);

    const row = await prisma.conexaoMarketplace.findFirstOrThrow({ where: { identificadorExterno: EBAY_USER }, include: { contaExterna: true } });
    expect(row).toMatchObject({ lojaPermitidaId: ctx.gooder.id, escopo: "STORE_DEDICATED", status: "ACTIVE", secretReference: `file:ebay-${row.id}` });
    expect(row.autorizacaoExpiraEm!.getTime()).toBeGreaterThan(Date.now() + 400 * 86_400_000);
    expect(JSON.stringify(row)).not.toContain("REFRESH-TOKEN-SECRET");
    expect(row.contaExterna).toMatchObject({ plataforma: "EBAY", nomeExibicao: EBAY_USER, origemIntegracao: "API" });
    const file = path.join(secretDir, `ebay-${row.id}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("REFRESH-TOKEN-SECRET");
    // O adapter lê token + credenciais do aplicativo juntos, e só quando o aplicativo está configurado.
    expect(JSON.parse((await secretProvider.get(row.secretReference!))!)).toEqual({ clientId: APP.clientId, clientSecret: APP.clientSecret, refreshToken: "REFRESH-TOKEN-SECRET" });

    // Reautorizar a mesma conta na mesma loja reaproveita a conexão.
    const second = await intent(ctx, ctx.gooder.id);
    const again = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state: second.state, code: "v%5E1.1%23outro-codigo" });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(done.body.id);
    expect(await prisma.conexaoMarketplace.count({ where: { identificadorExterno: EBAY_USER } })).toBe(1);

    // A mesma conta eBay não serve a duas lojas.
    const other = await intent(ctx, ctx.dronz.id);
    const conflict = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state: other.state, code: "codigo-qualquer-valido" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("ebay_account_other_store");
  });

  it("recusa state inválido ou de outra pessoa e código recusado pelo eBay, sem criar conexão", async () => {
    const ctx = await setup();
    const fetchSpy = ebayReplies("ok");
    const bad = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state: "x".repeat(40), code: "codigo-qualquer-valido" });
    expect(bad.body.error).toBe("ebay_state_invalid");
    const foreign = jwt.sign({ lojaId: ctx.gooder.id, nome: null, uid: "outro-usuario" }, "change-me-access", { audience: "ebay-connect", expiresIn: "15m" });
    expect((await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state: foreign, code: "codigo-qualquer-valido" })).body.error).toBe("ebay_state_invalid");
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    ebayReplies("rejeitado");
    const { state } = await intent(ctx, ctx.gooder.id);
    const rejected = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state, code: "codigo-qualquer-valido" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("ebay_code_rejected");
    expect(await prisma.conexaoMarketplace.count({ where: { identificadorExterno: EBAY_USER } })).toBe(0);
    expect((await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").send({ state, code: "codigo-qualquer-valido" })).status).toBe(401);
  });

  it("conta pessoal: fica separada das compras da loja na revisão, mas atribuível à Gooder", async () => {
    const ctx = await setup();
    const connect = async (user: string, finalidade: "LOJA" | "PESSOAL") => {
      vi.restoreAllMocks();
      ebayReplies("ok", [], user);
      const { state } = await intent(ctx, ctx.gooder.id, user, finalidade);
      const done = await request(ctx.app).post("/integrations/marketplaces/ebay/connections/complete").set(ctx.auth).send({ state, code: "codigo-qualquer-valido" });
      expect(done.status).toBe(201);
      expect(done.body.finalidade).toBe(finalidade);
      return prisma.contaExterna.findFirstOrThrow({ where: { identificadorExterno: user } });
    };
    const loja = await connect(EBAY_USER, "LOJA");
    const pessoal = await connect(EBAY_PERSONAL, "PESSOAL");
    const row = await prisma.conexaoMarketplace.findFirstOrThrow({ where: { contaExternaId: pessoal.id } });
    expect(row).toMatchObject({ finalidade: "PESSOAL", lojaPermitidaId: ctx.gooder.id, escopo: "STORE_DEDICATED" });
    const listed = await request(ctx.app).get("/integrations/marketplaces/connections").set(ctx.auth).query({ provider: "EBAY", lojaId: ctx.gooder.id });
    expect(listed.body.filter((c: { externalIdentifier: string }) => c.externalIdentifier.startsWith("test-")).map((c: { purpose: string }) => c.purpose).sort()).toEqual(["LOJA", "PESSOAL"]);

    // Uma compra em cada conta; a revisão separa por finalidade.
    const now = new Date().toISOString();
    for (const account of [loja, pessoal]) {
      const evidence = await request(ctx.app)
        .post("/integrations/marketplaces/buyer-evidence")
        .set(ctx.auth)
        .set("idempotency-key", `ebay-${account.id}`)
        .send({
          source: "MANUAL", provider: "EBAY", contaExternaId: account.id, externalEvidenceId: `ev-${account.id}`,
          order: {
            externalOrderId: `TEST-${account.id}`, reference: `TEST-${account.id}`, orderedAt: now, updatedAt: now, currency: "USD", cancelled: false,
            items: [{ title: "Item de teste", quantity: 1, cancelledQuantity: 0, refundedQuantity: 0, unitPrice: 10, currency: "USD" }], shipments: []
          }
        });
      expect(evidence.status).toBe(201);
    }
    const accountOf = async (finalidade?: string) => {
      const response = await request(ctx.app).get("/integrations/marketplaces/buyer-candidates").set(ctx.auth).query({ limit: 100, ...(finalidade ? { finalidade } : {}) });
      expect(response.status).toBe(200);
      return (response.body.items as { externalOrderId?: string; reference?: string; contaExternaId?: string }[]).map((item) => JSON.stringify(item));
    };
    const mine = (items: string[], id: string) => items.filter((item) => item.includes(id)).length;
    const personal = await accountOf("PESSOAL");
    const store = await accountOf("LOJA");
    const all = await accountOf();
    expect([mine(personal, pessoal.id), mine(personal, loja.id)]).toEqual([1, 0]);
    expect([mine(store, pessoal.id), mine(store, loja.id)]).toEqual([0, 1]);
    expect([mine(all, pessoal.id), mine(all, loja.id)]).toEqual([1, 1]);
  });
});
