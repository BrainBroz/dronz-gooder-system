import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes, catalogQueryKeys, formatSalePrice, queryClient } from "../src/app";

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
    expect(catalogQueryKeys.categories("dronz-id")).not.toEqual(catalogQueryKeys.categories("gooder-id"));
    expect(catalogQueryKeys.products("dronz-id")).not.toEqual(catalogQueryKeys.products("gooder-id"));
  });

  it("exibe preço zero como A definir", () => {
    expect(formatSalePrice("0")).toBe("A definir");
    expect(formatSalePrice("49.90")).toBe("49.90");
  });
});
