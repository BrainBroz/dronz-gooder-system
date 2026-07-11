import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes, AuthProvider } from "../src/app";

describe("web app", () => {
  it("renders the login route shell", () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(html).toContain("Entrar");
  });

  it("renders the 404 page", () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={["/desconhecida"]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(html).toContain("404");
  });
});
