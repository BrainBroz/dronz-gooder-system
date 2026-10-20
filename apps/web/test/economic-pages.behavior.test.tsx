import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { EconomicSettingsPage } from "../src/pages/EconomicSettingsPage";
import { PurchaseSimulatorPage, buildPayload, formFromSaved, initialForm, toggleItemLivre, withProduct, type Produto, type SavedEntrada } from "../src/pages/PurchaseSimulatorPage";
import { renderWithProviders, testStores } from "./render";

beforeEach(() => vi.restoreAllMocks());

const referenciasPO = {
  acrescimoCambialBrl: "0.20",
  notaFiscalPercentual: "5",
  notaFiscalBase: "VENDA_BRUTA",
  markupAlertaPercentual: "30",
  frete: { valorPorKg: "90", moeda: "USD" },
  taxas: [{ canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: "16" }]
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
  fonte: "Dólar comercial - Yahoo Finance (USD/BRL)",
  cotadoEm: new Date().toISOString(),
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
    expect((screen.getByLabelText(/Frete por kg/) as HTMLInputElement).value).toBe("90");

    // A taxa de 16% vem sem número de parcelas e grava assim.
    await user.click(screen.getByRole("button", { name: "Gravar nova versão" }));
    // Sem cotação, a tela também pede sozinha o dólar do dia; aqui interessa só a gravação dos parâmetros.
    await waitFor(() => expect(post.mock.calls.some(([target]) => target === "/economic-settings")).toBe(true));
    const [url, body, config] = post.mock.calls.find(([target]) => target === "/economic-settings") as [string, Record<string, unknown>, { headers: Record<string, string> }];
    expect(url).toBe("/economic-settings");
    expect(body).toMatchObject({
      acrescimoCambialBrl: "0.20",
      markupAlertaPercentual: "30",
      notaFiscalPercentual: "5",
      notaFiscalBase: "VENDA_BRUTA",
      frete: { valorPorKg: "90", moeda: "USD" },
      taxasMarketplace: [{ canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: "16" }]
    });
    expect(config.headers["Idempotency-Key"]).toBeTruthy();
    expect(config.headers["x-store-id"]).toBe(testStores[0]!.id);
  });

  it("mostra a cotação com referência, acréscimo, operacional, fonte e condição; atualiza o dólar do dia", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [{ id: "param-1", versao: 1, createdAt: vigente.createdAt, criadoPor: { name: "Ana" } }], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: { ...quote, condicao: "ANTIGA", idadeDias: 9, cotadoEm: "2026-10-19T16:05:47.000Z" } } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { jaRegistrada: false } });
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const section = await screen.findByRole("region", { name: "Câmbio USD → BRL" });
    expect(await within(section).findByText("5,0000")).toBeTruthy();
    expect(within(section).getByText("+ 0,2000")).toBeTruthy();
    expect(within(section).getByText("5,2000")).toBeTruthy();
    expect(within(section).getByText("Antiga (9 dias)")).toBeTruthy();
    expect(within(section).getByText(/Dólar comercial - Yahoo Finance/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Atualizar dólar comercial do dia" }));
    await waitFor(() => expect(post.mock.calls[0]![0]).toBe("/economic-settings/exchange-rate/dolar"));
    expect(await screen.findByText("Dólar comercial do dia registrado.")).toBeTruthy();
    expect(screen.getByText(/Versão 1 ·/)).toBeTruthy();
  });

  it("registra sozinha o dólar do dia quando a cotação é antiga, e não repete quando já é de hoje", async () => {
    const mockGet = (cotacao: object) =>
      vi.spyOn(api, "get").mockImplementation(async (url) => {
        if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
        if (url === "/economic-settings/exchange-rate") return { data: { cotacao } };
        throw new Error(`GET inesperado: ${url}`);
      });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { jaRegistrada: false } });
    mockGet({ ...quote, cotadoEm: "2026-10-19T16:05:47.000Z" });
    const stale = renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![0]).toBe("/economic-settings/exchange-rate/dolar");
    stale.unmount();

    post.mockClear();
    mockGet(quote);
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    await screen.findByRole("region", { name: "Câmbio USD → BRL" });
    expect(post).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: /Atualizar dólar/ })).toBeNull();
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

  it("simulação reaberta e depois outro produto: o novo não herda peso e preço da reaberta", () => {
    const saved = {
      quantidade: 3,
      compra: { precoUnitario: "100", moeda: "USD" },
      pesoUnitarioKg: "0.5",
      cambio: { referencia: "5", acrescimo: "0.2" },
      cambioOrigem: { origem: "COTACAO_REGISTRADA" },
      frete: { valorPorKg: "10", moeda: "USD" },
      encargosCompra: [],
      venda: { precoUnitarioBrl: "900", marketplace: null, notaFiscal: { modo: "PERCENTUAL_VENDA_BRUTA", percentual: "5" }, outrosEncargos: [] },
      markupAlertaPercentual: "25",
      parametroEconomicoId: "param-1",
      produto: { id: "a", nome: "A", codigo: 1 }
    } as SavedEntrada;
    const reopened = formFromSaved(saved, initialForm(settingsData, null));
    expect([reopened.peso, reopened.precoVenda]).toEqual(["0.5", "900"]);
    const withB = withProduct(reopened, b);
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

  it("versão nova durante a edição: as taxas oferecidas e enviadas continuam sendo da versão fixada", async () => {
    const user = userEvent.setup();
    let current = { vigente, versoes: [], referenciasPO };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: current };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      if (url === "/purchase-simulations") return { data: { items: [], total: 0, page: 1, limit: 10 } };
      if (url === "/products") return { data: { items: [mac] } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { resultado } });
    const { queryClient } = renderWithProviders(<PurchaseSimulatorPage />, { permissions: ["SIMULACAO_VISUALIZAR", "CATALOGO_VISUALIZAR"] });
    expect((await screen.findByRole("combobox", { name: "Taxa do marketplace" })).textContent).toContain("Parcelado em 2x");
    current = {
      ...current,
      vigente: { ...vigente, id: "param-2", taxasMarketplace: [{ id: "taxa-avista", canal: "MERCADO_LIVRE", modalidade: "A_VISTA", parcelas: null, percentual: "12", descricao: null }] }
    } as never;
    await queryClient.invalidateQueries();
    await user.click(screen.getByRole("combobox", { name: "Taxa do marketplace" }));
    expect(await screen.findByRole("option", { name: /Parcelado em 2x · 16,00%/ })).toBeTruthy();
    // A taxa da versão 2 não é oferecida a um formulário fixado na versão 1.
    expect(screen.queryByRole("option", { name: /À vista · 12,00%/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.type(screen.getByRole("combobox", { name: "Produto" }), "Mac");
    await user.click(await screen.findByText("MacBook Air 13 M1 16GB 512GB"));
    await waitFor(() => expect(post.mock.calls.some(([url]) => url === "/purchase-simulations/calculate")).toBe(true), { timeout: 2000 });
    const body = post.mock.calls.filter(([url]) => url === "/purchase-simulations/calculate").at(-1)![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      parametroEconomicoId: "param-1",
      venda: { marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16" } }
    });
  });

  it("base fiscal informada ainda vazia não bloqueia o cálculo: a nota segue como pendente", () => {
    const comBaseInformada = { vigente: { ...vigente, notaFiscalBase: "BASE_INFORMADA" }, versoes: [], referenciasPO };
    const form = ready(comBaseInformada);
    expect([form.notaModo, form.notaBase]).toEqual(["PERCENTUAL_BASE_INFORMADA", ""]);
    const pending = buildPayload(form, quote as never) as { venda: { notaFiscal: object } } | null;
    expect(pending).not.toBeNull();
    expect(pending!.venda.notaFiscal).toEqual({ modo: "BASE_PENDENTE", percentual: "5" });
    const informed = buildPayload({ ...form, notaBase: "500" }, quote as never) as { venda: { notaFiscal: object } };
    expect(informed.venda.notaFiscal).toEqual({ modo: "PERCENTUAL_BASE_INFORMADA", percentual: "5", baseUnitariaBrl: "500" });
    expect(buildPayload({ ...form, notaBase: "abc" }, quote as never)).toBeNull();
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

describe("texto livre nas Configurações", () => {
  it("vírgula decimal vira ponto só nos números; observações e descrições ficam como digitadas", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: { vigente, versoes: [], referenciasPO } };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const acrescimo = await screen.findByLabelText(/Acréscimo cambial/);
    await user.clear(acrescimo);
    await user.type(acrescimo, "0,25");
    await user.type(screen.getByLabelText("Observações"), "Plano A, confirmar parcelas");
    await user.type(screen.getByLabelText("Descrição"), "Referência PO, 2x");
    await user.click(screen.getByRole("button", { name: "Gravar nova versão" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0]![1] as { acrescimoCambialBrl: string; observacoes: string; taxasMarketplace: { descricao: string }[] };
    expect(body.acrescimoCambialBrl).toBe("0.25");
    expect(body.observacoes).toBe("Plano A, confirmar parcelas");
    expect(body.taxasMarketplace[0]!.descricao).toBe("Referência PO, 2x");
  });
});

describe("atualização em segundo plano e nota com base pendente", () => {
  const mockSettings = (state: { current: object }) =>
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: state.current };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });
  const v2 = { ...vigente, id: "param-2", versao: 2, acrescimoCambialBrl: "0.35" };

  it("com rascunho, uma versão nova não apaga a edição e é avisada", async () => {
    const user = userEvent.setup();
    const state = { current: { vigente, versoes: [], referenciasPO } as object };
    mockSettings(state);
    const { queryClient } = renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    await user.type(await screen.findByLabelText("Observações"), "rascunho em andamento");
    await user.type(screen.getByLabelText(/^Fonte/), "banco X");
    state.current = { vigente: v2, versoes: [], referenciasPO };
    await queryClient.invalidateQueries();
    expect(await screen.findByText(/A versão 2 foi gravada enquanto você editava/)).toBeTruthy();
    expect((screen.getByLabelText("Observações") as HTMLInputElement).value).toBe("rascunho em andamento");
    expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).value).toBe("0.2");
    expect((screen.getByLabelText(/^Fonte/) as HTMLInputElement).value).toBe("banco X");
    await user.click(screen.getByRole("button", { name: "Descartar rascunho e carregar a versão vigente" }));
    expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).value).toBe("0.35");
    expect((screen.getByLabelText("Observações") as HTMLInputElement).value).toBe("");
  });

  it("sem edição local, o formulário passa a mostrar a versão nova", async () => {
    const state = { current: { vigente, versoes: [], referenciasPO } as object };
    mockSettings(state);
    const { queryClient } = renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    expect(((await screen.findByLabelText(/Acréscimo cambial/)) as HTMLInputElement).value).toBe("0.2");
    state.current = { vigente: v2, versoes: [], referenciasPO };
    await queryClient.invalidateQueries();
    await waitFor(() => expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).value).toBe("0.35"));
    expect(screen.queryByText(/foi gravada enquanto você editava/)).toBeNull();
  });

  it("base pendente guarda o percentual conhecido e a reabertura o recupera", () => {
    const settingsPendente = { vigente: { ...vigente, notaFiscalBase: null }, versoes: [], referenciasPO } as never;
    const form = { ...withProduct(initialForm(settingsPendente, quote as never), { id: "a", nome: "A", codigo: 1, peso: "0.5", precoVenda: "900" }), precoCompra: "100" };
    expect(form.notaModo).toBe("BASE_PENDENTE");
    const payload = buildPayload(form, quote as never) as { venda: { notaFiscal: object } } & Record<string, unknown>;
    expect(payload.venda.notaFiscal).toEqual({ modo: "BASE_PENDENTE", percentual: "5" });
    const entrada = { ...payload, cambio: null, cambioOrigem: { origem: "COTACAO_REGISTRADA" }, produto: { id: "a", nome: "A", codigo: 1 } } as unknown as SavedEntrada;
    const reopened = formFromSaved(entrada, initialForm(settingsPendente, null));
    expect([reopened.notaModo, reopened.notaPercentual]).toEqual(["BASE_PENDENTE", "5"]);
  });
});

describe("gravação dos parâmetros com outros operadores", () => {
  const mockSettings = (state: { current: object }) =>
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: state.current };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });

  it("durante a gravação os campos ficam travados; depois voltam a aceitar edição", async () => {
    const user = userEvent.setup();
    mockSettings({ current: { vigente, versoes: [], referenciasPO } });
    let respond!: () => void;
    vi.spyOn(api, "post").mockReturnValue(new Promise((resolve) => (respond = () => resolve({ data: {} }))));
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    await user.click(await screen.findByRole("button", { name: "Gravar nova versão" }));
    await waitFor(() => expect((screen.getByLabelText("Observações") as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByLabelText(/Acréscimo cambial/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remover taxa 1" }) as HTMLButtonElement).disabled).toBe(true);
    respond();
    await waitFor(() => expect((screen.getByLabelText("Observações") as HTMLInputElement).disabled).toBe(false));
  });

  it("mesmo conteúdo gravado sobre outra versão de base usa chave nova (vira versão nova)", async () => {
    const user = userEvent.setup();
    const state = { current: { vigente, versoes: [], referenciasPO } as object };
    mockSettings(state);
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    const { queryClient } = renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const save = await screen.findByRole("button", { name: "Gravar nova versão" });
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Outro operador gravou uma versão com os mesmos valores; o formulário passa a ter outra base.
    state.current = { vigente: { ...vigente, id: "param-3", versao: 3 }, versoes: [], referenciasPO };
    await queryClient.invalidateQueries();
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map(([, body, config]) => ({
      body: JSON.stringify(body),
      key: (config as { headers: Record<string, string> }).headers["Idempotency-Key"]
    }));
    expect(second!.body).toBe(first!.body);
    expect(second!.key).not.toBe(first!.key);
  });
});

describe("pendências da revisão de Configurações", () => {
  const mockSettings = (state: { current: object }) =>
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/economic-settings") return { data: state.current };
      if (url === "/economic-settings/exchange-rate") return { data: { cotacao: quote } };
      throw new Error(`GET inesperado: ${url}`);
    });

  it("resposta perdida + refetch com a versão criada + retry: mesma chave e mesmo payload", async () => {
    const user = userEvent.setup();
    const state = { current: { vigente, versoes: [], referenciasPO } as object };
    mockSettings(state);
    // 1-2. O servidor grava, mas a resposta se perde.
    const post = vi.spyOn(api, "post").mockRejectedValueOnce(new Error("resposta perdida")).mockResolvedValue({ data: {} });
    const { queryClient } = renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const save = await screen.findByRole("button", { name: "Gravar nova versão" });
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // 3. Um refetch traz a versão que o próprio salvamento criou (mesmos valores, outra versão de base).
    state.current = { vigente: { ...vigente, id: "param-2", versao: 2 }, versoes: [], referenciasPO };
    await queryClient.invalidateQueries();
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    // 4. O operador repete o salvamento.
    await user.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, retry] = post.mock.calls.map(([, body, config]) => ({
      body: JSON.stringify(body),
      key: (config as { headers: Record<string, string> }).headers["Idempotency-Key"]
    }));
    // 5. O retry não é uma operação nova: o servidor devolve o registro já gravado.
    expect(retry!.body).toBe(first!.body);
    expect(retry!.key).toBe(first!.key);
  });

  it("cotação manual: campos e botão bloqueados enquanto o envio está pendente, liberados depois", async () => {
    const user = userEvent.setup();
    mockSettings({ current: { vigente, versoes: [], referenciasPO } });
    let respond!: () => void;
    const post = vi.spyOn(api, "post").mockReturnValue(new Promise((resolve) => (respond = () => resolve({ data: {} }))));
    renderWithProviders(<EconomicSettingsPage />, { permissions: ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"] });
    const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
    await user.type(await screen.findByLabelText(/^Referência \(R\$ por US\$\)/), "5,1");
    await user.type(field(/^Fonte/), "banco X");
    await user.type(field(/^Cotada em/), "2026-10-19T10:00");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(post.mock.calls.some(([url]) => url === "/finance/exchange-rates")).toBe(true));
    for (const label of [/^Referência \(R\$ por US\$\)/, /^Acréscimo \(R\$\)/, /^Fonte/, /^Cotada em/]) expect(field(label).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement).disabled).toBe(true);
    respond();
    await waitFor(() => expect(field(/^Fonte/).disabled).toBe(false));
    for (const label of [/^Referência \(R\$ por US\$\)/, /^Acréscimo \(R\$\)/, /^Cotada em/]) expect(field(label).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
