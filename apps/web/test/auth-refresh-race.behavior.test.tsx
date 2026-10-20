import React from "react";
import axios from "axios";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../src/api/client";
import { AuthGate } from "../src/app";
import { useAuthStore } from "../src/stores/auth";
import { createTestQueryClient, testStores, testUser } from "./render";

// Servidor simulado com a mesma regra do backend: o refresh token é rotacionado no primeiro uso, então
// um segundo POST /auth/refresh com o mesmo cookie recebe 401 (e chega depois do primeiro).
function rotatingRefreshServer() {
  let calls = 0;
  const refresh = () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => setTimeout(() => resolve({ data: { accessToken: "novo" } }), 5));
    return new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("401"), { response: { status: 401, data: { error: "invalid_refresh_token" } } })), 20)
    );
  };
  return { refresh, calls: () => calls };
}

beforeEach(() => vi.restoreAllMocks());

describe("restauração de sessão sob StrictMode", () => {
  it("efeito executado duas vezes faz uma única renovação e não derruba a sessão", async () => {
    const server = rotatingRefreshServer();
    const fake = ((url: string) => (String(url).includes("/auth/refresh") ? server.refresh() : Promise.reject(new Error(`POST ${url}`)))) as never;
    vi.spyOn(api, "post").mockImplementation(fake);
    vi.spyOn(axios, "post").mockImplementation(fake);
    vi.spyOn(api, "get").mockResolvedValue({ data: { user: testUser, lojas: testStores, permissoes: [] } });

    useAuthStore.setState({ accessToken: null, user: null, stores: [], permissions: [], activeStoreId: null });
    // StrictMode na raiz, como em main.tsx: o efeito do AuthGate roda duas vezes na montagem.
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AuthGate>Protegido</AuthGate>} />
            <Route path="/login" element={<div>Login requerido</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
      { reactStrictMode: true }
    );

    expect(await screen.findByText("Protegido")).toBeTruthy();
    // Espera além da resposta tardia: uma segunda renovação rejeitada não pode limpar a sessão.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByText("Login requerido")).toBeNull();
    expect(useAuthStore.getState().accessToken).toBe("novo");
    await waitFor(() => expect(server.calls()).toBe(1));
  });
});
