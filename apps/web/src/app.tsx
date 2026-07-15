import React from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  CssBaseline,
  Drawer,
  MenuItem,
  Select,
  Stack,
  TextField,
  Toolbar,
  Typography,
  ThemeProvider
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider } from "@tanstack/react-query";
import { appTheme } from "./theme";
import { api, queryClient } from "./api/client";
import { useAuthStore } from "./stores/auth";
import { extractErrorMessage } from "./utils/errors";

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
const OperationsPage = React.lazy(() =>
  import("./pages/OperationsPage").then((module) => ({
    default: module.OperationsPage
  }))
);
const UnifiedPurchasesPage = React.lazy(() =>
  import("./pages/UnifiedPurchasesPage").then((module) => ({
    default: module.UnifiedPurchasesPage
  }))
);

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "Senha obrigatória")
});

export async function loadSession() {
  try {
    const refreshed = await api.post("/auth/refresh");
    const response = await api.get("/auth/me", {
      headers: { Authorization: `Bearer ${refreshed.data.accessToken}` }
    });
    useAuthStore.getState().setSession({
      accessToken: refreshed.data.accessToken,
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
      navigate("/operacao");
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
  const { user, stores, activeStoreId, setActiveStoreId, clear } =
    useAuthStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const navigationItems = [
    ["Operação", "/operacao"],
    ["Checkpoints", "/checkpoints"],
    ["Categorias", "/categorias"],
    ["Produtos", "/produtos"],
    ["Fornecedores", "/fornecedores"],
    ["Compras Unificadas", "/compras"],
    ["Pedidos Operacionais", "/pedidos"],
    ["Logística", "/logistica"],
    ["Estoque", "/estoque"],
    ["Financeiro", "/financeiro"],
    ["Relatórios", "/relatorios"]
  ] as const;
  const navigateFromMenu = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };
  const drawerContent = (
    <Box p={2} sx={{ width: 224 }}>
      <Typography variant="h6">Dronz & Gooder</Typography>
      <Stack mt={2} gap={1}>
        {stores.map((store) => (
          <Button
            key={store.id}
            variant={store.id === activeStoreId ? "contained" : "text"}
            onClick={() => setActiveStoreId(store.id)}
          >
            {store.nome}
          </Button>
        ))}
        {navigationItems.map(([label, path]) => (
          <Button key={path} onClick={() => navigateFromMenu(path)}>
            {label}
          </Button>
        ))}
      </Stack>
    </Box>
  );
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // A intenção de sair deve encerrar a sessão local mesmo sem resposta da API.
    } finally {
      queryClient.clear();
      clear();
      navigate("/login");
    }
  };
  return (
    <Box sx={{ display: "flex" }}>
      <Drawer
        variant="temporary"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        sx={{ display: { xs: "block", md: "none" } }}
        slotProps={{ paper: { sx: { width: 224 } } }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{ display: { xs: "none", md: "block" } }}
      >
        {drawerContent}
      </Drawer>
      <Box
        component="main"
        sx={{ flex: 1, minWidth: 0, ml: { xs: 0, md: 28 } }}
      >
        <AppBar position="static">
          <Toolbar sx={{ gap: 1 }}>
            <Button
              onClick={() => setMobileMenuOpen(true)}
              sx={{ display: { xs: "inline-flex", md: "none" }, mr: 1 }}
              aria-label="Abrir menu"
            >
              Menu
            </Button>
            <Typography
              sx={{ flex: 1, display: { xs: "none", sm: "block" } }}
            >
              {user?.email}
            </Typography>
            <Select
              size="small"
              value={activeStoreId ?? ""}
              onChange={(event) => setActiveStoreId(String(event.target.value))}
              sx={{
                ml: "auto",
                mr: { xs: 0, sm: 1 },
                minWidth: { xs: 110, sm: 140 }
              }}
            >
              {stores.map((store) => (
                <MenuItem key={store.id} value={store.id}>
                  {store.nome}
                </MenuItem>
              ))}
            </Select>
            <Button onClick={logout}>Sair</Button>
          </Toolbar>
        </AppBar>
        {children}
      </Box>
    </Box>
  );
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
            <Route path="/" element={<Navigate to="/operacao" replace />} />
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
                    <UnifiedPurchasesPage />
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
