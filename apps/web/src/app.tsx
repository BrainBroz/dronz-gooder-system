import React from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CssBaseline,
  Stack,
  TextField,
  Typography,
  ThemeProvider
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider } from "@tanstack/react-query";
import { appTheme } from "./theme";
import { api, queryClient, refreshAccessTokenOnce } from "./api/client";
import { useAuthStore } from "./stores/auth";
import { extractErrorMessage } from "./utils/errors";
import { AppShell } from "./components/layout/AppShell";

const DashboardPage = React.lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage
  }))
);
const CategoriesPage = React.lazy(() =>
  import("./pages/CategoriesPage").then((module) => ({
    default: module.CategoriesPage
  }))
);
const SuppliersPage = React.lazy(() =>
  import("./pages/SuppliersPage").then((module) => ({
    default: module.SuppliersPage
  }))
);
const PurchaseOrdersPage = React.lazy(() =>
  import("./pages/PurchaseOrdersPage").then((module) => ({
    default: module.PurchaseOrdersPage
  }))
);
const ReportsPage = React.lazy(() =>
  import("./pages/ReportsPage").then((module) => ({
    default: module.ReportsPage
  }))
);
const ProductsPage = React.lazy(() =>
  import("./pages/ProductsPage").then((module) => ({
    default: module.ProductsPage
  }))
);
const ProductBasePage = React.lazy(() =>
  import("./pages/ProductBasePage").then((module) => ({
    default: module.ProductBasePage
  }))
);
const LogisticsPage = React.lazy(() =>
  import("./pages/LogisticsPage").then((module) => ({
    default: module.LogisticsPage
  }))
);
const InventoryPage = React.lazy(() =>
  import("./pages/InventoryPage").then((module) => ({
    default: module.InventoryPage
  }))
);
const FinancePage = React.lazy(() =>
  import("./pages/FinancePage").then((module) => ({
    default: module.FinancePage
  }))
);
const SalesPage = React.lazy(() =>
  import("./pages/SalesPage").then((module) => ({
    default: module.SalesPage
  }))
);
const MonthlyPanelPage = React.lazy(() =>
  import("./pages/MonthlyPanelPage").then((module) => ({
    default: module.MonthlyPanelPage
  }))
);
const BuyerReviewPage = React.lazy(() =>
  import("./pages/BuyerReviewPage").then((module) => ({
    default: module.BuyerReviewPage
  }))
);
const HomePage = React.lazy(() =>
  import("./pages/HomePage").then((module) => ({
    default: module.HomePage
  }))
);
const PositionsPage = React.lazy(() =>
  import("./pages/PositionsPage").then((module) => ({
    default: module.PositionsPage
  }))
);
const OperationsPage = React.lazy(() =>
  import("./pages/OperationsPage").then((module) => ({
    default: module.OperationsPage
  }))
);
const EconomicSettingsPage = React.lazy(() =>
  import("./pages/EconomicSettingsPage").then((module) => ({
    default: module.EconomicSettingsPage
  }))
);
const PurchaseSimulatorPage = React.lazy(() =>
  import("./pages/PurchaseSimulatorPage").then((module) => ({
    default: module.PurchaseSimulatorPage
  }))
);
const PurchaseQueuePage = React.lazy(() =>
  import("./pages/PurchaseQueuePage").then((module) => ({
    default: module.PurchaseQueuePage
  }))
);

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "Senha obrigatória")
});

export async function loadSession() {
  try {
    const accessToken = await refreshAccessTokenOnce();
    if (!accessToken) throw new Error("sessão ausente");
    const response = await api.get("/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    useAuthStore.getState().setSession({
      accessToken,
      user: response.data.user,
      stores: response.data.lojas.map(
        (s: { id: string; slug: string; nome: string }) => ({
          id: s.id,
          slug: s.slug,
          nome: s.nome
        })
      ),
      permissions: (response.data.permissoes ?? []).map(
        (permission: { code: string }) => permission.code
      )
    });
  } catch {
    useAuthStore.getState().clear();
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const accessToken = useAuthStore((state) => state.accessToken);
  React.useEffect(() => {
    void loadSession().finally(() => setReady(true));
  }, []);
  if (!ready) return <div>Carregando...</div>;
  return accessToken ? <>{children}</> : <Navigate to="/login" replace />;
}

export function LoginPage() {
  const navigate = useNavigate();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await api.post("/auth/login", values);
      useAuthStore.getState().setSession({
        accessToken: response.data.accessToken,
        user: response.data.user,
        stores: response.data.stores,
        permissions: (response.data.permissions ?? []).map(
          (permission: { code: string }) => permission.code
        )
      });
      navigate("/");
    } catch (error) {
      setError("root", { message: extractErrorMessage(error) });
    }
  });
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        boxSizing: "border-box"
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 380 }}>
        <CardContent>
          <Typography variant="h5" mb={2}>
            Entrar
          </Typography>
          <form onSubmit={onSubmit} noValidate>
            <Stack gap={2}>
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="email"
                    label="E-mail"
                    fullWidth
                    error={!!errors.email}
                    helperText={errors.email?.message}
                  />
                )}
              />
              <Controller
                name="password"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="password"
                    label="Senha"
                    fullWidth
                    error={!!errors.password}
                    helperText={errors.password?.message}
                  />
                )}
              />
              {errors.root?.message && (
                <Typography variant="body2" color="error" role="alert">
                  {errors.root.message}
                </Typography>
              )}
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? "Entrando..." : "Entrar"}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

export function NotFoundPage() {
  return <div>404</div>;
}

export function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <React.Suspense
          fallback={<div role="status">Carregando módulo...</div>}
        >
          <Routes>
            <Route
              path="/"
              element={
                <AuthGate>
                  <Shell>
                    <HomePage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/operacao"
              element={
                <AuthGate>
                  <Shell>
                    <DashboardPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/checkpoints"
              element={
                <AuthGate>
                  <Shell>
                    <OperationsPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/categorias"
              element={
                <AuthGate>
                  <Shell>
                    <CategoriesPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/produtos"
              element={
                <AuthGate>
                  <Shell>
                    <ProductsPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/produtos-base"
              element={
                <AuthGate>
                  <Shell>
                    <ProductBasePage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/fornecedores"
              element={
                <AuthGate>
                  <Shell>
                    <SuppliersPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/compras"
              element={
                <AuthGate>
                  <Shell>
                    <PurchaseQueuePage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/pedidos"
              element={
                <AuthGate>
                  <Shell>
                    <PurchaseOrdersPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/logistica"
              element={
                <AuthGate>
                  <Shell>
                    <LogisticsPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/estoque"
              element={
                <AuthGate>
                  <Shell>
                    <InventoryPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/financeiro"
              element={
                <AuthGate>
                  <Shell>
                    <FinancePage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/relatorios"
              element={
                <AuthGate>
                  <Shell>
                    <ReportsPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/vendas"
              element={
                <AuthGate>
                  <Shell>
                    <SalesPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/compras/painel-mensal"
              element={
                <AuthGate>
                  <Shell>
                    <MonthlyPanelPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/compras/revisao"
              element={
                <AuthGate>
                  <Shell>
                    <BuyerReviewPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/compras/simulador"
              element={
                <AuthGate>
                  <Shell>
                    <PurchaseSimulatorPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/configuracoes"
              element={
                <AuthGate>
                  <Shell>
                    <EconomicSettingsPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route
              path="/posicoes"
              element={
                <AuthGate>
                  <Shell>
                    <PositionsPage />
                  </Shell>
                </AuthGate>
              }
            />
            {(["/viajantes", "/viagens", "/malas"] as const).map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <AuthGate>
                    <Shell>
                      <LogisticsPage />
                    </Shell>
                  </AuthGate>
                }
              />
            ))}
            <Route
              path="/recebimentos"
              element={
                <AuthGate>
                  <Shell>
                    <InventoryPage />
                  </Shell>
                </AuthGate>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </React.Suspense>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
