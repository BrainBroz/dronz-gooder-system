import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../src/app";
import { queryClient } from "../src/api/client";
import {
  catalogQueryKeys,
  purchasingQueryKeys,
  logisticsQueryKeys,
  inventoryQueryKeys,
  financeQueryKeys,
  dashboardQueryKeys,
  reportQueryKeys
} from "../src/queryKeys";
import { formatSalePrice } from "../src/utils/formatting";
import { ContentCard } from "../src/components/ui/ContentCard";
import { PageContainer } from "../src/components/ui/PageContainer";
import { PageHeader } from "../src/components/ui/PageHeader";
import { appTheme, visualTokens } from "../src/theme";

describe("web app", () => {
  it("aplica a fundação visual oficial em componentes compartilhados", () => {
    const html = renderToStaticMarkup(
      <PageContainer>
        <PageHeader title="Operação" description="Loja ativa: Dronz" />
        <ContentCard title="Dados da operação">Conteúdo real</ContentCard>
      </PageContainer>
    );

    expect(html).toContain("Operação");
    expect(html).toContain("Loja ativa: Dronz");
    expect(html).toContain("Dados da operação");
    // Referência visual aprovada (Bolt): Dronz verde, Gooder roxo.
    expect(visualTokens.dronz).toBe("#22C55E");
    expect(visualTokens.gooder).toBe("#A855F7");
    expect(appTheme.palette.background.default).toBe(visualTokens.bg);
  });

  it("textos secundários mantêm contraste AA sobre fundo, cards e menus", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    for (const text of [visualTokens.text, visualTokens.textSecondary, visualTokens.textMuted])
      for (const background of [visualTokens.bg, visualTokens.bg2, visualTokens.bg3])
        expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("redireciona a raiz para o fluxo autenticado", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(html).not.toContain("404");
  });

  it("renders the login route shell", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(html).toContain("Entrar");
  });

  it("renders the 404 page", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/desconhecida"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(html).toContain("404");
  });

  it("configura QueryClient e separa cache por loja", () => {
    expect(queryClient).toBeTruthy();
    expect(catalogQueryKeys.categories("dronz-id")).not.toEqual(
      catalogQueryKeys.categories("gooder-id")
    );
    expect(catalogQueryKeys.products("dronz-id")).not.toEqual(
      catalogQueryKeys.products("gooder-id")
    );
  });

  it("exibe preço zero como A definir", () => {
    expect(formatSalePrice("0")).toBe("A definir");
    expect(formatSalePrice("49.90")).toBe("49.90");
  });
  it("isola caches de compras por loja", () => {
    expect(purchasingQueryKeys.suppliers("d")).not.toEqual(
      purchasingQueryKeys.suppliers("g")
    );
    expect(purchasingQueryKeys.orders("d")).not.toEqual(
      purchasingQueryKeys.orders("g")
    );
  });
  it("isola caches logísticos por loja", () => {
    expect(logisticsQueryKeys.suitcases("d")).not.toEqual(
      logisticsQueryKeys.suitcases("g")
    );
  });
  it("isola caches de estoque por loja", () => {
    expect(inventoryQueryKeys.stock("d")).not.toEqual(
      inventoryQueryKeys.stock("g")
    );
  });
  it("isola caches financeiros por loja", () => {
    expect(financeQueryKeys.payments("d")).not.toEqual(
      financeQueryKeys.payments("g")
    );
  });
  it("isola o dashboard por loja", () => {
    expect(dashboardQueryKeys.summary("d")).not.toEqual(
      dashboardQueryKeys.summary("g")
    );
  });
  it("isola relatórios por loja e filtros", () => {
    expect(reportQueryKeys.report("d", "inventory", "", "")).not.toEqual(
      reportQueryKeys.report("g", "inventory", "", "")
    );
    expect(
      reportQueryKeys.report("d", "inventory", "2026-01-01", "")
    ).not.toEqual(reportQueryKeys.report("d", "inventory", "", ""));
  });
});
