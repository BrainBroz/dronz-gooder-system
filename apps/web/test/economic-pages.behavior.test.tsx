import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { EconomicSettingsPage } from "../src/pages/EconomicSettingsPage";
import { PurchaseSimulatorPage, buildPayload, initialForm, toggleItemLivre, withProduct, type Produto } from "../src/pages/PurchaseSimulatorPage";
import { renderWithProviders, testStores } from "./render";

beforeEach(() => vi.restoreAllMocks());

const referenciasPO = {
  acrescimoCambialBrl: "0.20",
  notaFiscalPercentual: "5",
  markupAlertaPercentual: "25",
  taxas: [
    { modalidade: "A_VISTA", parcelas: null, percentual: "12" },
    { modalidade: "PARCELADO", parcelas: null, percentual: "16", observacao: "Informada com 2 parcelas; uso frequente de 12. Confirme o plano." }
  ]
};
const vigente = {
  id: "param-1",
  versao: 1,
  acrescimoCambialBrl: "0.2",
  freteValorPorKg: "10",
  freteMoeda: "USD",
  markupAlertaPercentual: "25",
  notaFiscalPercentual: "5",
  notaFiscalBase: "VENDA_BRUTA",
  iofPercentual: null,
  observacoes: null,
  createdAt: "2026-10-19T12:00:00.000Z",
  criadoPor: { id: "u", name: "Ana" },
  taxasMarketplace: [{ id: "taxa-parcelado", canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16", descricao: null }]
};
const quote = {
  id: "quote-1",
  moedaOrigem: "USD",
  moedaDestino: "BRL",
  referencia: "5.000000",
  acrescimo: "0.200000",
  operacional: "5.200000",
  fonte: "BCB PTAX venda - boletim de fechamento",
  cotadoEm: "2026-10-19T16:05:47.000Z",
  idadeDias: 0,
  condicao: "VIGENTE"
};
const resultado = {
  natureza: "ESTIMATIVA",
  status: "COMPLETO",
  pendencias: [],
  moeda: "BRL",
  quantidade: 3,
  pesoTotalKg: "1.500",
  cambio: { par: "USD/BRL", referencia: "5.000000", acrescimo: "0.200000", operacional: "5.200000" },
  porUnidade: {
    compra: "520.00", frete: "26.00", encargosCompra: "0.00", custo: "546.00", vendaBruta: "900.00", taxaMarketplace: "144.00",
    notaFiscal: "45.00", outrosEncargosVenda: "0.00", descontosVenda: "189.00", receitaLiquida: "711.00", lucro: "165.00"
  },
  total: {
    compra: "1560.00", frete: "78.00", encargosCompra: "0.00", custo: "1638.00", vendaBruta: "2700.00", taxaMarketplace: "432.00",
    notaFiscal: "135.00", outrosEncargosVenda: "0.00", descontosVenda: "567.00", receitaLiquida: "2133.00", lucro: "495.00"
  },
  composicao: { encargosCompra: [], outrosEncargosVenda: [], notaFiscal: { modo: "PERCENTUAL_VENDA_BRUTA", percentual: "5.00", baseUnitaria: "900.00" } },
  indicadores: {
    precoVendaDefinido: true, markupPercentual: "64.84", margemPercentual: "39.33", resultadoSobreVendaPercentual: "18.33",
    resultadoSobreCustoPercentual: "30.22", limiteMarkupPercentual: "25.00", abaixoDoLimite: false
  }
};
const mac = { id: "prod-mac", nome: "MacBook Air 13 M1 16GB 512GB", codigo: 21, peso: "0.5", precoVenda: "900", categoria: { nome: "Computadores" } };

describe("Configurações econômicas", () => {
  it("sem versão gravada, parte das referências do PO e grava com chave de idempotência", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente: null, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: null } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    expect(await screen.findByText(/Ainda não há parâmetros gravados/)).toBeTruthy();
    expect(await screen.findByText("Indisponível: nenhuma cotação USD→BRL registrada nesta loja.")).toBeTruthy();
    expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).value).toBe("0.20");
    expect(screen.getByText("Informada com 2 parcelas; uso frequente de 12. Confirme o plano.")).toBeTruthy();

    // Remove as taxas de referência (o canal ainda não foi escolhido) e grava.
    await user.click(screen.getByRole("button", { name: "Remover taxa 2" }));
    await user.click(screen.getByRole("button", { name: "Remover taxa 1" }));
    await user.click(screen.getByRole("button", { name: "Gravar nova versão" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body, config] = post.mock.calls[0] as [string, Record<string, unknown>, { headers: Record<string, string> }];
    expect(url).toBe("/economic-settings");
    expect(body).toMatchObject({ acrescimoCambialBrl: "0.20", markupAlertaPercentual: "25", notaFiscalPercentual: "5", notaFiscalBase: null, frete: null, taxasMarketplace: [] });
    expect(config.headers["Idempotency-Key"]).toBeTruthy();
    expect(config.headers["x-store-id"]).toBe(testStores[0]!.id);
  });

  it("mostra a cotação com referência, acréscimo, operacional, fonte e condição; captura PTAX", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [{ id: "param-1", versao: 1, createdAt: vigente.createdAt, criadoPor: { name: "Ana" } }], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: { ...quote, condicao: "ANTIGA", idadeDias: 9 } } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { jaRegistrada: false } });
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const section = await screen.findByRole("region", { name: "Câmbio USD → BRL" });
    expect(await within(section).findByText("5,0000")).toBeTruthy();
    expect(within(section).getByText("+ 0,2000")).toBeTruthy();
    expect(within(section).getByText("5,2000")).toBeTruthy();
    expect(within(section).getByText("Antiga (9 dias)")).toBeTruthy();
    expect(within(section).getByText(/BCB PTAX venda - boletim de fechamento/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Buscar PTAX de fechamento (Banco Central)" }));
    await waitFor(() => expect(post.mock.calls[0]![0]).toBe("/economic-settings/exchange-rate/ptax"));
    expect(await screen.findByText("Cotação PTAX registrada.")).toBeTruthy();
    expect(screen.getByText(/Versão 1 ·/)).toBeTruthy();
  });

  it("sem permissão de registro fica somente leitura", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["SIMULACAO_VISUALIZAR"] });
    expect(await screen.findByText(/Somente leitura/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gravar nova versão" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Buscar PTAX/ })).toBeNull();
    expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).disabled).toBe(true);
  });

  it("erro ao carregar aparece como erro, não como formulário vazio", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR"] });
    expect(await screen.findByText("Não foi possível carregar os parâmetros.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gravar nova versão" })).toBeNull();
  });
});

describe("Simulador de compra", () => {
  const mockSimulator = (calculate: () => Promise<unknown> = async () => ({ data: { resultado } })) => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      if (url === "/products") return { data: { items: [mac, { ...mac, id: "prod-mac-2", nome: "MacBook Air 13 M1 8GB 256GB", codigo: 22 }] } };
      if (url === "/purchase-simulations") return { data: { items: [], total: 0, page: 1, limit: 10 } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url === "/purchase-simulations/calculate") return calculate();
      if (url === "/purchase-simulations") return { data: { id: "sim-1" } };
      throw new Error(`POST inesperado: ${url}`);
    });
    return { get, post };
  };
  const permissions = ["SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR", "CATALOGO_VISUALIZAR"];

  async function chooseMac(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByRole("combobox", { name: "Produto" }), "Mac");
    // As variantes aparecem com código e categoria para distinguir uma da outra.
    expect(await screen.findByText("MacBook Air 13 M1 8GB 256GB")).toBeTruthy();
    expect(screen.getByText(/Cód\. 22 · Computadores/)).toBeTruthy();
    await user.click(screen.getByText("MacBook Air 13 M1 16GB 512GB"));
  }

  it("busca 'Mac', escolhe a variante e calcula no backend com a cotação registrada", async () => {
    const user = userEvent.setup();
    const { get, post } = mockSimulator();
    renderWithProviders(<PurchaseSimulatorPage />, { permissions });
    await chooseMac(user);
    const productCall = get.mock.calls.find(([url]) => url === "/products")!;
    expect((productCall[1] as { params: Record<string, unknown> }).params).toMatchObject({ search: "Mac" });

    await user.clear(screen.getByLabelText("Quantidade"));
    await user.type(screen.getByLabelText("Quantidade"), "3");
    await user.type(screen.getByLabelText("Preço unitário de compra"), "100");
    await waitFor(() => expect(post.mock.calls.some(([url]) => url === "/purchase-simulations/calculate")).toBe(true), { timeout: 2000 });
    const body = post.mock.calls.filter(([url]) => url === "/purchase-simulations/calculate").at(-1)![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      produtoId: "prod-mac",
      quantidade: 3,
      compra: { precoUnitario: "100", moeda: "USD" },
      pesoUnitarioKg: "0.5",
      cambio: { origem: "COTACAO_REGISTRADA", cotacaoCambioId: "quote-1" },
      frete: { valorPorKg: "10", moeda: "USD" },
      venda: { precoUnitarioBrl: "900", marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16" }, notaFiscal: { modo: "PERCENTUAL_VENDA_BRUTA", percentual: "5" } },
      parametroEconomicoId: "param-1"
    });

    const table = await screen.findByRole("table", { name: "Composição dos valores" });
    const row = (label: string) => within(table).getByText(label).closest("tr")!;
    expect(within(row("Custo total")).getByText(/546,00/)).toBeTruthy();
    expect(within(row("Custo total")).getByText(/1\.638,00/)).toBeTruthy();
    expect(within(row("Lucro projetado")).getByText(/165,00/)).toBeTruthy();
    expect(within(row("Lucro projetado")).getByText(/495,00/)).toBeTruthy();
    expect(within(table).getByText("Total (3 un.)")).toBeTruthy();
    expect(screen.getAllByText("ESTIMATIVA").length).toBeGreaterThan(0);
    expect(screen.getByText("Câmbio USD→BRL: 5,0000 + 0,2000 = 5,2000")).toBeTruthy();
  });

  it("mostra pendências e alerta de markup vindos do backend", async () => {
    const user = userEvent.setup();
    mockSimulator(async () => ({
      data: {
        resultado: {
          ...resultado,
          status: "INCOMPLETO",
          pendencias: [{ campo: "cambio", motivo: "Sem cotação USD→BRL para converter valores em dólar." }],
          porUnidade: { ...resultado.porUnidade, lucro: null },
          indicadores: { ...resultado.indicadores, markupPercentual: "15.21", abaixoDoLimite: true }
        }
      }
    }));
    renderWithProviders(<PurchaseSimulatorPage />, { permissions });
    await chooseMac(user);
    expect(await screen.findByText("Resultado incompleto", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("Sem cotação USD→BRL para converter valores em dólar.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Markup abaixo do limite de 25,00%");
  });

  it("salvar duas vezes o mesmo cenário reutiliza a chave de idempotência", async () => {
    const user = userEvent.setup();
    const { post } = mockSimulator();
    renderWithProviders(<PurchaseSimulatorPage />, { permissions });
    await chooseMac(user);
    const save = await screen.findByRole("button", { name: "Salvar simulação" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    await screen.findByText("Simulação salva.");
    await user.click(save);
    await waitFor(() => expect(post.mock.calls.filter(([url]) => url === "/purchase-simulations")).toHaveLength(2));
    const keys = post.mock.calls
      .filter(([url]) => url === "/purchase-simulations")
      .map(([, , config]) => (config as { headers: Record<string, string> }).headers["Idempotency-Key"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("erro no cálculo é informado; sem permissão de salvar não há botão; sem catálogo informa o nome", async () => {
    const user = userEvent.setup();
    mockSimulator(async () => {
      throw new Error("offline");
    });
    renderWithProviders(<PurchaseSimulatorPage />, { permissions: ["SIMULACAO_VISUALIZAR"] });
    expect(await screen.findByText("Sem acesso ao catálogo: informe o nome do item.")).toBeTruthy();
    await user.type(screen.getByLabelText("Nome do item"), "Item novo");
    expect(await screen.findByText("Não foi possível calcular. Revise os campos e tente novamente.", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Salvar simulação" })).toBeNull();
  });

  it("carregando parâmetros mostra o estado de carregamento", async () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => undefined));
    renderWithProviders(<PurchaseSimulatorPage />, { permissions });
    expect(await screen.findByText("Carregando parâmetros e cotação…")).toBeTruthy();
  });
});

describe("troca de produto no simulador", () => {
  const settingsData = { vigente, versoes: [], referenciasPO } as never;
  const a: Produto = { id: "a", nome: "A", codigo: 1, peso: "0.5", precoVenda: "900" };
  const b: Produto = { id: "b", nome: "B", codigo: 2, peso: "2.0", precoVenda: "3000" };

  it("valores trazidos do produto anterior são trocados pelos do novo", () => {
    const withA = withProduct(initialForm(settingsData, null), a);
    expect([withA.peso, withA.precoVenda]).toEqual(["0.5", "900"]);
    const withB = withProduct(withA, b);
    expect([withB.peso, withB.precoVenda]).toEqual(["2.0", "3000"]);
    const cleared = withProduct(withB, null);
    expect([cleared.peso, cleared.precoVenda]).toEqual(["", ""]);
  });

  it("passar por 'item sem cadastro' e voltar não deixa o novo produto herdar valores do anterior", () => {
    const withA = withProduct(initialForm(settingsData, null), a);
    const back = toggleItemLivre(toggleItemLivre(withA));
    expect(back.itemLivre).toBe(false);
    expect([back.produto, back.peso, back.precoVenda]).toEqual([null, "", ""]);
    const withB = withProduct(back, b);
    expect([withB.peso, withB.precoVenda]).toEqual(["2.0", "3000"]);
  });

  it("o que o operador digitou é preservado", () => {
    const edited = { ...withProduct(initialForm(settingsData, null), a), peso: "0.7", precoVenda: "950" };
    const withB = withProduct(edited, b);
    expect([withB.peso, withB.precoVenda]).toEqual(["0.7", "950"]);
  });

  it("produto sem preço de venda no cadastro não preenche preço", () => {
    const zero = withProduct(initialForm(settingsData, null), { ...a, precoVenda: "0" });
    expect(zero.precoVenda).toBe("");
  });
});

describe("payload do simulador", () => {
  const ready = (settings: object) => ({ ...withProduct(initialForm(settings as never, quote as never), { id: "a", nome: "A", codigo: 1, peso: "0.5", precoVenda: "900" }), precoCompra: "100" });

  it("o envio usa a taxa e a versão de parâmetros fixadas no formulário", () => {
    const form = ready({ vigente, versoes: [], referenciasPO });
    const before = buildPayload(form, quote as never) as { venda: { marketplace: unknown }; parametroEconomicoId: string; markupAlertaPercentual: string };
    expect(before.venda.marketplace).toEqual({ canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16" });
    expect(before.parametroEconomicoId).toBe("param-1");
    expect(before.markupAlertaPercentual).toBe("25");
  });

  it("a lista de opções guarda a taxa escolhida mesmo se a versão nova não a tiver", async () => {
    const user = userEvent.setup();
    let current = { vigente, versoes: [], referenciasPO };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: current };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      if (url === "/purchase-simulations") return { data: { items: [], total: 0, page: 1, limit: 10 } };
      if (url === "/products") return { data: { items: [mac] } };
      throw new Error(`GET inesperado: ${url}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({ data: { resultado } });
    const { queryClient } = renderWithProviders(<PurchaseSimulatorPage />, { permissions: ["SIMULACAO_VISUALIZAR", "CATALOGO_VISUALIZAR"] });
    const select = await screen.findByRole("combobox", { name: "Taxa do marketplace" });
    expect(select.textContent).toContain("Parcelado em 2x");
    current = {
      ...current,
      vigente: { ...vigente, id: "param-2", taxasMarketplace: [{ id: "taxa-avista", canal: "MERCADO_LIVRE", modalidade: "A_VISTA", parcelas: null, percentual: "12", descricao: null }] }
    } as never;
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Taxa do marketplace" }).textContent).toContain("Parcelado em 2x"));
    await user.click(screen.getByRole("combobox", { name: "Taxa do marketplace" }));
    expect(await screen.findByRole("option", { name: /Parcelado em 2x · 16,00% \(versão anterior\)/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /À vista · 12,00%/ })).toBeTruthy();
  });

  it("taxa manual vazia não bloqueia o cálculo: segue como pendência", () => {
    const form = { ...ready({ vigente, versoes: [], referenciasPO }), taxaEscolha: "manual" as const };
    const payload = buildPayload(form, quote as never) as { venda: { marketplace: unknown } } | null;
    expect(payload).not.toBeNull();
    expect(payload!.venda.marketplace).toEqual({ canal: "MERCADO_LIVRE", modalidade: "A_VISTA", parcelas: null, percentual: null });
  });

  it("acréscimo vazio vai como pendência; zero digitado vai como zero", () => {
    const form = { ...ready({ vigente, versoes: [], referenciasPO }), cambioOrigem: "INFORMADA" as const, referencia: "5" };
    const empty = buildPayload({ ...form, acrescimo: "" }, quote as never) as { cambio: object };
    expect(empty.cambio).toMatchObject({ origem: "INFORMADA", referencia: "5", acrescimo: null });
    const zero = buildPayload({ ...form, acrescimo: "0" }, quote as never) as { cambio: object };
    expect(zero.cambio).toMatchObject({ acrescimo: "0" });
  });
});

describe("idempotência nas Configurações e paginação das simulações", () => {
  it("resposta perdida: reenviar o mesmo conteúdo reutiliza a chave; editar gera chave nova", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockRejectedValue(new Error("resposta perdida"));
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const save = await screen.findByRole("button", { name: "Gravar nova versão" });
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.type(screen.getByLabelText("Observações"), "x");
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const keys = post.mock.calls.map(([, , config]) => (config as { headers: Record<string, string> }).headers["Idempotency-Key"]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("lista de simulações salvas navega entre páginas", async () => {
    const user = userEvent.setup();
    const saved = (page: number) => ({
      items: [{ id: `sim-${page}`, nome: `Simulação página ${page}`, produtoNome: "Mac", produtoCodigo: 1, createdAt: "2026-10-19T12:00:00.000Z", resultado, criadoPor: { name: "Ana" } }],
      total: 12,
      page,
      limit: 10
    });
    const get = vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      if (url === "/purchase-simulations") return { data: saved((config as { params: { page: number } }).params.page) };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<PurchaseSimulatorPage />, { permissions: ["SIMULACAO_VISUALIZAR"] });
    expect(await screen.findByText("Simulação página 1")).toBeTruthy();
    expect(screen.getByText("Página 1 de 2 · 12 simulações")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("Simulação página 2")).toBeTruthy();
    const pages = get.mock.calls.filter(([url]) => url === "/purchase-simulations").map(([, config]) => (config as { params: { page: number } }).params.page);
    expect(pages).toEqual([1, 2]);
  });
});
