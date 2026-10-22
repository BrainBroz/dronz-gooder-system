import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { StockStagePage } from "../src/pages/StockStagePage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

const base = {
  version: 3, status: "APROVADA", orderedAt: "2026-10-05T12:00:00.000Z", currency: "USD", cancelled: false,
  account: "existence01", purpose: "LOJA", canApprove: false, canChangeStore: false, store: { id: "store-gooder", slug: "gooder", nome: "Gooder" }
};
const row = (id: string, fase: string, title: string, over: Record<string, unknown> = {}) => ({
  ...base, candidateId: id, orderId: `ORD-${id}`, fase, shippedAt: "2026-10-06T10:00:00.000Z", etapa: null, entregue: false,
  trackings: [{ carrier: "USPS", code: `94001${id}`, entrega: null }],
  items: [{ title, quantity: 2, cancelledQuantity: 0, unitPrice: 100, currency: "USD", imageUrl: null }], ...over
});
const miamiRows = [
  row("a1", "A_CAMINHO_MIAMI", "iPhone 17 Pro"),
  row("e1", "EM_MIAMI", "MacBook Air", { etapa: { chegouMiamiEm: "2026-10-10T12:00:00.000Z", remessa: null, enviadaEm: null, chegouBrasilEm: null } }),
  row("r1", "EM_REMESSA", "Apple Watch", { store: null, etapa: { chegouMiamiEm: "2026-10-10T12:00:00.000Z", remessa: "Remessa Rafa 1", enviadaEm: "2026-10-12T12:00:00.000Z", chegouBrasilEm: null } })
];
const brasilRows = [
  row("b1", "NO_BRASIL", "iPad Pro", { etapa: { chegouMiamiEm: "2026-10-10T12:00:00.000Z", remessa: "Remessa Rafa 1", enviadaEm: "2026-10-12T12:00:00.000Z", chegouBrasilEm: "2026-10-20T12:00:00.000Z" } })
];
const FEED = "/integrations/marketplaces/purchases";
const STAGE = "/integrations/marketplaces/purchases/stage";
const perms = ["BUYER_INGESTION_VISUALIZAR", "MIAMI_RECEBIMENTO_CONFIRMAR", "RECEBIMENTO_CONFIRMAR"];
const mock = (items: unknown[]) =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === FEED) return { data: { items, total: items.length, atualizadoEm: new Date(Date.now() - 3 * 60_000).toISOString() } };
    throw new Error(`GET inesperado: ${url}`);
  });
const params = (get: ReturnType<typeof mock>) => get.mock.calls.filter(([url]) => url === FEED).map(([, config]) => (config as { params: Record<string, unknown> }).params);

describe("Estoque Miami", () => {
  it("lista o que está a caminho, em Miami e em remessa, sem coluna Destino, da loja do topo", async () => {
    const get = mock(miamiRows);
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms });
    expect(await screen.findByText("iPhone 17 Pro")).toBeTruthy();
    expect(params(get)[0]).toMatchObject({ finalidade: "LOJA", fases: "A_CAMINHO_MIAMI,ENTREGUE,EM_MIAMI,EM_REMESSA", lojaId: "store-dronz", limit: 300 });
    const table = screen.getByRole("table", { name: "Estoque Miami" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent).filter(Boolean)).toEqual(["Produto", "Empresa", "Tracking", "Data", "Qtd", "Valor", "Status"]);
    expect(screen.queryByText(/Destino/)).toBeNull();
    expect(within(table).getByText("A CAMINHO DE MIAMI")).toBeTruthy();
    expect(within(table).getByText("EM MIAMI")).toBeTruthy();
    expect(within(table).getByText("A CAMINHO DO BRASIL")).toBeTruthy();
    expect(within(table).getByText("Enviado 06/10/2026")).toBeTruthy();
    expect(within(table).getByText("Chegou 10/10/2026")).toBeTruthy();
    expect(within(table).getByText("Enviada 12/10/2026")).toBeTruthy();
    expect(within(table).getByText("Remessa Rafa 1")).toBeTruthy();
    expect(within(table).getByText("SEM LOJA")).toBeTruthy();
    expect(within(table).getAllByText("US$ 200,00")).toHaveLength(3);
    // um cartão por status
    expect(screen.getAllByText("1 pedido")).toHaveLength(3);
  });

  it("marca a chegada em Miami com a data escolhida", async () => {
    const user = userEvent.setup();
    mock(miamiRows);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { alteradas: 1, iguais: 0 } });
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms });
    await screen.findByText("iPhone 17 Pro");
    expect(screen.queryByRole("button", { name: "Chegou em Miami" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Selecionar pedido ORD-a1" }));
    const dateField = screen.getByLabelText("Data");
    await user.clear(dateField);
    await user.type(dateField, "2026-10-15");
    await user.click(screen.getByRole("button", { name: "Chegou em Miami" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toBe(STAGE);
    expect(put.mock.calls[0]![1]).toEqual({ candidateIds: ["a1"], etapa: "EM_MIAMI", ocorreuEm: "2026-10-15T12:00:00.000Z" });
    expect(await screen.findByText("Pronto: Chegou em Miami (1 compra).")).toBeTruthy();
    expect(screen.queryByText("1 selecionada")).toBeNull();
  });

  it("envia na remessa com o nome dela e desfaz com 'Ainda não chegou'", async () => {
    const user = userEvent.setup();
    mock(miamiRows);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { alteradas: 1, iguais: 0 } });
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms });
    await screen.findByText("MacBook Air");
    await user.click(screen.getByRole("checkbox", { name: "Selecionar pedido ORD-e1" }));
    expect(screen.getByRole("button", { name: "Ainda não chegou" })).toBeTruthy();
    await user.type(screen.getByLabelText("Nome da remessa (opcional)"), "Remessa Rafa 2");
    await user.click(screen.getByRole("button", { name: "Enviar na remessa" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toMatchObject({ candidateIds: ["e1"], etapa: "EM_REMESSA", remessa: "Remessa Rafa 2" });
  });

  it("avisa quando a seleção mistura status e não oferece mudar de etapa", async () => {
    const user = userEvent.setup();
    mock(miamiRows);
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms });
    await screen.findByText("iPhone 17 Pro");
    await user.click(screen.getByRole("checkbox", { name: "Selecionar todas" }));
    expect(screen.getByText("3 selecionadas")).toBeTruthy();
    expect(screen.getByText(/Escolha compras com o mesmo status/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chegou em Miami" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.queryByText("3 selecionadas")).toBeNull();
  });

  it("sem permissão de confirmar, não mostra as ações; filtra por status no navegador", async () => {
    const user = userEvent.setup();
    mock(miamiRows);
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: ["BUYER_INGESTION_VISUALIZAR"] });
    await screen.findByText("iPhone 17 Pro");
    await user.click(screen.getByRole("checkbox", { name: "Selecionar pedido ORD-a1" }));
    expect(screen.getByText("1 selecionada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chegou em Miami" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "Em Miami" }));
    await waitFor(() => expect(screen.queryByText("iPhone 17 Pro")).toBeNull());
    expect(screen.getByText("MacBook Air")).toBeTruthy();
  });

  it("'Todas as lojas' não manda lojaId e a busca vai para a API", async () => {
    const user = userEvent.setup();
    const get = mock(miamiRows);
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms, viewAll: true });
    await screen.findByText("iPhone 17 Pro");
    expect(params(get)[0]).not.toHaveProperty("lojaId");
    await user.type(screen.getByRole("textbox", { name: "Buscar produto, pedido ou rastreio" }), "watch");
    await waitFor(() => expect(params(get).at(-1)).toMatchObject({ busca: "watch" }));
  });
});

describe("Estoque Miami: entrega do Parcel", () => {
  const delivered = (id: string, title: string) =>
    row(id, "ENTREGUE", title, {
      entregue: true,
      trackings: [{ carrier: "UPS", code: `1Z${id}`, entrega: { status: 0, rotulo: "Entregue", evento: "Delivered", local: "Doral, FL", data: "2026-10-12 09:00", consultadoEm: "2026-10-21T12:00:00.000Z" } }]
    });
  const moving = row("m1", "A_CAMINHO_MIAMI", "Pixel 10", {
    trackings: [{ carrier: "FEDEX", code: "FDX-m1", entrega: { status: 4, rotulo: "Saiu para entrega", evento: null, local: null, data: null, consultadoEm: "2026-10-21T12:00:00.000Z" } }]
  });

  it("mostra a situação da entrega ao lado do rastreio e seleciona de uma vez as já entregues", async () => {
    const user = userEvent.setup();
    mock([delivered("d1", "Galaxy S26"), delivered("d2", "Echo Show"), moving, ...miamiRows.slice(1)]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { alteradas: 2, iguais: 0 } });
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: perms });
    await screen.findByText("Galaxy S26");
    expect(within(screen.getByRole("table", { name: "Estoque Miami" })).getAllByText("Entregue")).toHaveLength(2);
    expect(within(screen.getByRole("table", { name: "Estoque Miami" })).getAllByText("ENTREGUE")).toHaveLength(2); // a situação da compra também passa a Entregue
    expect(screen.getByText("Saiu para entrega")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Selecionar entregues (2)" }));
    expect(screen.getByText("2 selecionadas")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Chegou em Miami" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toMatchObject({ candidateIds: ["d1", "d2"], etapa: "EM_MIAMI" });
  });

  it("sem entregas conhecidas ou sem permissão, não oferece 'Selecionar entregues'", async () => {
    mock([moving, delivered("d1", "Galaxy S26")]);
    renderWithProviders(<StockStagePage mode="MIAMI" />, { permissions: ["BUYER_INGESTION_VISUALIZAR"] });
    await screen.findByText("Galaxy S26");
    expect(screen.queryByRole("button", { name: /Selecionar entregues/ })).toBeNull();
  });
});

describe("Estoque Brasil", () => {
  it("lista só o que chegou ao Brasil, com a remessa, e deixa voltar para a remessa", async () => {
    const user = userEvent.setup();
    const get = mock(brasilRows);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { alteradas: 1, iguais: 0 } });
    renderWithProviders(<StockStagePage mode="BRASIL" />, { permissions: perms });
    expect(await screen.findByText("iPad Pro")).toBeTruthy();
    expect(params(get)[0]).toMatchObject({ fases: "NO_BRASIL" });
    expect(screen.getByRole("heading", { name: "Estoque Brasil" })).toBeTruthy();
    expect(screen.getByText("Chegou 20/10/2026")).toBeTruthy();
    expect(screen.getByText("Remessa Rafa 1")).toBeTruthy();
    expect(screen.getByText("ESTOQUE BRASIL")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull(); // uma fase só
    await user.click(screen.getByRole("checkbox", { name: "Selecionar pedido ORD-b1" }));
    await user.click(screen.getByRole("button", { name: "Voltar para a remessa" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toMatchObject({ candidateIds: ["b1"], etapa: "EM_REMESSA" });
  });
});
