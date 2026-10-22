import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { PurchasesPage, monthLabel } from "../src/pages/PurchasesPage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

const base = {
  version: 3, status: "AGUARDANDO_APROVACAO", orderedAt: "2026-10-15T12:00:00.000Z", currency: "USD", cancelled: false,
  account: "impetit", purpose: "LOJA", shippedAt: null, canApprove: true, canChangeStore: false
};
const rows = [
  { ...base, candidateId: "c1", orderId: "13-15311-66647", fase: "A_CAMINHO_MIAMI", store: { id: "store-gooder", slug: "gooder", nome: "Gooder" },
    trackings: [{ carrier: "USPS", code: "9434908106245702187606" }], shippedAt: "2026-10-16T10:00:00.000Z",
    items: [{ title: "Apple iPhone 17 Pro Max 1 TB", quantity: 2, cancelledQuantity: 0, unitPrice: 900, currency: "USD", imageUrl: "https://i.ebayimg.com/a.jpg" }] },
  { ...base, candidateId: "c2", orderId: "19-15300-00124", version: 5, fase: "COMPRADO", store: null, trackings: [],
    items: [{ title: "Nintendo Switch 2", quantity: 1, cancelledQuantity: 0, unitPrice: 450, currency: "USD", imageUrl: null }] },
  { ...base, candidateId: "c3", orderId: "11-15264-26580", fase: "CANCELADO", cancelled: true, canApprove: false, store: { id: "store-dronz", slug: "dronz", nome: "Dronz" }, trackings: [],
    items: [{ title: "Camiseta ALO", quantity: 1, cancelledQuantity: 1, unitPrice: 60, currency: "USD", imageUrl: null }] }
];
const lot = { mes: "2026-10", pedidos: 3, unidades: 3, custoUsd: 1350, cancelados: 1, aConfirmar: 2, semLoja: 1, porLoja: { gooder: 1, dronz: 1 } };
const perms = ["BUYER_INGESTION_VISUALIZAR", "BUYER_INGESTION_APROVAR", "COMPRAS_IMPORTADAS_VISUALIZAR", "COMPRAS_IMPORTADAS_IMPORTAR"];
const FEED = "/integrations/marketplaces/purchases";
const LOTS = "/integrations/marketplaces/purchases/lots";
// Controle de compras (venda projetada e markup) das linhas que já têm preço de venda informado.
const control = [
  { numeroPedido: "13-15311-66647", titulo: "Apple iPhone 17 Pro Max 1 TB", entrada: { vendaUnitariaBrl: "7500" }, calculo: { total: { custo: "9000", vendaBruta: "15000" }, indicadores: { resultadoSobreCustoPercentual: "21.5" } } },
  { numeroPedido: "19-15300-00124", titulo: "Nintendo Switch 2", entrada: { vendaUnitariaBrl: null }, calculo: { total: { custo: null, vendaBruta: null }, indicadores: { resultadoSobreCustoPercentual: null } } }
];
const mock = (feedRows: unknown[] = rows) =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === LOTS) return { data: { lotes: [lot], semLojaTotal: 1, atualizadoEm: new Date().toISOString() } };
    if (url === FEED) return { data: { items: feedRows, total: feedRows.length, atualizadoEm: new Date(Date.now() - 5 * 60_000).toISOString() } };
    if (url === "/purchase-control") return { data: { linhas: control } };
    if (String(url).startsWith("/imported-purchases")) return { data: { items: [], page: 1, limit: 100, total: 0 } };
    throw new Error(`GET inesperado: ${url}`);
  });
const callsTo = (get: ReturnType<typeof mock>, url: string) => get.mock.calls.filter(([target]) => target === url).map(([, config]) => (config as { params: Record<string, unknown> }).params);
const MONTH = { route: "/compras?mes=2026-10", permissions: perms };

describe("Compras: lotes por mês", () => {
  it("abre nos lotes, só com o seletor do topo (sem descrição nem botões de filtro), e o mês abre o resumo", async () => {
    const user = userEvent.setup();
    const get = mock();
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    const card = await screen.findByRole("button", { name: `Abrir lote ${monthLabel("2026-10")}` });
    expect(within(card).getByText("US$ 1.350,00")).toBeTruthy();
    expect(within(card).getByText("GOODER 1")).toBeTruthy();
    expect(within(card).getByText("1 sem loja")).toBeTruthy();
    expect(within(card).getByText("2 a confirmar")).toBeTruthy();
    expect(within(card).getByText("1 cancelado")).toBeTruthy();
    // sem a linha de filtros por loja/situação: a loja vem do seletor do topo
    expect(screen.queryByRole("button", { name: "Gooder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmadas" })).toBeNull();
    expect(callsTo(get, LOTS)[0]).toEqual({ finalidade: "LOJA", lojaId: "store-dronz" });
    expect(callsTo(get, FEED)).toHaveLength(0);

    await user.click(card);
    expect(await screen.findByText("Apple iPhone 17 Pro Max 1 TB")).toBeTruthy();
    expect(callsTo(get, FEED)[0]).toMatchObject({ finalidade: "LOJA", mes: "2026-10", lojaId: "store-dronz", limit: 300 });
    expect(callsTo(get, FEED)[0]).not.toHaveProperty("status");
  });

  it("'Todas as lojas' não manda lojaId; a loja escolhida no topo filtra tudo", async () => {
    const get = mock();
    renderWithProviders(<PurchasesPage />, { permissions: perms, viewAll: true });
    await screen.findByRole("button", { name: /Abrir lote/ });
    expect(callsTo(get, LOTS)[0]).toEqual({ finalidade: "LOJA" });
    expect(screen.getByText(/Todas as lojas/)).toBeTruthy();
    expect(screen.queryByText(/ainda está sem loja/)).toBeNull();
  });

  it("com uma loja no topo, avisa das compras sem loja e leva para Todos", async () => {
    const user = userEvent.setup();
    const get = mock();
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    expect(await screen.findByText(/1 compra confirmada ainda está sem loja/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ver em Todos" }));
    await waitFor(() => expect(callsTo(get, LOTS).at(-1)).toEqual({ finalidade: "LOJA" }));
    expect(screen.queryByText(/ainda está sem loja/)).toBeNull();
  });

  it("sem lotes, avisa", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { lotes: [], semLojaTotal: 0, atualizadoEm: null } });
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    expect(await screen.findByText("Nenhuma compra neste filtro.")).toBeTruthy();
  });
});

describe("Compras: resumo do lote", () => {
  it("mostra produto com foto, empresa, quantidade, custo, status e rastreio com operadora", async () => {
    mock();
    renderWithProviders(<PurchasesPage />, MONTH);
    expect(await screen.findByText("Apple iPhone 17 Pro Max 1 TB")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Compras do lote" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(
      ["Produto", "Empresa", "Qtd", "Custo unid.", "Venda proj.", "Markup", "Status", "Tracking"]
    );
    expect(within(table).getByText("A CAMINHO DE MIAMI")).toBeTruthy();
    expect(within(table).getByText("COMPRADO")).toBeTruthy();
    expect(within(table).getByText("CANCELADO")).toBeTruthy();
    expect(within(table).getByText("USPS")).toBeTruthy();
    expect(within(table).getByText("9434908106245702187606")).toBeTruthy();
    expect(within(table).getAllByText("Vendedor ainda não enviou")).toHaveLength(1); // a cancelada não mostra isso
    expect(within(table).getByText("GOODER")).toBeTruthy();
        expect(document.querySelector('img[src="https://i.ebayimg.com/a.jpg"]')).toBeTruthy();
    expect(within(table).getAllByText("sem foto")).toHaveLength(2);
    expect(screen.queryByText(/Merchant|Progresso|Idade/)).toBeNull();
    // totais do lote ignoram a compra cancelada
    expect(screen.getByText("US$ 2.250,00")).toBeTruthy();
  });

  it("mostra a venda projetada e o markup do Controle de compras, e o link para o controle detalhado do mês", async () => {
    const get = mock();
    renderWithProviders(<PurchasesPage />, MONTH);
    const table = await screen.findByRole("table", { name: "Compras do lote" });
    const iphone = within(table).getByText("Apple iPhone 17 Pro Max 1 TB").closest("tr")!;
    expect(within(iphone).getByText(/7\.500,00/)).toBeTruthy();
    expect(within(iphone).getByText("21,50%")).toBeTruthy();
    // sem preço de venda informado, continua "—"
    const switchRow = within(table).getByText("Nintendo Switch 2").closest("tr")!;
    expect(within(switchRow).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Controle detalhado" }).getAttribute("href")).toBe("/compras/controle?mes=2026-10");
    const call = get.mock.calls.find(([url]) => url === "/purchase-control")!;
    expect(call[1]).toMatchObject({ params: { ano: 2026, mes: 10 }, headers: { "x-store-id": "store-dronz" } });
  });

  it("copia o rastreio", async () => {
    const user = userEvent.setup();
    mock();
    renderWithProviders(<PurchasesPage />, MONTH);
    await screen.findByText("9434908106245702187606");
    await user.click(screen.getByRole("button", { name: "Copiar rastreio 9434908106245702187606" }));
    expect(await navigator.clipboard.readText()).toBe("9434908106245702187606");
    expect(await screen.findByRole("button", { name: "Copiar rastreio 9434908106245702187606" })).toHaveProperty("textContent", "✓");
  });

  it("filtra por status e busca pela API", async () => {
    const user = userEvent.setup();
    const get = mock();
    renderWithProviders(<PurchasesPage />, MONTH);
    await screen.findByText("Nintendo Switch 2");
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "Cancelado" }));
    await waitFor(() => expect(screen.queryByText("Nintendo Switch 2")).toBeNull());
    expect(screen.getByText("Camiseta ALO")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Buscar produto, pedido ou rastreio" }), "iphone");
    await waitFor(() => expect(callsTo(get, FEED).at(-1)).toMatchObject({ busca: "iphone", mes: "2026-10" }));
  });

  it("confirma uma compra com a versão certa e todas de uma vez", async () => {
    const user = userEvent.setup();
    mock();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchasesPage />, MONTH);
    await screen.findByText("Nintendo Switch 2");
    const buttons = screen.getAllByRole("button", { name: "Confirmar compra" });
    expect(buttons).toHaveLength(2); // a cancelada não tem confirmação
    await user.click(buttons[1]!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/buyer-candidates/c2/decision", { decision: "APROVAR", expectedVersion: 5 }]);
    expect((post.mock.calls[0]![2] as { headers: Record<string, string> }).headers["idempotency-key"]).toBeTruthy();

    post.mockClear();
    await user.click(screen.getByRole("button", { name: "Confirmar todas (2)" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      "/integrations/marketplaces/buyer-candidates/c1/decision",
      "/integrations/marketplaces/buyer-candidates/c2/decision"
    ]);
  });

  it("troca para as compras pessoais", async () => {
    const user = userEvent.setup();
    const get = mock();
    renderWithProviders(<PurchasesPage />, { ...MONTH, permissions: ["BUYER_INGESTION_VISUALIZAR"] });
    await screen.findByText("Nintendo Switch 2");
    await user.click(screen.getByRole("button", { name: "Pessoais" }));
    await waitFor(() => expect(callsTo(get, FEED).at(-1)).toMatchObject({ finalidade: "PESSOAL" }));
  });

  it("mostra as bolinhas das lojas só onde pode trocar e atribui a compra inteira à loja clicada", async () => {
    const user = userEvent.setup();
    const shared = { ...base, candidateId: "s1", orderId: "SHARED-1", status: "APROVADA", fase: "COMPRADO", canApprove: false, canChangeStore: true, store: null, trackings: [],
      items: [{ title: "Mac mini M4", quantity: 1, cancelledQuantity: 0, unitPrice: 600, currency: "USD", imageUrl: null }] };
    const fixed = { ...shared, candidateId: "s2", orderId: "FIXED-2", canChangeStore: false, store: { id: "store-gooder", slug: "gooder", nome: "Gooder" },
      items: [{ title: "Echo Dot", quantity: 1, cancelledQuantity: 0, unitPrice: 30, currency: "USD", imageUrl: null }] };
    mock([shared, fixed]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchasesPage />, { ...MONTH, permissions: [...perms, "COMPRAS_IMPORTADAS_ATRIBUIR"] });
    await screen.findByText("Mac mini M4");
    expect(screen.getByText("Escolha a loja")).toBeTruthy();
    // só a compra de conta compartilhada tem as bolinhas; a da conta dedicada mostra a etiqueta fixa
    expect(screen.getAllByRole("button", { name: "Atribuir à Dronz" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Atribuir à Dronz" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/purchases/s1/store", { lojaId: "store-dronz" }]);
  });
});

describe("Compras: atualizar agora", () => {
  it("pede a atualização ao eBay, mostra o resultado e recarrega; sem permissão não há botão", async () => {
    const user = userEvent.setup();
    const get = mock();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { resultados: [{ conexao: "Existence", status: "ACTIVE", criados: 2, atualizados: 1 }] } });
    renderWithProviders(<PurchasesPage />, { permissions: [...perms, "INTEGRACAO_MARKETPLACE_SINCRONIZAR"] });
    await screen.findByRole("button", { name: /Abrir lote/ });
    expect(screen.getByText(/atualizado agora há pouco/)).toBeTruthy();
    const before = callsTo(get, LOTS).length;
    await user.click(screen.getByRole("button", { name: "Atualizar agora" }));
    expect(await screen.findByText("Existence: 2 com novidades, 1 sem mudança")).toBeTruthy();
    expect(post.mock.calls[0]![0]).toBe("/integrations/marketplaces/purchases/refresh");
    await waitFor(() => expect(callsTo(get, LOTS).length).toBeGreaterThan(before));
  });

  it("mostra o resultado do Parcel e explica quando ele recusa a chave", async () => {
    const user = userEvent.setup();
    mock();
    vi.spyOn(api, "post").mockResolvedValue({
      data: { resultados: [{ conexao: "Existence", status: "SUCCEEDED", criados: 0, atualizados: 3 }, { conexao: "Parcel (rastreio)", status: "FALHOU", erro: "parcel_rejected" }] }
    });
    renderWithProviders(<PurchasesPage />, { permissions: [...perms, "INTEGRACAO_MARKETPLACE_SINCRONIZAR"] });
    await user.click(await screen.findByRole("button", { name: "Atualizar agora" }));
    expect(await screen.findByText(/Parcel \(rastreio\): o Parcel recusou a chave/)).toBeTruthy();
  });

  it("explica quando a autorização do eBay expirou", async () => {
    const user = userEvent.setup();
    mock();
    vi.spyOn(api, "post").mockResolvedValue({ data: { resultados: [{ conexao: "impetit", status: "AUTHORIZATION_EXPIRED", erro: "marketplace_authorization_expired" }] } });
    renderWithProviders(<PurchasesPage />, { permissions: [...perms, "INTEGRACAO_MARKETPLACE_SINCRONIZAR"] });
    await user.click(await screen.findByRole("button", { name: "Atualizar agora" }));
    expect(await screen.findByText(/impetit: autorização do eBay expirada: reconecte em Integrações/)).toBeTruthy();
  });

  it("sem permissão de sincronizar, não mostra o botão", async () => {
    mock();
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    await screen.findByRole("button", { name: /Abrir lote/ });
    expect(screen.queryByRole("button", { name: "Atualizar agora" })).toBeNull();
  });
});
