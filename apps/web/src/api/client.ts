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

async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await axios.post<{ accessToken: string }>(
      `${API_URL}/auth/refresh`,
      undefined,
      { withCredentials: true }
    );
    const accessToken = response.data.accessToken;
    useAuthStore.setState({ accessToken });
    return accessToken;
  } catch {
    return null;
  }
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
  refreshPromise ??= refreshAccessToken().finally(() => {
    refreshPromise = null;
  });
  const accessToken = await refreshPromise;
  if (!accessToken) {
    useAuthStore.getState().clear();
    queryClient.clear();
    sessionRedirect.toLogin();
    return Promise.reject(error);
  }
  config.headers.set("Authorization", `Bearer ${accessToken}`);
  return api(config);
});
