import React from "react";
import axios, {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from "axios";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, queryClient, sessionRedirect } from "../src/api/client";
import { FinancePage } from "../src/pages/FinancePage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders } from "./render";

const ok = (data: unknown) => Promise.resolve({ data });

function unauthorized(config: InternalAxiosRequestConfig): never {
  const response = {
    data: { code: "unauthorized" },
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config
  } as AxiosResponse;
  throw new AxiosError(
    "Request failed with status code 401",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    response
  );
}

describe("FIX-0 — câmbio envia valorMercado", () => {
  it("registra cotação com o campo valorMercado exigido pela API", async () => {
    vi.spyOn(api, "get").mockImplementation((url) =>
      url === "/purchase-orders" ? ok({ items: [] }) : ok([])
    );
    const post = vi.spyOn(api, "post").mockImplementation(() => ok({}));
    const user = userEvent.setup();
    renderWithProviders(<FinancePage />);
    await user.type(screen.getByLabelText("Cotação"), "5.4321");
    await user.click(screen.getByRole("button", { name: "Registrar câmbio" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/finance/exchange-rates");
    expect(payload.valorMercado).toBe(5.4321);
    expect(payload).not.toHaveProperty("valor");
    expect(payload.moedaOrigem).toBe("BRL");
    expect(payload.moedaDestino).toBe("USD");
    expect(typeof payload.cotadoEm).toBe("string");
  });
});

describe("FIX-0 — recuperação global de sessão expirada", () => {
  it("renova o access token em 401 e repete a requisição original", async () => {
    useAuthStore.setState({ accessToken: "token-antigo" });
    let chamadas = 0;
    api.defaults.adapter = async (config) => {
      chamadas += 1;
      if (chamadas === 1) unauthorized(config);
      return {
        data: {
          ok: true,
          authorization: config.headers.get?.("Authorization") ?? null
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config
      };
    };
    vi.spyOn(axios, "post").mockResolvedValueOnce({
      data: { accessToken: "token-renovado" }
    });
    const resposta = await api.get("/finance/payments");
    expect(resposta.data.ok).toBe(true);
    expect(resposta.data.authorization).toBe("Bearer token-renovado");
    expect(useAuthStore.getState().accessToken).toBe("token-renovado");
    expect(chamadas).toBe(2);
  });

  it("limpa a sessão e redireciona ao login quando o refresh falha", async () => {
    useAuthStore.setState({ accessToken: "token-antigo" });
    api.defaults.adapter = async (config) => unauthorized(config);
    vi.spyOn(axios, "post").mockRejectedValueOnce(new Error("refresh_failed"));
    const toLogin = vi
      .spyOn(sessionRedirect, "toLogin")
      .mockImplementation(() => undefined);
    queryClient.setQueryData(["sentinela"], { valor: 1 });
    await expect(api.get("/finance/payments")).rejects.toBeTruthy();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(queryClient.getQueryData(["sentinela"])).toBeUndefined();
    expect(toLogin).toHaveBeenCalledTimes(1);
  });

  it("tenta o retry uma única vez quando a repetição também recebe 401", async () => {
    useAuthStore.setState({ accessToken: "token-antigo" });
    let chamadas = 0;
    api.defaults.adapter = async (config) => {
      chamadas += 1;
      unauthorized(config);
    };
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "token-renovado" }
    });
    await expect(api.get("/finance/payments")).rejects.toBeTruthy();
    // original + exatamente 1 retry; o segundo 401 rejeita sem novo ciclo.
    expect(chamadas).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("compartilha um único refresh entre requisições concorrentes", async () => {
    useAuthStore.setState({ accessToken: "token-antigo" });
    api.defaults.adapter = async (config) => {
      if (config.headers.get?.("Authorization") === "Bearer token-renovado") {
        return {
          data: { ok: true },
          status: 200,
          statusText: "OK",
          headers: {},
          config
        };
      }
      unauthorized(config);
    };
    let liberarRefresh!: (valor: { data: { accessToken: string } }) => void;
    const refresh = vi.spyOn(axios, "post").mockReturnValue(
      new Promise((resolve) => {
        liberarRefresh = resolve;
      }) as never
    );
    const primeira = api.get("/finance/payments");
    const segunda = api.get("/purchase-orders");
    await new Promise((resolve) => setTimeout(resolve, 20));
    liberarRefresh({ data: { accessToken: "token-renovado" } });
    const [r1, r2] = await Promise.all([primeira, segunda]);
    expect(r1.data.ok).toBe(true);
    expect(r2.data.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("não intercepta falha de login nem entra em loop de refresh", async () => {
    useAuthStore.setState({ accessToken: null });
    api.defaults.adapter = async (config) => unauthorized(config);
    const refresh = vi.spyOn(axios, "post");
    await expect(api.post("/auth/login", {})).rejects.toBeTruthy();
    expect(refresh).not.toHaveBeenCalledWith(
      expect.stringContaining("/auth/refresh"),
      undefined,
      expect.anything()
    );
  });
});
