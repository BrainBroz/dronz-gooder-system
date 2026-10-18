import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { api } from "../src/api/client";
import { SalesPage } from "../src/pages/SalesPage";
import { renderWithProviders } from "./render";

const draft = {
  id: "sale-1",
  canal: "MERCADO_LIVRE",
  referenciaExterna: "ML-1",
  dataVenda: "2026-10-18T12:00:00.000Z",
  moeda: "BRL",
  estado: "RASCUNHO",
  receitaBruta: "400.00",
  receitaLiquida: "312.00",
  recebivel: null,
  itens: [
    {
      id: "item-1",
      produto: { nome: "Drone" },
      quantidade: 2,
      precoUnitario: "200.00"
    }
  ]
};

function mockReads(suggestion: unknown) {
  return vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/sales") return { data: [draft] };
    if (url === "/products") return { data: { items: [] } };
    if (url === "/sales/sale-1/lot-suggestion") return { data: suggestion };
    throw new Error(`GET inesperado: ${url}`);
  });
}

function mockReceiptReads() {
  return vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/sales")
      return {
        data: [
          {
            ...draft,
            estado: "CONFIRMADA",
            recebivel: {
              valorPrevisto: "100",
              valorRecebido: "0",
              status: "PENDENTE"
            }
          }
        ]
      };
    if (url === "/products") return { data: { items: [] } };
    throw new Error(`GET inesperado: ${url}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("Vendas B17", () => {
  it("confirma a venda com os lotes FIFO sugeridos", async () => {
    mockReads({
      itens: [
        {
          vendaItemId: "item-1",
          faltante: 0,
          lotes: [
            {
              movimentoEntradaId: "lot-1",
              quantidade: 2,
              entradaEm: "2026-10-01T00:00:00.000Z",
              pedido: "PO-9",
              custoConhecido: true
            }
          ]
        }
      ]
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sugerir lotes (FIFO)" })
    );
    expect(await screen.findByText(/pedido PO-9/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar venda e baixar estoque" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales/sale-1/confirm",
        {
          lotes: [
            {
              vendaItemId: "item-1",
              movimentoEntradaId: "lot-1",
              quantidade: 2
            }
          ]
        },
        expect.anything()
      )
    );
    expect(screen.queryByText("Nova venda (rascunho)")).toBeNull();
  });

  it("saldo Brasil insuficiente bloqueia a confirmação", async () => {
    mockReads({ itens: [{ vendaItemId: "item-1", faltante: 2, lotes: [] }] });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sugerir lotes (FIFO)" })
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Confirmar venda e baixar estoque" })
    ).toBeNull();
  });

  it("explica o bloqueio de lote sem saldo reconciliado", async () => {
    mockReads({
      itens: [
        {
          vendaItemId: "item-1",
          faltante: 2,
          lotes: [],
          blockedReason: "stock_lots_require_reconciliation"
        }
      ]
    });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sugerir lotes (FIFO)" })
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "reconciliação"
    );
    expect(
      screen.queryByRole("button", { name: "Confirmar venda e baixar estoque" })
    ).toBeNull();
  });

  it("retry de criação mantém payload, data e chave após erro de rede", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/sales") return { data: [] };
      if (url === "/products")
        return { data: { items: [{ id: "product-1", nome: "Drone" }] } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi
      .spyOn(api, "post")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ data: {} });
    const firstMount = renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CRIAR"]
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Produto" }));
    await userEvent.click(await screen.findByRole("option", { name: "Drone" }));
    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Preço unitário" }),
      "100"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Criar rascunho" })
    );
    await screen.findByRole("alert");
    firstMount.unmount();
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CRIAR"]
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Produto" }));
    await userEvent.click(await screen.findByRole("option", { name: "Drone" }));
    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Preço unitário" }),
      "100"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Criar rascunho" })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls[0][2]?.headers).toMatchObject({
      "x-store-id": "store-dronz",
      "idempotency-key": expect.any(String)
    });
    expect(post.mock.calls[0][1].dataVenda).toEqual(expect.any(String));
  });

  it("retry de recebimento sobrevive ao filtro sem duplicar; outra parcela recebe chave nova", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      if (url === "/sales")
        return {
          data:
            config?.params?.estado === "RASCUNHO"
              ? []
              : [
                  {
                    ...draft,
                    estado: "CONFIRMADA",
                    recebivel: {
                      valorPrevisto: "100",
                      valorRecebido: "0",
                      status: "PENDENTE"
                    }
                  }
                ]
        };
      if (url === "/products") return { data: { items: [] } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi
      .spyOn(api, "post")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ data: {} });
    const firstMount = renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "FINANCEIRO_REGISTRAR"]
    });
    const input = await screen.findByRole("spinbutton", {
      name: "Valor recebido"
    });
    await userEvent.type(input, "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("combobox", { name: "Estado" }));
    await userEvent.click(screen.getByRole("option", { name: "Rascunho" }));
    await screen.findByText("Nenhuma venda neste filtro.");
    await userEvent.click(screen.getByRole("combobox", { name: "Estado" }));
    await userEvent.click(screen.getByRole("option", { name: "Todos" }));
    await screen.findByRole("spinbutton", {
      name: "Valor recebido"
    });
    firstMount.unmount();
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "FINANCEIRO_REGISTRAR"]
    });
    const returnedInput = await screen.findByRole("spinbutton", {
      name: "Valor recebido"
    });
    await userEvent.type(returnedInput, "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    await screen.findByText("Recebimento registrado.");
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls[0][1]).toMatchObject({
      valor: 25,
      recebidoEm: expect.any(String)
    });
    await userEvent.type(returnedInput, "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][2]?.headers?.["idempotency-key"]).not.toBe(
      post.mock.calls[0][2]?.headers?.["idempotency-key"]
    );
  });

  it("sessão indisponível bloqueia antes de enviar e explica que nenhum recebimento foi realizado", async () => {
    mockReceiptReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "FINANCEIRO_REGISTRAR"]
    });
    await userEvent.type(
      await screen.findByRole("spinbutton", { name: "Valor recebido" }),
      "25"
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Nenhum envio foi realizado"
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("falha de limpeza da sessão não transforma recebimento confirmado em erro nem reutiliza a chave para outra parcela", async () => {
    mockReceiptReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "FINANCEIRO_REGISTRAR"]
    });
    const input = await screen.findByRole("spinbutton", {
      name: "Valor recebido"
    });
    await userEvent.type(input, "25");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw new DOMException("unavailable", "SecurityError");
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    await screen.findByText("Recebimento registrado.");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.type(input, "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar recebimento" })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][2]?.headers?.["idempotency-key"]).not.toBe(
      post.mock.calls[0][2]?.headers?.["idempotency-key"]
    );
  });
});
