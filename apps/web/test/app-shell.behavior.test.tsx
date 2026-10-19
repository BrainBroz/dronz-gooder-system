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
  "/logistica", "/estoque", "/financeiro", "/relatorios", "/vendas", "/compras/painel-mensal",
  "/compras/revisao", "/posicoes"
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
    expect(currentPageLabel("/compras/revisao")).toEqual({ group: "Compras", label: "Revisão de compras" });
    expect(currentPageLabel("/compras")).toEqual({ group: "Compras", label: "Fila de compras" });
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
    "em %s só o submenu específico fica ativo, não a Fila de compras",
    async (route) => {
      const user = userEvent.setup();
      renderWithProviders(<Shell>Conteúdo</Shell>, { route, permissions: ["SYSTEM_ADMIN"] });
      await user.click(screen.getByRole("button", { name: "Abrir menu" }));
      const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.getAttribute("href"))).toEqual([route]);
    }
  );

  it("troca a loja ativa pelos botões; \"Todos\" fica indisponível sem visão consolidada", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shell>Conteúdo</Shell>);
    expect((screen.getByRole("button", { name: "Todas as lojas (indisponível)" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Dronz" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Gooder" }));
    expect(useAuthStore.getState().activeStoreId).toBe(testStores[1]!.id);
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
