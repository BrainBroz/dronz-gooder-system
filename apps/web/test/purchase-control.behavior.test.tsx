import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { PurchaseControlPage } from "../src/pages/PurchaseControlPage";
import { renderWithProviders, testStores } from "./render";

beforeEach(() => vi.restoreAllMocks());

const cotacao = { id: "q1", moedaOrigem: "USD", moedaDestino: "BRL", referencia: "5.000000", acrescimo: "0.200000", operacional: "5.200000", fonte: "t", cotadoEm: new Date().toISOString(), idadeDias: 0, condicao: "VIGENTE" };
const valores = (extra: Record<string, string | null>) => ({ compra: "520.00", frete: "234.00", encargosCompra: "0.00", custo: "754.00", vendaBruta: "1000.00", taxaMarketplace: "160.00", notaFiscal: "50.00", outrosEncargosVenda: "30.00", lucro: "6.00", ...extra });
const linha = {
  itemId: "i1", numeroPedido: "PED-1", dataPedido: "2031-03-15T15:00:00.000Z", titulo: "Apple AirPods Pro 3", moeda: "USD", precoUnitario: "100", quantidade: 2,
  produtoBase: null, entrada: { vendaUnitariaBrl: "1000.00", pesoKg: null, freteRealUsd: null }, pesoKgUsado: "0.5", freteReal: false,
  calculo: {
    status: "COMPLETO", pendencias: [], porUnidade: valores({}), total: valores({ custo: "1508.00", vendaBruta: "2000.00", lucro: "12.00" }),
    indicadores: { resultadoSobreVendaPercentual: "0.60", resultadoSobreCustoPercentual: "0.80", limiteMarkupPercentual: "30.00" }
  }
};
const incompleta = { ...linha, itemId: "i2", titulo: "Bose SoundLink Max", entrada: { vendaUnitariaBrl: null, pesoKg: null, freteRealUsd: null }, pesoKgUsado: null,
  calculo: { ...linha.calculo, status: "INCOMPLETO", pendencias: [{ campo: "venda", motivo: "Preço de venda a definir." }], total: valores({ lucro: null }), indicadores: { ...linha.calculo.indicadores, resultadoSobreVendaPercentual: null, resultadoSobreCustoPercentual: null } } };
const controle = { cotacao, parametros: { parametrosGravados: true, envioMarketplaceBrl: "30", markupAlertaPercentual: "30.00" }, linhas: [linha, incompleta],
  totais: { linhas: 2, linhasIncompletas: 1, custo: "1508.00", vendaBruta: "2000.00", lucro: "12.00", margemPercentual: "0.60", markupPercentual: "0.80" } };
const mock = () =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/purchase-control") return { data: controle };
    if (url === "/economic-settings/exchange-rate") return { data: { cotacao } };
    if (url === "/product-bases") return { data: { items: [], total: 0, categorias: [] } };
    throw new Error(`GET inesperado: ${url}`);
  });
const perms = ["COMPRAS_IMPORTADAS_VISUALIZAR", "SIMULACAO_GERENCIAR", "SIMULACAO_VISUALIZAR"];

describe("Controle de compras", () => {
  it("abre no mês pedido pela tela de Compras (?mes=AAAA-MM) e ignora mês inválido", async () => {
    const get = mock();
    renderWithProviders(<PurchaseControlPage />, { permissions: perms, route: "/compras/controle?mes=2026-08" });
    await screen.findByRole("table", { name: "Controle de compras" });
    expect(get.mock.calls.find(([url]) => url === "/purchase-control")![1]).toMatchObject({ params: { ano: 2026, mes: 8 } });
    expect((screen.getByLabelText("Mês do pedido") as HTMLInputElement).value).toBe("2026-08");
  });

  it("mês inválido na URL cai no mês atual", async () => {
    const get = mock();
    renderWithProviders(<PurchaseControlPage />, { permissions: perms, route: "/compras/controle?mes=2026-13" });
    await screen.findByRole("table", { name: "Controle de compras" });
    const today = new Date();
    expect(get.mock.calls.find(([url]) => url === "/purchase-control")![1]).toMatchObject({ params: { ano: today.getFullYear(), mes: today.getMonth() + 1 } });
  });

  it("mostra a visão resumida, marca linhas incompletas (sem alerta de markup na compra), e grava a venda digitada", async () => {
    const user = userEvent.setup();
    const get = mock();
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchaseControlPage />, { permissions: perms });
    const table = await screen.findByRole("table", { name: "Controle de compras" });
    expect(within(table).getByText("Apple AirPods Pro 3")).toBeTruthy();
    expect(within(table).queryByText("abaixo")).toBeNull();
    expect(within(table).getByText("Incompleta")).toBeTruthy();
    expect(screen.getByText(/Envio do Mercado Livre estimado/)).toBeTruthy();
    expect(screen.getByText(/1 linhas incompletas ficam fora dos totais/)).toBeTruthy();
    const query = get.mock.calls.find(([url]) => url === "/purchase-control")![1] as { headers: Record<string, string>; params: { ano: number; mes: number } };
    expect(query.headers["x-store-id"]).toBe(testStores[0]!.id);

    const venda = screen.getByLabelText("Venda de Bose SoundLink Max");
    await user.type(venda, "899,90");
    await user.tab();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toBe("/purchase-control/items/i2");
    expect(put.mock.calls[0]![1]).toEqual({ vendaUnitariaBrl: 899.9 });
  });

  it("a visão detalhada mostra as colunas do custo e permite peso e frete pago; sem permissão é só leitura", async () => {
    const user = userEvent.setup();
    mock();
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    const first = renderWithProviders(<PurchaseControlPage />, { permissions: perms });
    await screen.findByRole("table", { name: "Controle de compras" });
    await user.click(screen.getByRole("button", { name: "Detalhado" }));
    for (const column of ["Custo total", "Frete pago (US$)", "Taxa ML", "Nota", "Envio ML", "Markup"]) expect(screen.getByRole("columnheader", { name: column })).toBeTruthy();
    await user.type(screen.getByLabelText("Frete pago de Apple AirPods Pro 3"), "50");
    await user.tab();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({ freteRealUsd: 50 });
    first.unmount();

    renderWithProviders(<PurchaseControlPage />, { permissions: ["COMPRAS_IMPORTADAS_VISUALIZAR"] });
    await screen.findByRole("table", { name: "Controle de compras" });
    expect(screen.queryByLabelText(/Venda de/)).toBeNull();
  });
});
