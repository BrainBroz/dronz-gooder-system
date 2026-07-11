import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  AppRoutes,
  catalogQueryKeys,
  formatSalePrice,
  purchasingQueryKeys,
  logisticsQueryKeys,
  inventoryQueryKeys,
  financeQueryKeys,
  dashboardQueryKeys,
  queryClient
} from "../src/app";

describe("web app", () => {
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
});
