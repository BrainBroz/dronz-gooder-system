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
import {
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { ContentCard } from "./components/ui/ContentCard";
import { PageContainer } from "./components/ui/PageContainer";
import { PageHeader } from "./components/ui/PageHeader";
import { MutationStatus } from "./components/ui/MutationStatus";
import { appTheme } from "./theme";
import { api, queryClient } from "./api/client";
import { authHeader, useAuthStore } from "./stores/auth";
import { extractErrorMessage } from "./utils/errors";
import {
  purchasingQueryKeys,
  financeQueryKeys,
  dashboardQueryKeys
} from "./queryKeys";
import type { PurchaseOrder } from "./types/purchasing";
import { CategoriesPage } from "./pages/CategoriesPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { LogisticsPage } from "./pages/LogisticsPage";
import { InventoryPage } from "./pages/InventoryPage";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "Senha obrigatória")
});

async function loadSession() {
  try {
    const refreshed = await api.post("/auth/refresh");
    useAuthStore.getState().setSession({
      accessToken: refreshed.data.accessToken,
      user: useAuthStore.getState().user ?? {
        id: "",
        name: "",
        email: "",
        active: true
      },
      stores: useAuthStore.getState().stores
    });
    const response = await api.get("/auth/me", { headers: authHeader() });
    useAuthStore.getState().setSession({
      accessToken: refreshed.data.accessToken,
      user: response.data.user,
      stores: response.data.lojas.map(
        (s: { id: string; slug: string; nome: string }) => ({
          id: s.id,
          slug: s.slug,
          nome: s.nome
        })
      )
    });
  } catch {
    useAuthStore.getState().clear();
  }
}

function AuthGate({ children }: { children: React.ReactNode }) {
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
        stores: response.data.stores
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

function Shell({ children }: { children: React.ReactNode }) {
  const { user, stores, activeStoreId, setActiveStoreId, clear } =
    useAuthStore();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post("/auth/logout");
    clear();
    navigate("/login");
  };
  return (
    <Box sx={{ display: "flex" }}>
      <Drawer variant="permanent">
        <Box p={2}>
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
            {[
              ["Operação", "/operacao"],
              ["Produtos", "/produtos"],
              ["Fornecedores", "/fornecedores"],
              ["Pedidos", "/pedidos"],
              ["Logística", "/logistica"],
              ["Estoque", "/estoque"],
              ["Financeiro", "/financeiro"],
              ["Relatórios", "/relatorios"]
            ].map(([label, path]) => (
              <Button key={path} onClick={() => navigate(path)}>
                {label}
              </Button>
            ))}
          </Stack>
        </Box>
      </Drawer>
      <Box component="main" sx={{ flex: 1, ml: 28 }}>
        <AppBar position="static">
          <Toolbar>
            <Typography sx={{ flex: 1 }}>{user?.email}</Typography>
            <Select
              size="small"
              value={activeStoreId ?? ""}
              onChange={(event) => setActiveStoreId(String(event.target.value))}
              sx={{ mr: 2, minWidth: 140 }}
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

function OperacaoPage() {
  const { stores, activeStoreId } = useAuthStore();
  const activeStore = stores.find((store) => store.id === activeStoreId);
  const summary = useQuery({
    queryKey: dashboardQueryKeys.summary(activeStoreId),
    enabled: !!activeStoreId,
    queryFn: async () =>
      (
        await api.get("/analytics/dashboard", {
          headers: { ...authHeader(), "x-store-id": activeStoreId }
        })
      ).data
  });
  const indicators = [
    { label: "Pedidos", value: summary.data?.orders.count ?? 0 },
    {
      label: "Estoque disponível",
      value: summary.data?.inventory.available ?? 0
    },
    { label: "Viagens abertas", value: summary.data?.openTrips ?? 0 },
    {
      label: "Recebimentos pendentes",
      value: summary.data?.pendingReceiving ?? 0
    }
  ];
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          eyebrow="Visão geral"
          title="Operação"
          description={`Loja ativa: ${activeStore?.nome ?? "Selecione uma loja"}`}
        />
        {summary.isLoading && <Typography>Carregando...</Typography>}
        {summary.isError && (
          <Typography color="error.main">
            Falha ao carregar indicadores
          </Typography>
        )}
        <Box
          display="grid"
          gridTemplateColumns={{ xs: "1fr", sm: "repeat(2, 1fr)" }}
          gap={2}
        >
          {indicators.map((indicator) => (
            <ContentCard key={indicator.label}>
              <Typography color="text.secondary" variant="body2">
                {indicator.label}
              </Typography>
              <Typography fontSize="2rem" fontWeight={700} lineHeight={1.1} mt={1}>
                {indicator.value}
              </Typography>
            </ContentCard>
          ))}
        </Box>
        <ContentCard
          title="Dados da operação"
          description="Indicadores calculados somente com dados reais da loja ativa."
        >
          <Typography color="text.secondary" variant="body2">
            Os módulos operacionais permanecem disponíveis na navegação principal.
          </Typography>
        </ContentCard>
      </Stack>
    </PageContainer>
  );
}

export function FinancePage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const exchangeForm = useForm<{
    moedaOrigem: string;
    moedaDestino: string;
    valor: number;
    cotadoEm: string;
  }>({
    defaultValues: {
      moedaOrigem: "BRL",
      moedaDestino: "USD",
      valor: 0,
      cotadoEm: ""
    }
  });
  const paymentForm = useForm<{
    pedidoCompraId: string;
    formaPagamento:
      "CREDIT_CARD" | "PAYPAL" | "BANK_TRANSFER" | "CASH" | "OTHER";
    moeda: string;
    valor: number;
  }>({
    defaultValues: {
      pedidoCompraId: "",
      formaPagamento: "OTHER",
      moeda: "USD",
      valor: 0
    }
  });
  const costForm = useForm<{
    pedidoCompraId: string;
    iofPercentual: number;
    taxas: number;
    custoAdicional: number;
  }>({
    defaultValues: {
      pedidoCompraId: "",
      iofPercentual: 0,
      taxas: 0,
      custoAdicional: 0
    }
  });
  const headers = { ...authHeader(), "x-store-id": store };
  const payments = useQuery({
    queryKey: financeQueryKeys.payments(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/finance/payments", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data
  });
  const orders = useQuery<PurchaseOrder[]>({
    queryKey: purchasingQueryKeys.orders(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/purchase-orders", { headers })).data.items
  });
  const exchange = useMutation({
    mutationFn: (v: {
      moedaOrigem: string;
      moedaDestino: string;
      valor: number;
      cotadoEm: string;
    }) =>
      api.post(
        "/finance/exchange-rates",
        {
          ...v,
          valor: Number(v.valor),
          cotadoEm: v.cotadoEm || new Date().toISOString()
        },
        { headers }
      ),
    onSuccess: () => exchangeForm.reset()
  });
  const payment = useMutation({
    mutationFn: (v: {
      pedidoCompraId: string;
      formaPagamento: string;
      moeda: string;
      valor: number;
    }) =>
      api.post(
        "/finance/payments",
        { ...v, valor: Number(v.valor) },
        { headers }
      ),
    onSuccess: async () => {
      paymentForm.reset();
      await client.invalidateQueries({
        queryKey: financeQueryKeys.payments(store)
      });
    }
  });
  const costs = useMutation({
    mutationFn: (v: {
      pedidoCompraId: string;
      iofPercentual: number;
      taxas: number;
      custoAdicional: number;
    }) =>
      api.put(
        `/finance/orders/${v.pedidoCompraId}/costs`,
        {
          iofPercentual: Number(v.iofPercentual),
          taxas: Number(v.taxas),
          custoAdicional: Number(v.custoAdicional)
        },
        { headers }
      )
  });
  return (
    <Box p={3}>
      <Typography variant="h4">Financeiro de Compras</Typography>
      <Typography color="text.secondary">
        Câmbio e PayPal são registros manuais.
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        my={2}
        onSubmit={exchangeForm.handleSubmit((v) => exchange.mutate(v))}
      >
        <TextField
          label="Moeda origem"
          {...exchangeForm.register("moedaOrigem", {
            required: true,
            minLength: 3,
            maxLength: 3
          })}
        />
        <TextField
          label="Moeda destino"
          {...exchangeForm.register("moedaDestino", {
            required: true,
            minLength: 3,
            maxLength: 3
          })}
        />
        <TextField
          type="number"
          inputProps={{ step: "0.000001" }}
          label="Cotação"
          {...exchangeForm.register("valor", {
            valueAsNumber: true,
            min: 0.000001
          })}
        />
        <TextField
          type="datetime-local"
          label="Data"
          InputLabelProps={{ shrink: true }}
          {...exchangeForm.register("cotadoEm")}
        />
        <Button type="submit" disabled={exchange.isPending}>
          Registrar câmbio
        </Button>
      </Stack>
      <MutationStatus
        mutation={exchange}
        successMessage="Câmbio registrado."
      />
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        my={2}
        onSubmit={paymentForm.handleSubmit((v) => payment.mutate(v))}
      >
        <TextField
          select
          label="Pedido"
          defaultValue=""
          {...paymentForm.register("pedidoCompraId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {orders.data?.map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {o.numeroPedido}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Forma"
          defaultValue="OTHER"
          {...paymentForm.register("formaPagamento")}
        >
          {["CREDIT_CARD", "PAYPAL", "BANK_TRANSFER", "CASH", "OTHER"].map(
            (x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            )
          )}
        </TextField>
        <TextField
          label="Moeda"
          {...paymentForm.register("moeda", {
            required: true,
            minLength: 3,
            maxLength: 3
          })}
        />
        <TextField
          type="number"
          inputProps={{ step: "0.01" }}
          label="Valor"
          {...paymentForm.register("valor", { valueAsNumber: true, min: 0.01 })}
        />
        <Button type="submit" disabled={payment.isPending}>
          Registrar pagamento
        </Button>
      </Stack>
      <MutationStatus
        mutation={payment}
        successMessage="Pagamento registrado."
      />
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        my={2}
        onSubmit={costForm.handleSubmit((v) => costs.mutate(v))}
      >
        <TextField
          select
          label="Pedido para custos"
          defaultValue=""
          {...costForm.register("pedidoCompraId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {orders.data?.map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {o.numeroPedido}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="number"
          label="IOF %"
          {...costForm.register("iofPercentual", {
            valueAsNumber: true,
            min: 0
          })}
        />
        <TextField
          type="number"
          label="Taxas"
          {...costForm.register("taxas", { valueAsNumber: true, min: 0 })}
        />
        <TextField
          type="number"
          label="Adicional"
          {...costForm.register("custoAdicional", {
            valueAsNumber: true,
            min: 0
          })}
        />
        <Button type="submit" disabled={costs.isPending}>
          Calcular custos
        </Button>
      </Stack>
      <MutationStatus mutation={costs} successMessage="Custos calculados." />
      {payments.isLoading && <Typography>Carregando...</Typography>}
      {payments.isError && <Typography>Falha ao carregar dados</Typography>}
      {payments.data?.map(
        (p: {
          id: string;
          formaPagamento: string;
          valor: string;
          moeda: string;
          status: string;
        }) => (
          <Card key={p.id}>
            <CardContent>
              <Typography>
                {p.formaPagamento} · {p.moeda} {p.valor}
              </Typography>
              <Typography>{p.status}</Typography>
            </CardContent>
          </Card>
        )
      )}
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
        <Routes>
          <Route path="/" element={<Navigate to="/operacao" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/operacao"
            element={
              <AuthGate>
                <Shell>
                  <OperacaoPage />
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
      </ThemeProvider>
    </QueryClientProvider>
  );
}
