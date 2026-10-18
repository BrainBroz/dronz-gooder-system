import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { FinancePage } from "../src/pages/FinancePage";
import { renderWithProviders } from "./render";

const reconciliation = {
  id: "conc-1",
  estado: "PENDENTE_REVISAO",
  sugeridoPagamentoId: "pay-1",
  transacao: {
    provider: "PAYPAL",
    transactionId: "TX-1",
    versao: 1,
    moeda: "USD",
    bruto: "100.00",
    occurredAt: "2026-10-06T10:00:00.000Z",
    conta: { apelido: "PayPal Dronz" }
  }
};

function mockReads() {
  return vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/finance/payments") return { data: [] };
    if (url === "/purchase-orders") return { data: { items: [] } };
    if (url === "/finance/accounts")
      return {
        data: [
          {
            id: "card-1",
            tipo: "CARTAO",
            apelido: "Visa",
            moedaPrincipal: "USD",
            ultimosQuatro: "4242"
          }
        ]
      };
    if (url === "/finance/reconciliations") return { data: [reconciliation] };
    if (url === "/finance/accounts/card-1/statements")
      return {
        data: [
          {
            id: "st-1",
            moeda: "USD",
            inicio: "2027-02-01",
            fim: "2027-02-28",
            vencimento: "2027-03-10",
            estado: "FECHADA",
            totais: {
              debitos: "60.00",
              creditos: "0.00",
              pagos: "20.00",
              saldo: "40.00"
            }
          }
        ]
      };
    throw new Error(`GET inesperado: ${url}`);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("Financeiro B16", () => {
  it("confirma conciliação com o pagamento sugerido, por ação humana", async () => {
    const errors = vi.spyOn(console, "error");
    mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<FinancePage />, {
      permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_CONCILIAR"]
    });
    await userEvent.click(screen.getByRole("tab", { name: "Conciliação" }));
    expect(await screen.findByText(/TX-1 \(v1\)/)).toBeTruthy();
    expect(screen.getByText(/NOT_CONFIGURED/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar conciliação" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/finance/reconciliations/conc-1/confirm",
        { pagamentoId: "pay-1" },
        expect.anything()
      )
    );
    expect(
      errors.mock.calls.filter(([message]) =>
        String(message).includes("children` must be passed")
      )
    ).toHaveLength(0);
  });

  it("sem capacidade de conciliar só lê; fatura fechada mostra saldo e permite pagamento parcial", async () => {
    mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<FinancePage />, {
      permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_FATURAS"]
    });
    await userEvent.click(screen.getByRole("tab", { name: "Conciliação" }));
    expect(await screen.findByText(/TX-1/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Confirmar conciliação" })
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("tab", { name: "Cartões e faturas" })
    );
    await userEvent.click(await screen.findByLabelText("Cartão"));
    await userEvent.click(
      await screen.findByRole("option", { name: /Visa · final 4242/ })
    );
    expect(await screen.findByText(/Saldo 40.00/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Pagar valor"), "20");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar pagamento da fatura" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/finance/statements/st-1/payments",
        expect.objectContaining({ valor: 20 }),
        expect.anything()
      )
    );
  });
});
