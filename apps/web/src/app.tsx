import React from "react";
import axios from "axios";
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
  ThemeProvider,
  createTheme
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { create } from "zustand";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const api = axios.create({ baseURL: API_URL, withCredentials: true });
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});
export const catalogQueryKeys = {
  categories: (storeId: string | null) => ["categories", storeId] as const,
  products: (storeId: string | null) => ["products", storeId] as const
};
export const purchasingQueryKeys = {
  suppliers: (storeId: string | null) => ["suppliers", storeId] as const,
  orders: (storeId: string | null) => ["purchase-orders", storeId] as const
};
export const logisticsQueryKeys = {
  travelers: (id: string | null) => ["travelers", id] as const,
  trips: (id: string | null) => ["trips", id] as const,
  suitcases: (id: string | null) => ["suitcases", id] as const
};
export const inventoryQueryKeys = {
  stock: (id: string | null) => ["inventory", id] as const,
  receiving: (id: string | null) => ["receiving", id] as const,
  movements: (id: string | null) => ["inventory-movements", id] as const
};
export const financeQueryKeys = {
  payments: (id: string | null) => ["finance-payments", id] as const
};
export const dashboardQueryKeys = {
  summary: (id: string | null) => ["dashboard", id] as const
};
export const reportQueryKeys = {
  report: (id: string | null, type: string, from: string, to: string) =>
    ["report", id, type, from, to] as const
};
export const formatSalePrice = (value: string) =>
  Number(value) === 0 ? "A definir" : value;

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  bad_request: "Dados inválidos. Verifique os campos e tente novamente.",
  conflict: "Já existe um registro com esses dados.",
  not_found: "Registro não encontrado.",
  forbidden: "Você não tem permissão para esta ação."
};
const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: "Dados inválidos. Verifique os campos e tente novamente.",
  403: "Você não tem permissão para esta ação.",
  404: "Registro não encontrado.",
  409: "Já existe um registro com esses dados."
};
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.error;
    if (typeof code === "string" && KNOWN_ERROR_MESSAGES[code]) {
      return KNOWN_ERROR_MESSAGES[code];
    }
    const status = error.response?.status;
    if (status && STATUS_FALLBACK_MESSAGES[status]) {
      return STATUS_FALLBACK_MESSAGES[status];
    }
  }
  return "Falha na operação. Tente novamente.";
}
type MinimalMutationState = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
};
function MutationStatus({
  mutation,
  successMessage,
  loadingMessage = "Salvando..."
}: {
  mutation: MinimalMutationState;
  successMessage: string;
  loadingMessage?: string;
}) {
  if (mutation.isPending)
    return (
      <Typography variant="body2" color="text.secondary" role="status">
        {loadingMessage}
      </Typography>
    );
  if (mutation.isError)
    return (
      <Typography variant="body2" color="error" role="alert">
        {extractErrorMessage(mutation.error)}
      </Typography>
    );
  if (mutation.isSuccess)
    return (
      <Typography variant="body2" color="success.main" role="status">
        {successMessage}
      </Typography>
    );
  return null;
}

type Store = { id: string; slug: string; nome: string };
type AuthUser = { id: string; name: string; email: string; active: boolean };
type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  stores: Store[];
  activeStoreId: string | null;
  setSession: (payload: {
    accessToken: string;
    user: AuthUser;
    stores: Store[];
  }) => void;
  setActiveStoreId: (storeId: string) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  stores: [],
  activeStoreId: null,
  setSession: (payload) =>
    set({
      accessToken: payload.accessToken,
      user: payload.user,
      stores: payload.stores,
      activeStoreId: payload.stores[0]?.id ?? null
    }),
  setActiveStoreId: (activeStoreId) => set({ activeStoreId }),
  clear: () =>
    set({ accessToken: null, user: null, stores: [], activeStoreId: null })
}));

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0d1117", paper: "#161b27" }
  }
});
const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "Senha obrigatória")
});
const categorySchema = z.object({
  nome: z.string().min(1, "Nome obrigatório"),
  slug: z.string().min(1, "Slug obrigatório"),
  descricao: z.string().optional(),
  ordem: z.coerce.number().int().default(0),
  ativo: z.boolean().optional()
});
const productSchema = z.object({
  codigo: z.coerce.number().int().min(1, "Código obrigatório"),
  nome: z.string().min(1, "Nome obrigatório"),
  slug: z.string().min(1, "Slug obrigatório"),
  categoriaId: z.string().min(1, "Selecione uma categoria"),
  descricao: z.string().optional(),
  precoVenda: z.coerce.number().min(0, "Preço inválido"),
  markup: z.coerce.number().min(25, "Markup mínimo de 25%"),
  peso: z.coerce.number().min(0).optional()
});

type Category = {
  id: string;
  nome: string;
  slug: string;
  descricao?: string | null;
  ordem: number;
  ativo: boolean;
};
type Product = {
  id: string;
  codigo: number;
  nome: string;
  slug: string;
  descricao?: string | null;
  precoVenda: string;
  markup: string;
  ativo: boolean;
  categoria: Category;
};

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

function useCatalogContext() {
  const { activeStoreId, accessToken } = useAuthStore();
  const enabled = Boolean(activeStoreId && accessToken);
  const headers = () => ({ ...authHeader(), "x-store-id": activeStoreId! });
  return { activeStoreId, enabled, headers };
}

function useCategories() {
  const { activeStoreId, enabled, headers } = useCatalogContext();
  const categoriesQuery = useQuery<Category[]>({
    queryKey: catalogQueryKeys.categories(activeStoreId),
    enabled,
    queryFn: async () =>
      (await api.get("/categories", { headers: headers() })).data.items ?? []
  });
  return {
    categories: categoriesQuery.data ?? [],
    categoriesError: categoriesQuery.error,
    categoriesLoading: categoriesQuery.isLoading
  };
}

function useProducts() {
  const { activeStoreId, enabled, headers } = useCatalogContext();
  const productsQuery = useQuery<Product[]>({
    queryKey: catalogQueryKeys.products(activeStoreId),
    enabled,
    queryFn: async () =>
      (await api.get("/products", { headers: headers() })).data.items ?? []
  });
  return {
    products: productsQuery.data ?? [],
    productsError: productsQuery.error,
    productsLoading: productsQuery.isLoading
  };
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

const categoryDefaultValues = {
  nome: "",
  slug: "",
  descricao: "",
  ordem: 0,
  ativo: true
};
function CategoriesPage() {
  const {
    categories,
    categoriesError,
    categoriesLoading: loading
  } = useCategories();
  const error = categoriesError ? "Falha ao carregar dados" : null;
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [editing, setEditing] = React.useState<Category | null>(null);
  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: categoryDefaultValues
  });
  const [resetForStoreId, setResetForStoreId] =
    React.useState(activeStoreId);
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: catalogQueryKeys.categories(activeStoreId)
      }),
      client.invalidateQueries({
        queryKey: catalogQueryKeys.products(activeStoreId)
      })
    ]);
  // Captura se a submissão era uma edição no momento do envio: `editing` já
  // é limpo dentro de onSuccess, então não pode ser lido no render seguinte
  // para escolher a mensagem de sucesso correta.
  const [wasEditing, setWasEditing] = React.useState(false);
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof categorySchema>) => {
      setWasEditing(!!editing);
      return editing
        ? api.patch(`/categories/${editing.id}`, values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          })
        : api.post("/categories", values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          });
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset(categoryDefaultValues);
    }
  });
  const toggleMutation = useMutation({
    mutationFn: (category: Category) =>
      api.patch(
        `/categories/${category.id}/status`,
        {},
        { headers: { ...authHeader(), "x-store-id": activeStoreId } }
      ),
    onSuccess: invalidate
  });
  const removeMutation = useMutation({
    mutationFn: (category: Category) =>
      api.delete(`/categories/${category.id}`, {
        headers: { ...authHeader(), "x-store-id": activeStoreId }
      }),
    onSuccess: invalidate
  });
  // Descarta edição e feedback de mutação em andamento ao trocar de loja
  // (evita PATCH cross-tenant com dados de outra loja ainda preenchidos).
  if (activeStoreId !== resetForStoreId) {
    setResetForStoreId(activeStoreId);
    setEditing(null);
    form.reset(categoryDefaultValues);
    saveMutation.reset();
    toggleMutation.reset();
    removeMutation.reset();
  }
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
  const rowBusy = toggleMutation.isPending || removeMutation.isPending;
  const { errors } = form.formState;
  return (
    <Box p={3}>
      <Typography variant="h4" mb={2}>
        Categorias
      </Typography>
      {loading && <div>Carregando...</div>}
      {error && <div>{error}</div>}
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Card sx={{ width: 340 }}>
          <CardContent>
            <form onSubmit={save} noValidate>
              <Stack gap={2}>
                <Controller
                  name="nome"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Nome"
                      error={!!errors.nome}
                      helperText={errors.nome?.message}
                    />
                  )}
                />
                <Controller
                  name="slug"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Slug"
                      error={!!errors.slug}
                      helperText={errors.slug?.message}
                    />
                  )}
                />
                <Controller
                  name="descricao"
                  control={form.control}
                  render={({ field }) => (
                    <TextField {...field} label="Descrição" />
                  )}
                />
                <Controller
                  name="ordem"
                  control={form.control}
                  render={({ field }) => (
                    <TextField {...field} label="Ordem" type="number" />
                  )}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={saveMutation.isPending}
                >
                  {editing ? "Salvar" : "Criar"}
                </Button>
                <MutationStatus
                  mutation={saveMutation}
                  successMessage={
                    wasEditing
                      ? "Categoria salva com sucesso."
                      : "Categoria criada com sucesso."
                  }
                />
              </Stack>
            </form>
          </CardContent>
        </Card>
        {categories.map((category) => (
          <Card
            key={category.id}
            sx={{ width: 300, opacity: category.ativo ? 1 : 0.6 }}
          >
            <CardContent>
              <Typography>{category.nome}</Typography>
              <Typography variant="body2">{category.slug}</Typography>
              <Stack direction="row" gap={1} mt={2}>
                <Button
                  onClick={() => {
                    setEditing(category);
                    form.reset({
                      nome: category.nome,
                      slug: category.slug,
                      descricao: category.descricao ?? "",
                      ordem: category.ordem,
                      ativo: category.ativo
                    });
                  }}
                >
                  Editar
                </Button>
                <Button
                  disabled={rowBusy}
                  onClick={() => toggleMutation.mutate(category)}
                >
                  {category.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  color="error"
                  disabled={rowBusy}
                  onClick={() => removeMutation.mutate(category)}
                >
                  Excluir
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <MutationStatus
        mutation={toggleMutation}
        successMessage="Status atualizado."
      />
      <MutationStatus
        mutation={removeMutation}
        successMessage="Categoria excluída."
      />
      {!loading && !categories.length && (
        <Typography mt={2}>Nenhuma categoria.</Typography>
      )}
    </Box>
  );
}

const productDefaultValues = {
  codigo: 301,
  nome: "",
  slug: "",
  categoriaId: "",
  descricao: "",
  precoVenda: 0,
  markup: 25,
  peso: 0
};
function ProductsPage() {
  const { categories, categoriesError, categoriesLoading } = useCategories();
  const { products, productsError, productsLoading } = useProducts();
  const loading = categoriesLoading || productsLoading;
  const error =
    categoriesError || productsError ? "Falha ao carregar dados" : null;
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [editing, setEditing] = React.useState<Product | null>(null);
  const form = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: productDefaultValues
  });
  const [resetForStoreId, setResetForStoreId] =
    React.useState(activeStoreId);
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: catalogQueryKeys.products(activeStoreId)
    });
  // Captura se a submissão era uma edição no momento do envio: `editing` já
  // é limpo dentro de onSuccess, então não pode ser lido no render seguinte
  // para escolher a mensagem de sucesso correta.
  const [wasEditing, setWasEditing] = React.useState(false);
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof productSchema>) => {
      setWasEditing(!!editing);
      if (editing) {
        // O backend trata `codigo` como imutável e rejeita o campo no PATCH
        // (productUpdateSchema.strict() omite `codigo`), por isso ele é
        // removido do payload de atualização.
        const updatePayload = {
          nome: values.nome,
          slug: values.slug,
          categoriaId: values.categoriaId,
          descricao: values.descricao,
          precoVenda: values.precoVenda,
          markup: values.markup,
          peso: values.peso
        };
        return api.patch(`/products/${editing.id}`, updatePayload, {
          headers: { ...authHeader(), "x-store-id": activeStoreId }
        });
      }
      return api.post("/products", values, {
        headers: { ...authHeader(), "x-store-id": activeStoreId }
      });
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset(productDefaultValues);
    }
  });
  const toggleMutation = useMutation({
    mutationFn: (product: Product) =>
      api.patch(
        `/products/${product.id}/status`,
        {},
        { headers: { ...authHeader(), "x-store-id": activeStoreId } }
      ),
    onSuccess: invalidate
  });
  // Descarta edição e feedback de mutação em andamento ao trocar de loja
  // (evita PATCH cross-tenant com dados de outra loja ainda preenchidos).
  if (activeStoreId !== resetForStoreId) {
    setResetForStoreId(activeStoreId);
    setEditing(null);
    form.reset(productDefaultValues);
    saveMutation.reset();
    toggleMutation.reset();
  }
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
  const { errors } = form.formState;
  return (
    <Box p={3}>
      <Typography variant="h4" mb={2}>
        Produtos
      </Typography>
      {loading && <div>Carregando...</div>}
      {error && <div>{error}</div>}
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Card sx={{ width: 360 }}>
          <CardContent>
            <form onSubmit={save} noValidate>
              <Stack gap={2}>
                <Controller
                  name="codigo"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Código"
                      type="number"
                      disabled={!!editing}
                      helperText={
                        editing
                          ? "O código não pode ser alterado"
                          : errors.codigo?.message
                      }
                      error={!!errors.codigo}
                    />
                  )}
                />
                <Controller
                  name="nome"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Nome"
                      error={!!errors.nome}
                      helperText={errors.nome?.message}
                    />
                  )}
                />
                <Controller
                  name="slug"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Slug"
                      error={!!errors.slug}
                      helperText={errors.slug?.message}
                    />
                  )}
                />
                <Controller
                  name="categoriaId"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Categoria"
                      error={!!errors.categoriaId}
                      helperText={errors.categoriaId?.message}
                    >
                      {categories.map((category) => (
                        <MenuItem key={category.id} value={category.id}>
                          {category.nome}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="precoVenda"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Preço de venda"
                      type="number"
                      error={!!errors.precoVenda}
                      helperText={errors.precoVenda?.message}
                    />
                  )}
                />
                <Controller
                  name="markup"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Markup"
                      type="number"
                      error={!!errors.markup}
                      helperText={errors.markup?.message}
                    />
                  )}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={saveMutation.isPending}
                >
                  {editing ? "Salvar" : "Criar"}
                </Button>
                {editing && (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      form.reset(productDefaultValues);
                    }}
                  >
                    Cancelar edição
                  </Button>
                )}
                <MutationStatus
                  mutation={saveMutation}
                  successMessage={
                    wasEditing
                      ? "Produto salvo com sucesso."
                      : "Produto criado com sucesso."
                  }
                />
              </Stack>
            </form>
          </CardContent>
        </Card>
        {products.map((product) => (
          <Card
            key={product.id}
            sx={{ width: 320, opacity: product.ativo ? 1 : 0.6 }}
          >
            <CardContent>
              <Typography>{product.nome}</Typography>
              <Typography variant="body2">Código {product.codigo}</Typography>
              <Typography variant="body2">
                {formatSalePrice(product.precoVenda)}
              </Typography>
              <Stack direction="row" gap={1} mt={2}>
                <Button
                  onClick={() => {
                    setEditing(product);
                    form.reset({
                      codigo: product.codigo,
                      nome: product.nome,
                      slug: product.slug,
                      categoriaId: product.categoria.id,
                      descricao: product.descricao ?? "",
                      precoVenda: Number(product.precoVenda),
                      markup: Number(product.markup),
                      peso: 0
                    });
                  }}
                >
                  Editar
                </Button>
                <Button
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(product)}
                >
                  {product.ativo ? "Desativar" : "Ativar"}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <MutationStatus
        mutation={toggleMutation}
        successMessage="Status atualizado."
      />
      {!loading && !products.length && (
        <Typography mt={2}>Nenhum produto.</Typography>
      )}
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
  return (
    <Box p={3}>
      <Stack gap={2}>
        <Typography variant="h4">Operação</Typography>
        <Typography>
          Loja ativa: {activeStore?.nome ?? "Selecione uma loja"}
        </Typography>
        {summary.isLoading && <Typography>Carregando...</Typography>}
        {summary.isError && (
          <Typography>Falha ao carregar indicadores</Typography>
        )}
        <Card>
          <CardContent>
            <Typography>Pedidos</Typography>
            <Typography>{summary.data?.orders.count ?? 0}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Estoque disponível</Typography>
            <Typography>{summary.data?.inventory.available ?? 0}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Viagens abertas</Typography>
            <Typography>{summary.data?.openTrips ?? 0}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Recebimentos pendentes</Typography>
            <Typography>{summary.data?.pendingReceiving ?? 0}</Typography>
          </CardContent>
        </Card>
        <Typography>
          Indicadores calculados somente com dados reais da loja ativa.
        </Typography>
      </Stack>
    </Box>
  );
}

type Supplier = { id: string; nome: string; ativo: boolean };
type PurchaseOrder = {
  id: string;
  numeroPedido: string;
  status: string;
  subtotal: string;
  total: string;
  fornecedor: Supplier;
};
function SuppliersPage() {
  const store = useAuthStore((s) => s.activeStoreId),
    client = useQueryClient();
  const q = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data.items
  });
  const form = useForm({
    resolver: zodResolver(
      z.object({
        nome: z.string().min(1),
        moedaPadrao: z.string().regex(/^[A-Z]{3}$/)
      })
    ),
    defaultValues: { nome: "", moedaPadrao: "USD" }
  });
  const m = useMutation({
    mutationFn: (v: { nome: string; moedaPadrao: string }) =>
      api.post("/suppliers", v, {
        headers: { ...authHeader(), "x-store-id": store }
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: purchasingQueryKeys.suppliers(store)
      });
      form.reset();
    }
  });
  const { errors } = form.formState;
  return (
    <Box p={3}>
      <Typography variant="h4">Fornecedores</Typography>
      <form onSubmit={form.handleSubmit((v) => m.mutateAsync(v))} noValidate>
        <Stack direction="row" gap={2} my={2} flexWrap="wrap">
          <Controller
            name="nome"
            control={form.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Nome"
                error={!!errors.nome}
                helperText={errors.nome?.message}
              />
            )}
          />
          <Controller
            name="moedaPadrao"
            control={form.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Moeda"
                error={!!errors.moedaPadrao}
                helperText={errors.moedaPadrao?.message}
              />
            )}
          />
          <Button type="submit" disabled={m.isPending}>
            Criar
          </Button>
        </Stack>
        <MutationStatus
          mutation={m}
          successMessage="Fornecedor criado com sucesso."
        />
      </form>
      {q.isLoading && <Typography>Carregando...</Typography>}
      {q.isError && <Typography>Falha ao carregar dados</Typography>}
      {q.data?.map((s) => (
        <Card key={s.id}>
          <CardContent>
            <Typography>{s.nome}</Typography>
            <Typography>{s.ativo ? "Ativo" : "Inativo"}</Typography>
          </CardContent>
        </Card>
      ))}
      {!q.isLoading && !q.data?.length && (
        <Typography>Nenhum fornecedor.</Typography>
      )}
    </Box>
  );
}
function PurchaseOrdersPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const { products } = useProducts();
  const suppliers = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data.items
  });
  const orders = useQuery<PurchaseOrder[]>({
    queryKey: purchasingQueryKeys.orders(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/purchase-orders", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data.items
  });
  const form = useForm({
    resolver: zodResolver(
      z.object({
        numeroPedido: z.string().min(1),
        fornecedorId: z.string().min(1),
        produtoId: z.string().min(1),
        quantidade: z.coerce.number().int().positive(),
        precoUnitario: z.coerce.number().min(0),
        descontoItem: z.coerce.number().min(0)
      })
    ),
    defaultValues: {
      numeroPedido: "",
      fornecedorId: "",
      produtoId: "",
      quantidade: 1,
      precoUnitario: 0,
      descontoItem: 0
    }
  });
  const createOrder = useMutation({
    mutationFn: (v: {
      numeroPedido: string;
      fornecedorId: string;
      produtoId: string;
      quantidade: number;
      precoUnitario: number;
      descontoItem: number;
    }) =>
      api.post(
        "/purchase-orders",
        {
          fornecedorId: v.fornecedorId,
          numeroPedido: v.numeroPedido,
          dataCompra: new Date().toISOString(),
          moeda: "USD",
          descontoPedido: 0,
          frete: 0,
          imposto: 0,
          itens: [
            {
              produtoId: v.produtoId,
              quantidade: v.quantidade,
              precoUnitario: v.precoUnitario,
              descontoItem: v.descontoItem
            }
          ]
        },
        { headers: { ...authHeader(), "x-store-id": store } }
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: purchasingQueryKeys.orders(store)
      });
      form.reset();
    }
  });
  return (
    <Box p={3}>
      <Typography variant="h4">Pedidos de Compra</Typography>
      <form onSubmit={form.handleSubmit((v) => createOrder.mutateAsync(v))}>
        <Stack direction="row" gap={1} my={2} flexWrap="wrap">
          <Controller
            name="numeroPedido"
            control={form.control}
            render={({ field }) => <TextField {...field} label="Número" />}
          />
          <Controller
            name="fornecedorId"
            control={form.control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Fornecedor"
                sx={{ minWidth: 180 }}
              >
                {suppliers.data
                  ?.filter((s) => s.ativo)
                  .map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.nome}
                    </MenuItem>
                  ))}
              </TextField>
            )}
          />
          <Controller
            name="produtoId"
            control={form.control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Produto"
                sx={{ minWidth: 180 }}
              >
                {products.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.nome}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          <Controller
            name="quantidade"
            control={form.control}
            render={({ field }) => (
              <TextField {...field} type="number" label="Quantidade" />
            )}
          />
          <Controller
            name="precoUnitario"
            control={form.control}
            render={({ field }) => (
              <TextField {...field} type="number" label="Preço unitário" />
            )}
          />
          <Controller
            name="descontoItem"
            control={form.control}
            render={({ field }) => (
              <TextField {...field} type="number" label="Desconto" />
            )}
          />
          <Button type="submit" disabled={createOrder.isPending}>
            Criar pedido
          </Button>
        </Stack>
        <MutationStatus
          mutation={createOrder}
          successMessage="Pedido criado com sucesso."
        />
      </form>
      <Typography my={2}>
        Fornecedores disponíveis:{" "}
        {suppliers.data?.filter((s) => s.ativo).length ?? 0}
      </Typography>
      {orders.isLoading && <Typography>Carregando...</Typography>}
      {orders.isError && <Typography>Falha ao carregar dados</Typography>}
      {orders.data?.map((o) => (
        <Card key={o.id}>
          <CardContent>
            <Typography>{o.numeroPedido}</Typography>
            <Typography>
              {o.fornecedor.nome} — {o.status}
            </Typography>
            <Typography>
              Subtotal {o.subtotal} · Total {o.total}
            </Typography>
          </CardContent>
        </Card>
      ))}
      {!orders.isLoading && !orders.data?.length && (
        <Typography>Nenhum pedido.</Typography>
      )}
    </Box>
  );
}
export function LogisticsPage() {
  const store = useAuthStore((s) => s.activeStoreId),
    headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const travelerForm = useForm<{ nome: string; email: string }>({
    defaultValues: { nome: "", email: "" }
  });
  const tripForm = useForm<{
    viajanteId: string;
    origem: string;
    destino: string;
    partidaEm: string;
    chegadaPrevistaEm: string;
  }>({
    defaultValues: {
      viajanteId: "",
      origem: "",
      destino: "",
      partidaEm: "",
      chegadaPrevistaEm: ""
    }
  });
  const bagForm = useForm<{ viagemId: string; codigo: string }>({
    defaultValues: { viagemId: "", codigo: "" }
  });
  const travelers = useQuery({
    queryKey: logisticsQueryKeys.travelers(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/travelers", { headers })).data
  });
  const trips = useQuery({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const bags = useQuery({
    queryKey: logisticsQueryKeys.suitcases(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/suitcases", { headers })).data
  });
  const createTraveler = useMutation({
    mutationFn: (data: { nome: string; email: string }) =>
      api.post(
        "/logistics/travelers",
        { nome: data.nome, email: data.email || undefined },
        { headers }
      ),
    onSuccess: async () => {
      travelerForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.travelers(store)
      });
    }
  });
  const createTrip = useMutation({
    mutationFn: (data: {
      viajanteId: string;
      origem: string;
      destino: string;
      partidaEm: string;
      chegadaPrevistaEm: string;
    }) => api.post("/logistics/trips", data, { headers }),
    onSuccess: async () => {
      tripForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.trips(store)
      });
    }
  });
  const createBag = useMutation({
    mutationFn: (data: { viagemId: string; codigo: string }) =>
      api.post("/logistics/suitcases", data, { headers }),
    onSuccess: async () => {
      bagForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.suitcases(store)
      });
    }
  });
  return (
    <Box p={3}>
      <Typography variant="h4">Logística Internacional</Typography>
      {travelers.isLoading && <Typography>Carregando...</Typography>}
      {travelers.isError && <Typography>Falha ao carregar dados</Typography>}
      <Typography variant="h6" mt={2}>
        Viajantes
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={travelerForm.handleSubmit((v) => createTraveler.mutate(v))}
      >
        <TextField
          label="Nome"
          {...travelerForm.register("nome", { required: true })}
        />
        <TextField
          label="E-mail"
          type="email"
          {...travelerForm.register("email")}
        />
        <Button type="submit" disabled={createTraveler.isPending}>
          Adicionar viajante
        </Button>
      </Stack>
      <MutationStatus
        mutation={createTraveler}
        successMessage="Viajante adicionado."
      />
      {travelers.data?.map(
        (v: { id: string; nome: string; ativo: boolean }) => (
          <Card key={v.id}>
            <CardContent>
              <Typography>{v.nome}</Typography>
              <Typography>{v.ativo ? "Ativo" : "Inativo"}</Typography>
            </CardContent>
          </Card>
        )
      )}
      <Typography variant="h6" mt={2}>
        Viagens
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={tripForm.handleSubmit((v) => createTrip.mutate(v))}
      >
        <TextField
          select
          label="Viajante"
          defaultValue=""
          {...tripForm.register("viajanteId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {travelers.data?.map((v: { id: string; nome: string }) => (
            <MenuItem key={v.id} value={v.id}>
              {v.nome}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Origem"
          {...tripForm.register("origem", { required: true })}
        />
        <TextField
          label="Destino"
          {...tripForm.register("destino", { required: true })}
        />
        <TextField
          type="datetime-local"
          label="Partida"
          InputLabelProps={{ shrink: true }}
          {...tripForm.register("partidaEm", { required: true })}
        />
        <TextField
          type="datetime-local"
          label="Chegada prevista"
          InputLabelProps={{ shrink: true }}
          {...tripForm.register("chegadaPrevistaEm", { required: true })}
        />
        <Button type="submit" disabled={createTrip.isPending}>
          Criar viagem
        </Button>
      </Stack>
      <MutationStatus mutation={createTrip} successMessage="Viagem criada." />
      {trips.data?.map(
        (t: {
          id: string;
          origem: string;
          destino: string;
          status: string;
        }) => (
          <Card key={t.id}>
            <CardContent>
              <Typography>
                {t.origem} → {t.destino}
              </Typography>
              <Typography>{t.status}</Typography>
            </CardContent>
          </Card>
        )
      )}
      <Typography variant="h6" mt={2}>
        Malas e volumes
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={bagForm.handleSubmit((v) => createBag.mutate(v))}
      >
        <TextField
          select
          label="Viagem"
          defaultValue=""
          {...bagForm.register("viagemId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {trips.data?.map(
            (t: { id: string; origem: string; destino: string }) => (
              <MenuItem key={t.id} value={t.id}>
                {t.origem} → {t.destino}
              </MenuItem>
            )
          )}
        </TextField>
        <TextField
          label="Código"
          {...bagForm.register("codigo", { required: true })}
        />
        <Button type="submit" disabled={createBag.isPending}>
          Criar mala
        </Button>
      </Stack>
      <MutationStatus mutation={createBag} successMessage="Mala criada." />
      {bags.data?.map(
        (b: {
          id: string;
          codigo: string;
          status: string;
          limitePesoKg: string;
          volumes: unknown[];
          alocacoes: unknown[];
        }) => (
          <Card key={b.id}>
            <CardContent>
              <Typography>
                {b.codigo} — {b.status}
              </Typography>
              <Typography>
                Limite {b.limitePesoKg} kg · {b.volumes.length} volume(s) ·{" "}
                {b.alocacoes.length} alocação(ões)
              </Typography>
            </CardContent>
          </Card>
        )
      )}
    </Box>
  );
}

export function InventoryPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const movementForm = useForm<{
    produtoId: string;
    tipo:
      | "RESERVE"
      | "RELEASE_RESERVATION"
      | "EXIT"
      | "ADJUSTMENT_POSITIVE"
      | "ADJUSTMENT_NEGATIVE"
      | "RETURN_ENTRY"
      | "RETURN_EXIT";
    quantidade: number;
    observacoes: string;
  }>({
    defaultValues: {
      produtoId: "",
      tipo: "RESERVE",
      quantidade: 1,
      observacoes: ""
    }
  });
  const receiptForm = useForm<{ viagemId: string; malaId: string }>({
    defaultValues: { viagemId: "", malaId: "" }
  });
  const stock = useQuery({
    queryKey: inventoryQueryKeys.stock(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/inventory", { headers })).data
  });
  const receiving = useQuery({
    queryKey: inventoryQueryKeys.receiving(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/receiving", { headers })).data
  });
  const trips = useQuery({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const bags = useQuery({
    queryKey: logisticsQueryKeys.suitcases(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/suitcases", { headers })).data
  });
  const refreshInventory = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: inventoryQueryKeys.stock(store) }),
      client.invalidateQueries({
        queryKey: inventoryQueryKeys.receiving(store)
      }),
      client.invalidateQueries({
        queryKey: inventoryQueryKeys.movements(store)
      })
    ]);
  const move = useMutation({
    mutationFn: (v: {
      produtoId: string;
      tipo: string;
      quantidade: number;
      observacoes: string;
    }) =>
      api.post(
        "/inventory/movements",
        {
          ...v,
          quantidade: Number(v.quantidade),
          motivo:
            v.tipo === "RESERVE"
              ? "RESERVATION"
              : v.tipo === "RELEASE_RESERVATION"
                ? "RESERVATION_RELEASE"
                : v.tipo === "EXIT"
                  ? "SALE"
                  : v.tipo.startsWith("RETURN")
                    ? "RETURN"
                    : "MANUAL_CORRECTION",
          observacoes: v.observacoes || undefined
        },
        { headers }
      ),
    onSuccess: async () => {
      movementForm.reset();
      await refreshInventory();
    }
  });
  const createReceipt = useMutation({
    mutationFn: (v: { viagemId: string; malaId: string }) =>
      api.post("/receiving", v, { headers }),
    onSuccess: async () => {
      receiptForm.reset();
      await refreshInventory();
    }
  });
  const confirmReceipt = useMutation({
    mutationFn: ({
      receiptId,
      itemId,
      quantity
    }: {
      receiptId: string;
      itemId: string;
      quantity: number;
    }) =>
      api.post(
        `/receiving/${receiptId}/items/${itemId}/confirm`,
        { quantidadeRecebida: quantity, quantidadeRejeitada: 0 },
        { headers }
      ),
    onSuccess: refreshInventory
  });

  return (
    <Box p={3}>
      <Typography variant="h4">Estoque e Recebimentos</Typography>
      {stock.isLoading && <Typography>Carregando...</Typography>}
      {stock.isError && <Typography>Falha ao carregar dados</Typography>}
      <Typography variant="h6" mt={2}>
        Posição de estoque
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={movementForm.handleSubmit((v) => move.mutate(v))}
      >
        <TextField
          select
          label="Produto"
          defaultValue=""
          {...movementForm.register("produtoId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {stock.data?.map(
            (x: { produtoId: string; produto: { nome: string } }) => (
              <MenuItem key={x.produtoId} value={x.produtoId}>
                {x.produto.nome}
              </MenuItem>
            )
          )}
        </TextField>
        <TextField
          select
          label="Movimento"
          defaultValue="RESERVE"
          {...movementForm.register("tipo")}
        >
          {[
            "RESERVE",
            "RELEASE_RESERVATION",
            "EXIT",
            "ADJUSTMENT_POSITIVE",
            "ADJUSTMENT_NEGATIVE",
            "RETURN_ENTRY",
            "RETURN_EXIT"
          ].map((x) => (
            <MenuItem key={x} value={x}>
              {x}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="number"
          label="Quantidade"
          {...movementForm.register("quantidade", {
            valueAsNumber: true,
            min: 1
          })}
        />
        <TextField
          label="Observação"
          {...movementForm.register("observacoes")}
        />
        <Button type="submit" disabled={move.isPending}>
          Registrar movimento
        </Button>
      </Stack>
      <MutationStatus mutation={move} successMessage="Movimento registrado." />
      {stock.data?.map(
        (item: {
          id: string;
          quantidadeFisica: number;
          quantidadeReservada: number;
          produto: { nome: string; precoVenda: string; ativo: boolean };
        }) => {
          const disponivel = item.quantidadeFisica - item.quantidadeReservada;
          const semEstoque = disponivel === 0;
          return (
            <Card
              key={item.id}
              sx={{
                opacity: semEstoque ? 0.38 : item.produto.ativo ? 1 : 0.65,
                filter: semEstoque ? "grayscale(1)" : "none"
              }}
            >
              <CardContent>
                <Typography>{item.produto.nome}</Typography>
                <Typography>
                  Físico {item.quantidadeFisica} · Reservado{" "}
                  {item.quantidadeReservada} · Disponível {disponivel}
                </Typography>
                <Typography>
                  {formatSalePrice(item.produto.precoVenda)}
                </Typography>
                <Typography>
                  {semEstoque
                    ? "Sem estoque"
                    : item.produto.ativo
                      ? "Ativo"
                      : "Produto inativo"}
                </Typography>
              </CardContent>
            </Card>
          );
        }
      )}
      <Typography variant="h6" mt={2}>
        Recebimentos
      </Typography>
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={receiptForm.handleSubmit((v) => createReceipt.mutate(v))}
      >
        <TextField
          select
          label="Viagem chegada"
          defaultValue=""
          {...receiptForm.register("viagemId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {trips.data
            ?.filter((t: { status: string }) => t.status === "ARRIVED_BRAZIL")
            .map((t: { id: string; origem: string; destino: string }) => (
              <MenuItem key={t.id} value={t.id}>
                {t.origem} → {t.destino}
              </MenuItem>
            ))}
        </TextField>
        <TextField
          select
          label="Mala"
          defaultValue=""
          {...receiptForm.register("malaId", { required: true })}
        >
          <MenuItem value="" disabled>
            Selecione
          </MenuItem>
          {bags.data
            ?.filter((b: { status: string }) =>
              ["ARRIVED_BRAZIL", "RECEIVED"].includes(b.status)
            )
            .map((b: { id: string; codigo: string }) => (
              <MenuItem key={b.id} value={b.id}>
                {b.codigo}
              </MenuItem>
            ))}
        </TextField>
        <Button type="submit" disabled={createReceipt.isPending}>
          Iniciar recebimento
        </Button>
      </Stack>
      <MutationStatus
        mutation={createReceipt}
        successMessage="Recebimento iniciado."
      />
      {receiving.data?.map(
        (item: {
          id: string;
          status: string;
          itens: {
            id: string;
            quantidadeEsperada: number;
            quantidadeRecebida: number;
            quantidadeRejeitada: number;
            produto: { nome: string };
          }[];
        }) => (
          <Card key={item.id}>
            <CardContent>
              <Typography>{item.status}</Typography>
              <Typography>{item.itens.length} item(ns)</Typography>
              {item.itens.map((received) => {
                const remaining =
                  received.quantidadeEsperada -
                  received.quantidadeRecebida -
                  received.quantidadeRejeitada;
                return (
                  <Stack
                    key={received.id}
                    direction="row"
                    gap={1}
                    alignItems="center"
                  >
                    <Typography>
                      {received.produto.nome}: {received.quantidadeRecebida}/
                      {received.quantidadeEsperada}
                    </Typography>
                    {remaining > 0 && (
                      <Button
                        disabled={confirmReceipt.isPending}
                        onClick={() =>
                          confirmReceipt.mutate({
                            receiptId: item.id,
                            itemId: received.id,
                            quantity: remaining
                          })
                        }
                      >
                        Confirmar {remaining}
                      </Button>
                    )}
                  </Stack>
                );
              })}
            </CardContent>
          </Card>
        )
      )}
      <MutationStatus
        mutation={confirmReceipt}
        successMessage="Item confirmado."
      />
    </Box>
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

const reportTypes = [
  ["purchase-orders", "Pedidos de Compra"],
  ["purchase-items", "Itens Comprados"],
  ["logistics", "Logística por Viagem"],
  ["suitcase-weight", "Peso por Mala"],
  ["receiving", "Recebimentos"],
  ["inventory", "Posição de Estoque"],
  ["movements", "Movimentações"],
  ["costs", "Custos por Pedido"],
  ["payments", "Pagamentos"],
  ["markup", "Markup e Margem"]
] as const;
export function ReportsPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const [type, setType] = React.useState<string>("purchase-orders");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const report = useQuery<unknown[]>({
    queryKey: reportQueryKeys.report(store, type, from, to),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get(`/analytics/reports/${type}`, {
          headers: { ...authHeader(), "x-store-id": store },
          params: { from: from || undefined, to: to || undefined }
        })
      ).data
  });
  return (
    <Box p={3}>
      <Typography variant="h4">Relatórios</Typography>
      <Stack direction={{ xs: "column", md: "row" }} gap={2} my={2}>
        <TextField
          select
          label="Relatório"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {reportTypes.map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="date"
          label="De"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          type="date"
          label="Até"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
      {report.isLoading && <Typography>Carregando...</Typography>}
      {report.isError && <Typography>Falha ao carregar relatório</Typography>}
      {!report.isLoading && !report.data?.length && (
        <Typography>Nenhum registro.</Typography>
      )}
      {report.data?.map((row, index) => (
        <Card key={String((row as { id?: string }).id ?? index)}>
          <CardContent>
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(row, null, 2)}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

export function NotFoundPage() {
  return <div>404</div>;
}

export function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
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
