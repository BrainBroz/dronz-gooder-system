import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { PurchasesPage } from "../src/pages/PurchasesPage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

const manualRow = (over: Record<string, unknown> = {}) => ({
  candidateId: "m_cabc123def456", version: 1, status: "APROVADA", fase: "COMPRADO", orderId: "SHOP-1", orderedAt: "2026-10-18T12:00:00.000Z", currency: "USD", cancelled: false,
  account: "Shop.com", purpose: "LOJA", store: { id: "store-gooder", slug: "gooder", nome: "Gooder" }, shippedAt: null, etapa: null, entregue: false,
  manual: true, canEditTracking: true, canApprove: false, canChangeStore: true, trackings: [],
  items: [{ title: "Aspirador Dyson", quantity: 2, cancelledQuantity: 0, unitPrice: 349.99, currency: "USD", imageUrl: null }], ...over
});
const lot = { mes: "2026-10", pedidos: 1, unidades: 2, custoUsd: 699.98, cancelados: 0, aConfirmar: 0, semLoja: 0, porLoja: { gooder: 1 } };
const perms = ["BUYER_INGESTION_VISUALIZAR", "COMPRAS_IMPORTADAS_IMPORTAR", "COMPRAS_IMPORTADAS_ATRIBUIR"];
const FEED = "/integrations/marketplaces/purchases";
const mock = (rows: unknown[]) =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === `${FEED}/lots`) return { data: { lotes: [lot], semLojaTotal: 0, atualizadoEm: null } };
    if (url === FEED) return { data: { items: rows, total: rows.length, atualizadoEm: null } };
    throw new Error(`GET inesperado: ${url}`);
  });

describe("Cadastrar compra (fora do eBay)", () => {
  it("cadastra com vários itens, rastreio e uma chave de idempotência, e avisa que entrou confirmada", async () => {
    const user = userEvent.setup();
    mock([]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "m_cnew", numeroPedido: "SHOP-77" } });
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    await user.click(await screen.findByRole("button", { name: "Cadastrar compra" }));
    const submit = screen.getAllByRole("button", { name: "Cadastrar compra" }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true); // falta produto e preço

    await user.type(screen.getByLabelText("Vendedor ou site"), "Shop.com");
    await user.type(screen.getByLabelText("Nº do pedido (opcional)"), "SHOP-77");
    await user.type(screen.getByLabelText("Produto 1"), "Aspirador Dyson");
    await user.clear(screen.getByLabelText("Quantidade 1"));
    await user.type(screen.getByLabelText("Quantidade 1"), "2");
    await user.type(screen.getByLabelText("Preço unitário (US$) 1"), "349,99");
    await user.type(screen.getByLabelText("Link da foto 1 (opcional)"), "https://img.example.com/d.jpg");
    await user.click(screen.getByRole("button", { name: "+ Adicionar outro item" }));
    await user.type(screen.getByLabelText("Produto 2"), "Filtro");
    expect((submit as HTMLButtonElement).disabled).toBe(true); // o segundo item ainda não tem preço
    await user.type(screen.getByLabelText("Preço unitário (US$) 2"), "19.9");
    await user.type(screen.getByLabelText("Rastreio (opcional)"), "1Z999");
    await user.click(screen.getByRole("combobox", { name: "Transportadora" }));
    await user.click(screen.getByRole("option", { name: "UPS" }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![0]).toBe("/integrations/marketplaces/purchases/manual");
    expect(post.mock.calls[0]![1]).toMatchObject({
      lojaId: "store-dronz", vendedor: "Shop.com", referencia: "SHOP-77",
      itens: [{ titulo: "Aspirador Dyson", quantidade: 2, precoUnitario: 349.99, fotoUrl: "https://img.example.com/d.jpg" }, { titulo: "Filtro", quantidade: 1, precoUnitario: 19.9 }],
      rastreio: { codigo: "1Z999", transportadora: "UPS" }
    });
    expect((post.mock.calls[0]![2] as { headers: Record<string, string> }).headers["idempotency-key"]).toBeTruthy();
    expect(await screen.findByText("Compra SHOP-77 cadastrada e confirmada.")).toBeTruthy();
  });

  it("mostra a compra cadastrada no lote e deixa incluir e tirar o rastreio", async () => {
    const user = userEvent.setup();
    mock([manualRow()]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { rastreios: [] } });
    renderWithProviders(<PurchasesPage />, { route: "/compras?mes=2026-10", permissions: perms });
    const table = await screen.findByRole("table", { name: "Compras do lote" });
    expect(within(table).getByText("Sem rastreio ainda")).toBeTruthy();
    await user.click(within(table).getByRole("button", { name: "Adicionar rastreio" }));
    expect(screen.getByRole("dialog", { name: "Rastreio do pedido SHOP-1" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Código de rastreio"), "9400111");
    await user.click(screen.getByRole("combobox", { name: "Transportadora" }));
    await user.click(screen.getByRole("option", { name: "USPS" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toBe("/integrations/marketplaces/purchases/m_cabc123def456/tracking");
    expect(put.mock.calls[0]![1]).toEqual({ rastreio: { codigo: "9400111", transportadora: "USPS" } });
  });

  it("com rastreio, edita e remove; compra do eBay e quem não pode cadastrar não veem os botões", async () => {
    const user = userEvent.setup();
    const withTracking = manualRow({ fase: "A_CAMINHO_MIAMI", trackings: [{ carrier: "UPS", code: "1Z999", entrega: null }] });
    const ebay = manualRow({ candidateId: "cebay1abc", orderId: "EBAY-1", manual: false, canEditTracking: false, trackings: [{ carrier: "USPS", code: "94001", entrega: null }] });
    mock([withTracking, ebay]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { rastreios: [] } });
    renderWithProviders(<PurchasesPage />, { route: "/compras?mes=2026-10", permissions: perms });
    const table = await screen.findByRole("table", { name: "Compras do lote" });
    expect(within(table).getAllByRole("button", { name: "Editar rastreio" })).toHaveLength(1); // só a manual
    await user.click(within(table).getByRole("button", { name: "Editar rastreio" }));
    expect((screen.getByLabelText("Código de rastreio") as HTMLInputElement).value).toBe("1Z999");
    await user.click(screen.getByRole("button", { name: "Remover rastreio" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({ rastreio: null });
  });

  it("sem permissão de importar não há botão de cadastrar nem de editar rastreio", async () => {
    mock([manualRow({ canEditTracking: false })]);
    renderWithProviders(<PurchasesPage />, { route: "/compras?mes=2026-10", permissions: ["BUYER_INGESTION_VISUALIZAR"] });
    const table = await screen.findByRole("table", { name: "Compras do lote" });
    expect(within(table).queryByRole("button", { name: /rastreio/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar compra" })).toBeNull();
  });
});
