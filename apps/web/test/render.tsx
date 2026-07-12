import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { appTheme } from "../src/theme";
import { useAuthStore, type AuthUser, type Store } from "../src/stores/auth";

type RenderOptions = {
  route?: string;
  accessToken?: string | null;
  user?: AuthUser | null;
  stores?: Store[];
  activeStoreId?: string | null;
};

const testClients = new Set<QueryClient>();

export const testStores: Store[] = [
  { id: "store-dronz", slug: "dronz", nome: "Dronz" },
  { id: "store-gooder", slug: "gooder", nome: "Gooder" }
];

export const testUser: AuthUser = {
  id: "user-test",
  name: "Usuário de teste",
  email: "test@example.com",
  active: true
};

export function createTestQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false
      },
      mutations: { retry: false }
    }
  });
  testClients.add(client);
  return client;
}

export async function disposeTestQueryClients() {
  await Promise.all([...testClients].map((client) => client.cancelQueries()));
  testClients.forEach((client) => client.clear());
  testClients.clear();
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const stores = options.stores ?? testStores;
  useAuthStore.setState({
    accessToken: options.accessToken === undefined ? "access-test" : options.accessToken,
    user: options.user === undefined ? testUser : options.user,
    stores,
    activeStoreId:
      options.activeStoreId === undefined ? (stores[0]?.id ?? null) : options.activeStoreId
  });
  const client = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return { ...result, queryClient: client };
}
