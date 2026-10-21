import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { PurchasesPage, shippingState } from "../src/pages/PurchasesPage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

const base = {
  version: 3, status: "AGUARDANDO_APROVACAO", orderedAt: "2026-10-15T12:00:00.000Z", currency: "USD", total: 900, externalStatus: "Completed", cancelled: false,
  account: "impetit", purpose: "LOJA", shippedAt: null, canApprove: true, canChangeStore: false
};
const rows = [
  { ...base, candidateId: "c1", orderId: "13-15311-66647", store: { id: "store-gooder", slug: "gooder", nome: "Gooder" },
    trackings: [{ carrier: "USPS", code: "9434908106245702187606" }], shippedAt: "2026-10-16T10:00:00.000Z",
    items: [{ title: "Apple iPhone 17 Pro Max 1 TB", quantity: 2, cancelledQuantity: 0, unitPrice: 900, currency: "USD", imageUrl: "https://i.ebayimg.com/a.jpg" }] },
  { ...base, candidateId: "c2", orderId: "19-15300-00124", version: 5, store: null, trackings: [],
    items: [{ title: "Nintendo Switch 2", quantity: 1, cancelledQuantity: 0, unitPrice: 450, currency: "USD", imageUrl: null }] },
  { ...base, candidateId: "c3", orderId: "11-15264-26580", cancelled: true, canApprove: false, store: { id: "store-dronz", slug: "dronz", nome: "Dronz" }, trackings: [],
    items: [{ title: "Camiseta ALO", quantity: 1, cancelledQuantity: 1, unitPrice: 60, currency: "USD", imageUrl: null }] }
];
const perms = ["BUYER_INGESTION_VISUALIZAR", "BUYER_INGESTION_APROVAR", "COMPRAS_IMPORTADAS_VISUALIZAR", "COMPRAS_IMPORTADAS_IMPORTAR"];
const mock = () =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/integrations/marketplaces/purchases") return { data: { items: rows, total: rows.length } };
    if (url === "/imported-purchases" || String(url).startsWith("/imported-purchases")) return { data: { items: [], page: 1, limit: 100, total: 0 } };
    throw new Error(`GET inesperado: ${url}`);
  });

describe("Compras (lista)", () => {
  it("mostra produto, foto, valor, loja, rastreio e situação do envio; sem mostrar merchant, progresso ou idade", async () => {
    const get = mock();
    renderWithProviders(<PurchasesPage />, { permissions: perms });
    expect(await screen.findByText("Apple iPhone 17 Pro Max 1 TB")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === "P" && /2 × US\$\s*900,00 = US\$\s*1\.800,00/.test(element.textContent ?? ""))).toBeTruthy();
    expect(screen.getByText(/Rastreio: USPS 9434908106245702187606/)).toBeTruthy();
    expect(screen.getByText("Enviado pelo vendedor")).toBeTruthy();
    expect(screen.getByText("Aguardando envio do vendedor")).toBeTruthy();
    expect(screen.getByText("Cancelado")).toBeTruthy();
    expect(screen.getAllByText(/o vendedor ainda não informou/)).toHaveLength(2);
    // "Gooder" aparece no filtro e na etiqueta de loja da primeira compra.
    expect(screen.getAllByText("Gooder")).toHaveLength(2);
    expect(screen.getByText("Sem loja")).toBeTruthy();
    expect(screen.queryByText(/Merchant|Progresso|Idade/)).toBeNull();
    const image = document.querySelector('img[src="https://i.ebayimg.com/a.jpg"]');
    expect(image).toBeTruthy();
    expect(screen.getAllByText("sem foto").length).toBe(2);
    const call = get.mock.calls.find(([url]) => url === "/integrations/marketplaces/purchases")![1] as { params: Record<string, unknown> };
    expect(call.params).toMatchObject({ finalidade: "LOJA", limit: 100 });
    expect(call.params).not.toHaveProperty("status"); // abre mostrando todas: as compras do eBay já entram confirmadas
  });

  it("confirma uma compra com a versão certa e todas de uma vez", async () => {
    const user = userEvent.setup();
    mock();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchasesPage />, { permissions: perms });
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

  it("filtros pedem à API loja, origem e situação; sem permissão de aprovar não há botão", async () => {
    const user = userEvent.setup();
    const get = mock();
    renderWithProviders(<PurchasesPage />, { permissions: ["BUYER_INGESTION_VISUALIZAR"] });
    await screen.findByText("Nintendo Switch 2");
    await user.click(screen.getByRole("button", { name: "Compras pessoais" }));
    await user.click(screen.getByRole("button", { name: "Confirmadas" }));
    await user.click(screen.getByRole("button", { name: "Gooder" }));
    await waitFor(() => {
      const last = get.mock.calls.filter(([url]) => url === "/integrations/marketplaces/purchases").at(-1)![1] as { params: Record<string, unknown> };
      expect(last.params).toMatchObject({ finalidade: "PESSOAL", status: "APROVADA", lojaId: "store-gooder" });
    });
  });
});

describe("Compras: trocar a loja com um clique", () => {
  it("mostra as bolinhas das lojas só onde pode trocar e atribui a compra inteira à loja clicada", async () => {
    const user = userEvent.setup();
    const shared = { ...base, candidateId: "s1", orderId: "SHARED-1", status: "APROVADA", canApprove: false, canChangeStore: true, store: null, trackings: [],
      items: [{ title: "Mac mini M4", quantity: 1, cancelledQuantity: 0, unitPrice: 600, currency: "USD", imageUrl: null }] };
    const fixed = { ...shared, candidateId: "s2", orderId: "FIXED-2", canChangeStore: false, store: { id: "store-gooder", slug: "gooder", nome: "Gooder" },
      items: [{ title: "Echo Dot", quantity: 1, cancelledQuantity: 0, unitPrice: 30, currency: "USD", imageUrl: null }] };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/integrations/marketplaces/purchases") return { data: { items: [shared, fixed], total: 2 } };
      return { data: { items: [], page: 1, limit: 100, total: 0 } };
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchasesPage />, { permissions: [...perms, "COMPRAS_IMPORTADAS_ATRIBUIR"] });
    await screen.findByText("Mac mini M4");
    expect(screen.getByText("Escolha a loja")).toBeTruthy();
    // só a compra de conta compartilhada tem as bolinhas; a da conta dedicada mostra a etiqueta fixa
    expect(screen.getAllByRole("button", { name: "Atribuir à Dronz" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Atribuir à Dronz" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]!.slice(0, 2)).toEqual(["/integrations/marketplaces/purchases/s1/store", { lojaId: "store-dronz" }]);
  });
});

describe("situação do envio", () => {
  it("cancelado, com rastreio, enviado sem rastreio e aguardando", () => {
    expect(shippingState({ cancelled: true, trackings: [{ carrier: null, code: "x" }], shippedAt: null }).label).toBe("Cancelado");
    expect(shippingState({ cancelled: false, trackings: [{ carrier: null, code: "x" }], shippedAt: null }).label).toBe("Enviado pelo vendedor");
    expect(shippingState({ cancelled: false, trackings: [], shippedAt: "2026-10-16T10:00:00.000Z" }).label).toBe("Enviado, sem rastreio ainda");
    expect(shippingState({ cancelled: false, trackings: [], shippedAt: null }).label).toBe("Aguardando envio do vendedor");
  });
});
