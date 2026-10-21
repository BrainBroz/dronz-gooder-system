import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { api } from "../src/api/client";
import { EbayCallbackPage, MarketplaceConnectionsPage } from "../src/pages/MarketplaceConnectionsPage";
import { renderWithProviders } from "./render";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const connection = {
  id: "c1", provider: "EBAY", name: "Conta Gooder", purpose: "LOJA", scope: "STORE_DEDICATED", account: { name: "gooder_buyer", externalIdentifier: "gooder_buyer" },
  allowedStore: { id: "store-gooder", name: "Gooder" }, status: "ACTIVE", authorizationExpiresAt: "2028-04-01T12:00:00.000Z", lastSyncAt: null, lastError: null,
  allowedActions: ["SYNC_CONNECTION"]
};
const mockList = () =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/integrations/marketplaces/connections") return { data: [connection] };
    throw new Error(`GET inesperado: ${url}`);
  });
const perms = ["INTEGRACAO_MARKETPLACE_VISUALIZAR", "INTEGRACAO_MARKETPLACE_GERENCIAR", "INTEGRACAO_MARKETPLACE_SINCRONIZAR"];

describe("Integrações: contas do eBay por loja", () => {
  it("lista as contas por loja e sincroniza com chave de idempotência", async () => {
    const user = userEvent.setup();
    const get = mockList();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<MarketplaceConnectionsPage />, { permissions: perms });
    const gooder = (await screen.findByRole("heading", { name: "Gooder" })).closest("div")!.parentElement!;
    expect(within(gooder).getByText(/conta eBay gooder_buyer/)).toBeTruthy();
    expect(within(gooder).getByText("Conectada")).toBeTruthy();
    expect(screen.getAllByText("Nenhuma conta do eBay conectada a esta loja.")).toHaveLength(1);
    expect(get.mock.calls[0]![1]).toMatchObject({ params: { provider: "EBAY" } });

    await user.click(within(gooder).getByRole("button", { name: "Sincronizar agora" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![0]).toBe("/integrations/marketplaces/connections/c1/sync-runs");
    expect((post.mock.calls[0]![2] as { headers: Record<string, string> }).headers["Idempotency-Key"]).toBeTruthy();
  });

  it("conecta uma conta: pede a URL do eBay para a loja e vai para ela; também conclui colando o endereço", async () => {
    const user = userEvent.setup();
    mockList();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost:5173", assign });
    const post = vi.spyOn(api, "post").mockImplementation(async (url) =>
      url.endsWith("/connect-intents") ? { data: { url: "https://auth.ebay.com/oauth2/authorize?state=abc" } } : { data: { ebayUserId: "x" } }
    );
    renderWithProviders(<MarketplaceConnectionsPage />, { permissions: perms });
    const dronz = (await screen.findByRole("heading", { name: "Dronz" })).closest("div")!.parentElement!;
    await user.type(within(dronz).getByLabelText("Nome da conta (opcional)"), "Conta Dronz");
    await user.click(within(dronz).getByLabelText("Conta pessoal (compras pessoais)"));
    await user.click(within(dronz).getByRole("button", { name: "Conectar conta eBay" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.ebay.com/oauth2/authorize?state=abc"));
    expect(post.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/ebay/connect-intents", { lojaId: "store-dronz", nome: "Conta Dronz", finalidade: "PESSOAL" }]);

    await user.type(within(dronz).getByLabelText(/Cole aqui o endereço/), "https://painel.exemplo.com/cb?code=abc&state=def");
    await user.click(within(dronz).getByRole("button", { name: "Concluir conexão" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]!.slice(0, 2)).toEqual(["/integrations/marketplaces/ebay/connections/complete", { redirectedUrl: "https://painel.exemplo.com/cb?code=abc&state=def", state: "abc" }]);
  });

  it("conta compartilhada entre lojas: conecta sem loja, não oferece 'pessoal' e importa o histórico desde uma data", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockResolvedValue({ data: [{ ...connection, id: "c9", name: "Existence", scope: "SHARED", allowedStore: null, account: { name: "existence01", externalIdentifier: "existence01" } }] });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost:5173", assign });
    const post = vi.spyOn(api, "post").mockImplementation(async (url) =>
      url.endsWith("/connect-intents") ? { data: { url: "https://auth.ebay.com/oauth2/authorize?state=zzz" } } : { data: {} }
    );
    renderWithProviders(<MarketplaceConnectionsPage />, { permissions: perms });
    const shared = (await screen.findByRole("heading", { name: "Contas compartilhadas (várias lojas)" })).closest("div")!.parentElement!;
    expect(within(shared).getByText(/conta eBay existence01/)).toBeTruthy();
    expect(within(shared).queryByLabelText("Conta pessoal (compras pessoais)")).toBeNull();

    await user.type(within(shared).getByLabelText("Nome da conta (opcional)"), "Existence");
    await user.click(within(shared).getByRole("button", { name: "Conectar conta eBay" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.ebay.com/oauth2/authorize?state=zzz"));
    expect(post.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/ebay/connect-intents", { compartilhada: true, nome: "Existence" }]);

    post.mockClear();
    fireEvent.change(within(shared).getByLabelText("Importar histórico desde"), { target: { value: "2026-08-01" } });
    await user.click(within(shared).getByRole("button", { name: "Importar histórico" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, { replay: boolean; from: string; to: string }];
    expect(url).toBe("/integrations/marketplaces/connections/c9/sync-runs");
    expect(body.replay).toBe(true);
    expect(new Date(body.from).getMonth()).toBe(7);
    expect(Date.parse(body.to)).toBeGreaterThan(Date.parse(body.from));
  });

  it("marca a conta pessoal na lista", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [{ ...connection, id: "c2", name: "Minha conta", purpose: "PESSOAL" }] });
    renderWithProviders(<MarketplaceConnectionsPage />, { permissions: perms });
    expect(await screen.findByText("Pessoal")).toBeTruthy();
  });

  it("sem permissão de gerenciar não há botão de conectar", async () => {
    mockList();
    renderWithProviders(<MarketplaceConnectionsPage />, { permissions: ["INTEGRACAO_MARKETPLACE_VISUALIZAR"] });
    await screen.findByRole("heading", { name: "Gooder" });
    expect(screen.queryByRole("button", { name: "Conectar conta eBay" })).toBeNull();
  });
});

describe("Retorno do eBay", () => {
  const renderCallback = (query: string) =>
    renderWithProviders(<Routes><Route path="/integracoes/ebay/callback" element={<EbayCallbackPage />} /></Routes>, { route: `/integracoes/ebay/callback${query}`, permissions: perms });

  it("troca o código uma única vez e mostra a conta conectada", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ebayUserId: "gooder_buyer" } });
    renderCallback("?code=abc123&state=state123");
    expect(await screen.findByText(/Conta gooder_buyer conectada com sucesso/)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/ebay/connections/complete", { code: "abc123", state: "state123" }]);
  });

  it("explica o erro devolvido pela API e a falta de código", async () => {
    vi.spyOn(api, "post").mockRejectedValue({ isAxiosError: true, response: { data: { error: "ebay_code_rejected" } } });
    const first = renderCallback("?code=abc123&state=state123");
    expect(await screen.findByText(/recusou o código/)).toBeTruthy();
    first.unmount();
    renderCallback("");
    expect(await screen.findByText(/não devolveu o código/)).toBeTruthy();
  });
});
