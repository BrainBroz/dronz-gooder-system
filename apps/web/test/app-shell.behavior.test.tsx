import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { api } from "../src/api/client";
import { Shell } from "../src/app";
import { HomePage, date, plainDefinition } from "../src/pages/HomePage";
import { dashboardQueryKeys } from "../src/queryKeys";
import { appNavigation, currentPageLabel, visibleNavigation } from "../src/navigation/appNavigation";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const routesInApp = [
  "/", "/operacao", "/checkpoints", "/categorias", "/produtos", "/fornecedores", "/compras", "/pedidos",
  "/logistica", "/estoque", "/financeiro", "/relatorios", "/vendas", "/compras/painel-mensal", "/integracoes",
  "/compras/revisao", "/compras/fila", "/posicoes", "/compras/simulador", "/configuracoes", "/estoque/miami", "/estoque/brasil"
];

beforeEach(() => vi.restoreAllMocks());

describe("navegação agrupada", () => {
  it("só aponta para rotas existentes", () => {
    const paths = appNavigation.flatMap((group) => group.children?.map((child) => child.path) ?? [group.path!]);
    expect(paths.filter((path) => !routesInApp.includes(path))).toEqual([]);
  });

  it("esconde grupos sem nenhum link permitido e mostra tudo ao administrador", () => {
    const labels = (granted: string[]) => visibleNavigation(granted).map((group) => group.label);
    expect(labels([])).toEqual(["Dashboard", "Logística"]);
    expect(labels(["VENDA_VISUALIZAR"])).toContain("Vendas e Financeiro");
    expect(visibleNavigation(["VENDA_VISUALIZAR"]).find((g) => g.key === "finance")?.children?.map((c) => c.label)).toEqual(["Vendas"]);
    expect(labels(["SYSTEM_ADMIN"])).toHaveLength(appNavigation.length);
  });

  it("identifica a página atual pela rota mais específica", () => {
    expect(currentPageLabel("/compras/revisao")).toEqual({ group: "Compras", label: "Avançado: divergências" });
    expect(currentPageLabel("/compras")).toEqual({ group: "Compras", label: "Compras" });
    expect(currentPageLabel("/")).toEqual({ group: "Dashboard", label: "Dashboard" });
  });

  it("marca a página ativa e abre o grupo dela", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shell>Conteúdo</Shell>, { route: "/posicoes" });
    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(screen.getByRole("link", { name: "Posições" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Logística" }).getAttribute("aria-expanded")).toBe("true");
  });

  it.each(["/compras/revisao", "/compras/painel-mensal"])(
    "em %s só o submenu específico fica ativo, não o item Compras",
    async (route) => {
      const user = userEvent.setup();
      renderWithProviders(<Shell>Conteúdo</Shell>, { route, permissions: ["SYSTEM_ADMIN"] });
      await user.click(screen.getByRole("button", { name: "Abrir menu" }));
      const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.getAttribute("href"))).toEqual([route]);
    }
  );

  it("controles do cabeçalho são alcançáveis pelo teclado", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shell>Conteúdo</Shell>);
    const targets = [
      screen.getByRole("button", { name: "Dronz" }),
      screen.getByRole("button", { name: "Gooder" }),
      screen.getByRole("button", { name: "Menu do usuário" })
    ];
    for (const target of targets) {
      for (let i = 0; i < 10 && document.activeElement !== target; i++) await user.tab();
      // jsdom não implementa :focus-visible; o contorno em si é conferido no navegador.
      expect(document.activeElement).toBe(target);
    }
  });

  it("troca a loja ativa pelos botões; \"Todos\" liga a visão de todas as lojas sem perder a loja ativa", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shell>Conteúdo</Shell>);
    expect(screen.getByRole("button", { name: "Todas as lojas" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Dronz" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Todas as lojas" }));
    expect(useAuthStore.getState().viewAll).toBe(true);
    expect(useAuthStore.getState().activeStoreId).toBe(testStores[0]!.id);
    expect(screen.getByRole("button", { name: "Todas as lojas" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Dronz" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Gooder" }));
    expect(useAuthStore.getState().activeStoreId).toBe(testStores[1]!.id);
    expect(useAuthStore.getState().viewAll).toBe(false);
    expect(screen.getByRole("button", { name: "Gooder" }).getAttribute("aria-pressed")).toBe("true");
  });
});

const home = { referenciaEm: "2026-10-17T12:00:00.000Z", secoes: [] };
const summary = {
  orders: { count: 7, total: null, byStatus: { PLACED: 4, CONFIRMED: 3 } },
  openTrips: 2,
  pendingReceiving: 1,
  inventory: { available: 40, reserved: 5, zero: 3 },
  payments: { pending: 0, paid: null },
  belowMarkup: 2
};

describe("dashboard", () => {
  it("sem permissão de análise não consulta indicadores nem mostra zeros", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home") return { data: home };
      if (url === "/logistics/trips") return { data: [] };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>,
      { permissions: [] }
    );
    expect(await screen.findByText(/Indicadores consolidados exigem permissão/)).toBeTruthy();
    expect(screen.getByText("Sem permissão para ver pedidos de compra.")).toBeTruthy();
    expect(await screen.findByText("Nenhuma viagem ativa nesta loja.")).toBeTruthy();
    expect(get.mock.calls.map(([url]) => url).sort()).toEqual(["/logistics/trips", "/operations/home"]);
  });

  it("mostra carregamento e depois indicadores da loja ativa; valor sem acesso financeiro não vira zero", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home") return { data: home };
      if (url === "/logistics/trips") return { data: [] };
      if (url === "/purchase-orders") return { data: { items: [] } };
      if (url === "/analytics/dashboard") {
        await gate;
        return { data: summary };
      }
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<HomePage />, {
      permissions: ["ANALYTICS_VISUALIZAR", "PEDIDOS_COMPRA_VISUALIZAR", "CATALOGO_VISUALIZAR"],
      activeStoreId: testStores[1]!.id
    });
    expect(await screen.findByText("Carregando os indicadores…")).toBeTruthy();
    release();
    expect(await screen.findByText("Valores exigem acesso financeiro")).toBeTruthy();
    expect(screen.getByText("Valores econômicos exigem acesso financeiro.")).toBeTruthy();
    expect(screen.getByText("2 produto(s) com markup abaixo de 25%")).toBeTruthy();
    expect(screen.getByText("Emitido")).toBeTruthy();
    expect(screen.queryByText(/R\$\s?0,00/)).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
    for (const [, config] of get.mock.calls as [string, { headers: Record<string, string> }][])
      expect(config.headers["x-store-id"]).toBe(testStores[1]!.id);
  });

  it("falha de um bloco aparece como erro, não como vazio", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home") return { data: home };
      throw new Error("offline");
    });
    renderWithProviders(<HomePage />, { permissions: [] });
    expect(await screen.findByText("Não foi possível carregar as viagens. Tente novamente.")).toBeTruthy();
    expect(screen.queryByText("Nenhuma viagem ativa nesta loja.")).toBeNull();
  });

  it("trocar de loja com o dashboard aberto não mistura dados; resposta atrasada da loja anterior é descartada", async () => {
    const user = userEvent.setup();
    let releaseDronz!: () => void;
    const dronzGate = new Promise<void>((resolve) => (releaseDronz = resolve));
    const order = (numero: string) => ({
      id: numero, numeroPedido: numero, status: "PLACED", dataCompra: "2026-10-10T12:00:00.000Z",
      total: "10", moeda: "USD", fornecedor: { nome: `Fornecedor ${numero}` }
    });
    const byStore = (store: string) =>
      store === testStores[0]!.id
        ? { orders: [order("PEDIDO-DRONZ")], count: 3 }
        : { orders: [order("PEDIDO-GOODER")], count: 9 };
    vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      const store = (config as { headers: Record<string, string> }).headers["x-store-id"]!;
      if (store === testStores[0]!.id) await dronzGate;
      const data = byStore(store);
      if (url === "/operations/home") return { data: home };
      if (url === "/logistics/trips") return { data: [] };
      if (url === "/purchase-orders") return { data: { items: data.orders } };
      if (url === "/analytics/dashboard") return { data: { ...summary, orders: { ...summary.orders, count: data.count } } };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(
      <Shell>
        <HomePage />
      </Shell>,
      { permissions: ["ANALYTICS_VISUALIZAR", "PEDIDOS_COMPRA_VISUALIZAR"] }
    );
    expect(await screen.findByText("Carregando os indicadores…")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Gooder" }));
    expect(await screen.findByText("PEDIDO-GOODER")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();

    releaseDronz();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("PEDIDO-DRONZ")).toBeNull();
    expect(screen.getByText("PEDIDO-GOODER")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dronz" }));
    expect(await screen.findByText("PEDIDO-DRONZ")).toBeTruthy();
    expect(screen.queryByText("PEDIDO-GOODER")).toBeNull();
  });

  it("remove códigos internos das definições", () => {
    expect(plainDefinition("Linhas de reserva em volumes ainda não fechados (F-8).")).toBe(
      "Linhas de reserva em volumes ainda não fechados."
    );
    expect(plainDefinition("Viagens com envio (08:00–12:00 no fuso da origem, PD-08) ainda não em trânsito.")).toBe(
      "Viagens com envio (08:00–12:00 no fuso da origem) ainda não em trânsito."
    );
    expect(plainDefinition("Volumes em PLANNING com pelo menos uma reserva.")).toBe(
      "Volumes em preparação com pelo menos uma reserva."
    );
  });

  it("datas usam o fuso operacional, não o do navegador", () => {
    // 02:00 UTC do dia 18 ainda é dia 17 em America/Sao_Paulo.
    expect(date("2026-10-18T02:00:00.000Z")).toBe("17/10/2026");
  });

  it("mantém o rótulo de escopo da seção nas pendências", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home")
        return {
          data: {
            referenciaEm: "2026-10-17T12:00:00.000Z",
            secoes: [{ codigo: "COMPRAS", titulo: "Compras (staging global)", rota: "/compras", itens: [{ codigo: "C1", titulo: "Conflitos", quantidade: 2, definicao: "Conflitos abertos." }] }]
          }
        };
      if (url === "/logistics/trips") return { data: [] };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<HomePage />, { permissions: [] });
    expect(await screen.findByText("Compras (staging global)")).toBeTruthy();
    expect(screen.getByText("Conflitos")).toBeTruthy();
  });

  it("aprovar compensação recalcula os indicadores do dashboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home")
        return { data: { referenciaEm: "2026-10-17T12:00:00.000Z", secoes: [{ codigo: "CORRECOES", titulo: "Correções", rota: "/", itens: [] }] } };
      if (url === "/logistics/trips") return { data: [] };
      if (url === "/analytics/dashboard") return { data: summary };
      if (url === "/operations/corrections/requests")
        return { data: [{ id: "req-1", createdAt: "2026-10-17T11:00:00.000Z", payload: { reason: "Avaria", adjustments: [{ quantityDelta: -1 }] }, propostoPor: { name: "Ana" } }] };
      throw new Error(`GET inesperado: ${url}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    const { queryClient } = renderWithProviders(<HomePage />, { permissions: ["ANALYTICS_VISUALIZAR"] });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dashboardQueryKeys.summary(testStores[0]!.id) })
    );
  });
});

describe("lateral no desktop", () => {
  // jsdom não tem matchMedia: simula a largura de desktop só neste bloco.
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }));
    return () => vi.unstubAllGlobals();
  });

  it("começa aberta, recolhe e reabre ao escolher um grupo com submenu", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shell>Conteúdo</Shell>, { permissions: ["SYSTEM_ADMIN"] });
    expect(screen.queryByRole("button", { name: "Abrir menu" })).toBeNull();
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
    expect(screen.getByRole("button", { name: "Expandir menu lateral" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Compras" })).toBeNull();
    // Recolhida, cada grupo continua identificável pelo nome acessível.
    const compras = screen.getByRole("button", { name: "Compras" });
    expect(compras.getAttribute("aria-expanded")).toBe("false");

    await user.click(compras);
    expect(screen.getByRole("button", { name: "Recolher menu lateral" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Compras" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compras" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("dashboard: ramos financeiros", () => {
  const rate = (overrides: object) => ({
    id: "r1", valor: "5.4321", cotadoEm: "2026-10-17T15:00:00.000Z", vigente: true, idadeDias: 0, aviso: null, ...overrides
  });
  const mockFinance = (rates: () => Promise<unknown>) => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home") return { data: home };
      if (url === "/logistics/trips") return { data: [] };
      if (url === "/finance/exchange-rates") return { data: await rates() };
      if (url === "/analytics/dashboard")
        return {
          data: {
            ...summary,
            orders: { ...summary.orders, total: { USD: "10.5", BRL: "20" } },
            payments: { pending: 2, paid: { USD: "5" } }
          }
        };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<HomePage />, { permissions: ["ANALYTICS_VISUALIZAR", "FINANCEIRO_VISUALIZAR"] });
    return get;
  };

  it("com acesso financeiro mostra totais separados por moeda, sem conversão", async () => {
    mockFinance(async () => []);
    expect((await screen.findAllByText(/US\$\s10,50 · R\$\s20,00/)).length).toBe(2);
    expect(screen.getByText(/^US\$\s5,00$/)).toBeTruthy();
    expect(screen.getByText("Valores separados por moeda, sem conversão.", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Valores econômicos exigem acesso financeiro.")).toBeNull();
  });

  it("cotação vigente aparece com valor e idade, pedindo o par USD→BRL", async () => {
    const get = mockFinance(async () => [rate({})]);
    expect(await screen.findByText("USD→BRL 5,4321 · hoje")).toBeTruthy();
    const call = get.mock.calls.find(([url]) => url === "/finance/exchange-rates")!;
    expect((call[1] as { params: object }).params).toEqual({ moedaOrigem: "USD", moedaDestino: "BRL" });
  });

  it("cotação antiga é sinalizada", async () => {
    mockFinance(async () => [rate({ valor: "5.1", idadeDias: 9, aviso: "COTACAO_ANTIGA" })]);
    const chip = await screen.findByText("USD→BRL 5,1 · há 9 d");
    expect(chip.getAttribute("aria-label")).toBe("Cotação vigente antiga: registre uma nova no Financeiro.");
  });

  it("sem cotação ou com erro, o chip diz isso em vez de mostrar valor", async () => {
    mockFinance(async () => {
      throw new Error("offline");
    });
    expect(await screen.findByText("Câmbio indisponível")).toBeTruthy();
  });

  it("lista vazia de cotações é declarada", async () => {
    mockFinance(async () => []);
    expect(await screen.findByText("Sem cotação USD→BRL")).toBeTruthy();
  });
});
