import axios, { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAccessTokenOnce } from "../src/api/client";
import { useAuthStore } from "../src/stores/auth";

const rejection = (status: number, error: string) =>
  new AxiosError("falha", "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: { error },
    headers: {},
    config: { headers: new AxiosHeaders() }
  });

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null });
});

describe("renovação recusada por outra aba (409 refresh_concorrente)", () => {
  it("tenta de novo e recupera a sessão com o cookie já atualizado", async () => {
    const post = vi
      .spyOn(axios, "post")
      .mockRejectedValueOnce(rejection(409, "refresh_concorrente"))
      .mockResolvedValueOnce({ data: { accessToken: "da-outra-aba" } });
    await expect(refreshAccessTokenOnce()).resolves.toBe("da-outra-aba");
    expect(post).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().accessToken).toBe("da-outra-aba");
  });

  it("não insiste além de três novas tentativas", async () => {
    const post = vi.spyOn(axios, "post").mockRejectedValue(rejection(409, "refresh_concorrente"));
    await expect(refreshAccessTokenOnce()).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(4);
  }, 10_000);

  it("401 (reuso, logout, expirado) não é repetido", async () => {
    const post = vi.spyOn(axios, "post").mockRejectedValue(rejection(401, "invalid_refresh_token"));
    await expect(refreshAccessTokenOnce()).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
