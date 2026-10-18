import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { DashboardPage } from "../src/pages/DashboardPage";
import { ReportsPage } from "../src/pages/ReportsPage";
import { renderWithProviders } from "./render";

const summary = {
  orders: {
    count: 7,
    total: { USD: "1234.50", BRL: "10.00" },
    byStatus: { COMPLETED: 2, CANCELLED: 1 }
  },
  inventory: { available: 9, reserved: 2, zero: 1 },
  openTrips: 3,
  pendingReceiving: 4,
  payments: { pending: 5, paid: { USD: "600.00" } },
  belowMarkup: 6
};
const reportLabels: Record<string, string> = {
  "purchase-orders": "Pedidos de Compra",
  "purchase-items": "Itens Comprados",
  logistics: "Logística por Viagem",
  "suitcase-weight": "Peso por Mala",
  receiving: "Recebimentos",
  inventory: "Posição de Estoque",
  movements: "Movimentações",
  costs: "Custos por Pedido",
  payments: "Pagamentos",
  markup: "Markup e Margem"
};

beforeEach(() => {
  vi.spyOn(api, "get");
});

describe("Dashboard", () => {
  it("mostra loading, oito indicadores, breakdown e cálculo local documentado", async () => {
    let resolve!: (value: { data: typeof summary }) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((done) => (resolve = done)));
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText("Carregando indicadores...")).toBeTruthy();
    resolve({ data: summary });
    await screen.findByText("Pedidos Totais");
    expect(screen.getAllByText(/Pedidos Totais|Estoque Disponível|Estoque Reservado|Estoque Zerado|Viagens Abertas|Recebimentos Pendentes|Pagamentos Pendentes|Produtos Abaixo do Markup/)).toHaveLength(8);
    expect(screen.getByText("COMPLETED")).toBeTruthy();
    expect(screen.getByText("CANCELLED")).toBeTruthy();
    expect(screen.getByText("Pedidos Processados").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("Total Investido").nextElementSibling?.textContent).toBe(
      "USD 1.234,5 · BRL 10"
    );
    expect(vi.mocked(api.get).mock.calls[0]).toEqual([
      "/analytics/dashboard",
      {
        headers: { Authorization: "Bearer access-test", "x-store-id": "store-dronz" }
      }
    ]);
  });

  it("mostra erro", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("offline"));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("Falha ao carregar dados do dashboard")).toBeTruthy();
  });

  it("mostra breakdown vazio sem inventar pedidos", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { ...summary, orders: { count: 0, total: {}, byStatus: {} } }
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("Nenhum pedido registrado")).toBeTruthy();
  });

  it("sem acesso financeiro não mostra valores como zero", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...summary,
        orders: { ...summary.orders, total: null },
        payments: { pending: 5, paid: null }
      }
    });
    renderWithProviders(<DashboardPage />);
    expect(
      (await screen.findByText("Total Investido")).nextElementSibling?.textContent
    ).toBe("Sem acesso financeiro");
  });
});

describe("Relatórios", () => {
  it("mostra loading enquanto a consulta está pendente", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText("Carregando relatório...")).toBeTruthy();
  });

  it("mostra loading, vazio e envia loja/filtros de data", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    renderWithProviders(<ReportsPage />);
    expect(await screen.findByText("Nenhum registro encontrado para os filtros selecionados.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-01-02" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-01-31" } });
    await waitFor(() => {
      const last = vi.mocked(api.get).mock.calls.at(-1);
      expect(last?.[0]).toBe("/analytics/reports/purchase-orders");
      expect(last?.[1]?.headers?.["x-store-id"]).toBe("store-dronz");
      expect(last?.[1]?.params).toEqual({
        from: new Date("2026-01-02").toISOString(),
        to: new Date("2026-01-31").toISOString()
      });
    });
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
  });

  it("renderiza colunas atuais e objetos aninhados", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ numeroPedido: "PO-1", fornecedor: { nome: "Merchant" } }]
    });
    renderWithProviders(<ReportsPage />);
    expect(await screen.findByText("PO-1")).toBeTruthy();
    expect(screen.getByText("numero Pedido")).toBeTruthy();
    expect(screen.getByText(/\{"nome":"Merchant"\}/)).toBeTruthy();
  });

  it("mostra erro", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("offline"));
    renderWithProviders(<ReportsPage />);
    expect(await screen.findByText("Erro ao carregar relatório")).toBeTruthy();
  });

  it.each([
    "purchase-orders",
    "purchase-items",
    "logistics",
    "suitcase-weight",
    "receiving",
    "inventory",
    "movements",
    "costs",
    "payments",
    "markup"
  ])("seleciona e consulta o relatório %s", async (type) => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderWithProviders(<ReportsPage />);
    const select = screen.getByRole("combobox", { name: "Tipo de Relatório" });
    await user.click(select);
    const option = screen.getByRole("option", {
      name: new RegExp(reportLabels[type] ?? type)
    });
    await user.click(option);
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.some(([url]) => url === `/analytics/reports/${type}`)
      ).toBe(true)
    );
  });
});

describe("Indicadores B18", () => {
  it("calcula sob demanda, mostra 'Sem amostra' e não oferece CSV sem ANALYTICS_EXPORTAR", async () => {
    vi.mocked(api.get).mockImplementation(async (url) =>
      url === "/analytics/indicators"
        ? {
            data: {
              versao: "B18-v1",
              referenciaEm: "2032-02-01T00:00:00.000Z",
              definicoes: [{ codigo: "LEAD_TIME_COMPRA_ENTRADA", descricao: "Dias até a entrada", formula: "média" }],
              linhas: [
                { codigo: "LEAD_TIME_COMPRA_ENTRADA", dimensao: null, moeda: null, valor: null, amostra: 0, status: "SEM_AMOSTRA" }
              ]
            }
          }
        : { data: [] }
    );
    renderWithProviders(<ReportsPage />, { permissions: ["ANALYTICS_VISUALIZAR"] });
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === "/analytics/indicators")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Calcular indicadores" }));
    expect(await screen.findByText("Sem amostra")).toBeTruthy();
    expect(screen.getByText("Dias até a entrada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Exportar CSV" })).toBeNull();
  });
});
