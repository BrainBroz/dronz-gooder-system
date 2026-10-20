import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const api = axios.create({ baseURL: API_URL, withCredentials: true });
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});

// Indireção para permitir substituição em testes jsdom sem navegação real.
export const sessionRedirect = {
  toLogin: () => {
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
  }
};

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

const AUTH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(retryConcurrent = true): Promise<string | null> {
  try {
    const response = await axios.post<{ accessToken: string }>(
      `${API_URL}/auth/refresh`,
      undefined,
      { withCredentials: true }
    );
    const accessToken = response.data.accessToken;
    useAuthStore.setState({ accessToken });
    return accessToken;
  } catch (error) {
    // Outra aba acabou de renovar com o mesmo cookie: o navegador já recebeu o cookie novo; tenta uma vez.
    const concurrent =
      error instanceof AxiosError &&
      error.response?.status === 409 &&
      (error.response.data as { error?: string } | undefined)?.error === "refresh_concorrente";
    if (concurrent && retryConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return refreshAccessToken(false);
    }
    return null;
  }
}

/**
 * Uma única renovação em andamento por vez. O refresh token é rotacionado a cada uso; duas renovações
 * simultâneas com o mesmo cookie (efeito duplo do StrictMode, troca de rota durante uma requisição
 * expirada) fariam a segunda receber 401 e limpar a sessão. Todas compartilham o mesmo POST.
 */
export function refreshAccessTokenOnce(): Promise<string | null> {
  refreshPromise ??= refreshAccessToken().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetriableConfig | undefined;
  const isExpiredSession =
    error.response?.status === 401 &&
    !!config &&
    !config._retried &&
    !!useAuthStore.getState().accessToken &&
    !AUTH_PATHS.some((path) => (config.url ?? "").includes(path));
  if (!isExpiredSession) return Promise.reject(error);
  config._retried = true;
  const accessToken = await refreshAccessTokenOnce();
  if (!accessToken) {
    useAuthStore.getState().clear();
    queryClient.clear();
    sessionRedirect.toLogin();
    return Promise.reject(error);
  }
  config.headers.set("Authorization", `Bearer ${accessToken}`);
  return api(config);
});
