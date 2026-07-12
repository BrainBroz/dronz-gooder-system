import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { api, queryClient } from "../src/api/client";
import { useAuthStore } from "../src/stores/auth";
import { disposeTestQueryClients } from "./render";

const unexpectedRequests: string[] = [];

beforeEach(() => {
  unexpectedRequests.length = 0;
  api.defaults.adapter = async (config) => {
    unexpectedRequests.push(`${config.method ?? "GET"} ${config.url ?? ""}`);
    throw new Error(`HTTP real não mockado: ${config.method ?? "GET"} ${config.url ?? ""}`);
  };
});

afterEach(async () => {
  cleanup();
  await disposeTestQueryClients();
  queryClient.clear();
  useAuthStore.getState().clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (unexpectedRequests.length > 0) {
    throw new Error(`Chamadas HTTP não mockadas: ${unexpectedRequests.join(", ")}`);
  }
});
