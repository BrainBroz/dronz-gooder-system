import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { api, queryClient } from "../src/api/client";
import { AuthGate, LoginPage, Shell, loadSession } from "../src/app";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores, testUser } from "./render";

const response = (data: unknown) => Promise.resolve({ data });

beforeEach(() => {
  vi.spyOn(api, "post");
  vi.spyOn(api, "get");
});

describe("sessão web", () => {
  it("faz login, apresenta loading, atualiza sessão e redireciona", async () => {
    let resolveLogin!: (value: { data: unknown }) => void;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/operacao" element={<div>Operação autenticada</div>} />
      </Routes>,
      { route: "/login", accessToken: null, user: null, stores: [] }
    );
    await user.type(screen.getByLabelText("E-mail"), "admin@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-teste");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("button", { name: "Entrando..." })).toBeTruthy();
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      "/auth/login",
      { email: "admin@example.test", password: "senha-teste" }
    ]);
    resolveLogin({
      data: { accessToken: "novo-token", user: testUser, stores: testStores }
    });
    await screen.findByText("Operação autenticada");
    expect(useAuthStore.getState().accessToken).toBe("novo-token");
  });

  it("exibe erro de login e permite nova tentativa", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { error: "Credenciais inválidas" } }
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, {
      route: "/login",
      accessToken: null,
      user: null,
      stores: []
    });
    await user.type(screen.getByLabelText("E-mail"), "admin@example.test");
    await user.type(screen.getByLabelText("Senha"), "incorreta");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Falha na operação. Tente novamente.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Entrar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([false, true])(
    "limpa sessão, cache e navega no logout quando API falha=%s",
    async (fails) => {
      vi.mocked(api.post).mockImplementationOnce(() =>
        fails ? Promise.reject(new Error("offline")) : response({ ok: true })
      );
      queryClient.setQueryData(["private"], { secret: true });
      const user = userEvent.setup();
      renderWithProviders(
        <Routes>
          <Route path="/operacao" element={<Shell>Conteúdo</Shell>} />
          <Route path="/login" element={<div>Login após saída</div>} />
        </Routes>,
        { route: "/operacao" }
      );
      await user.click(screen.getByRole("button", { name: "Sair" }));
      await screen.findByText("Login após saída");
      expect(queryClient.getQueryData(["private"])).toBeUndefined();
      expect(useAuthStore.getState().accessToken).toBeNull();
    }
  );

  it("mantém Categorias acessível no menu e oferece navegação móvel", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/operacao" element={<Shell>Conteúdo</Shell>} />
        <Route path="/categorias" element={<div>Categorias acessíveis</div>} />
      </Routes>,
      { route: "/operacao" }
    );

    expect(screen.getByRole("button", { name: "Abrir menu" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Categorias" }));
    expect(await screen.findByText("Categorias acessíveis")).toBeTruthy();
  });

  it("restaura a sessão com uma única atualização e preserva loja autorizada", async () => {
    useAuthStore.setState({
      accessToken: "antigo",
      user: testUser,
      stores: testStores,
      activeStoreId: testStores[1].id
    });
    const setSession = vi.fn(useAuthStore.getState().setSession);
    useAuthStore.setState({ setSession });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { accessToken: "renovado" } });
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { user: testUser, lojas: testStores }
    });
    await loadSession();
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0][1]).toEqual({
      headers: { Authorization: "Bearer renovado" }
    });
    expect(useAuthStore.getState().activeStoreId).toBe(testStores[1].id);
  });

  it("faz fallback da loja removida e suporta lista autorizada vazia", () => {
    useAuthStore.setState({ activeStoreId: "removida", stores: testStores });
    useAuthStore.getState().setSession({
      accessToken: "token",
      user: testUser,
      stores: [testStores[0]]
    });
    expect(useAuthStore.getState().activeStoreId).toBe(testStores[0].id);
    useAuthStore.getState().setSession({ accessToken: "token", user: testUser, stores: [] });
    expect(useAuthStore.getState().activeStoreId).toBeNull();
  });

  it("AuthGate restaura uma vez, não exibe conteúdo antes e redireciona sem sessão", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("sem cookie"));
    renderWithProviders(
      <Routes>
        <Route path="/operacao" element={<AuthGate>Protegido</AuthGate>} />
        <Route path="/login" element={<div>Login requerido</div>} />
      </Routes>,
      { route: "/operacao", accessToken: null, user: null, stores: [] }
    );
    expect(screen.getByText("Carregando...")).toBeTruthy();
    expect(screen.queryByText("Protegido")).toBeNull();
    await screen.findByText("Login requerido");
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
  });
});
