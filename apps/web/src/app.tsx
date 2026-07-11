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
export const formatSalePrice = (value: string) =>
  Number(value) === 0 ? "A definir" : value;

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
  nome: z.string().min(1),
  slug: z.string().min(1),
  descricao: z.string().optional(),
  ordem: z.coerce.number().int().default(0),
  ativo: z.boolean().optional()
});
const productSchema = z.object({
  codigo: z.coerce.number().int().min(1),
  nome: z.string().min(1),
  slug: z.string().min(1),
  categoriaId: z.string().min(1),
  descricao: z.string().optional(),
  precoVenda: z.coerce.number().min(0),
  markup: z.coerce.number().min(25),
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
    } catch {
      setError("password", { message: "Credenciais inválidas" });
    }
  });
  return (
    <Box
      sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}
    >
      <Card sx={{ width: 380 }}>
        <CardContent>
          <Typography variant="h5" mb={2}>
            Entrar
          </Typography>
          <form onSubmit={onSubmit}>
            <Stack gap={2}>
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="E-mail"
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
                    error={!!errors.password}
                    helperText={errors.password?.message}
                  />
                )}
              />
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                Entrar
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
      <CssBaseline />
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
    defaultValues: { nome: "", slug: "", descricao: "", ordem: 0, ativo: true }
  });
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: catalogQueryKeys.categories(activeStoreId)
      }),
      client.invalidateQueries({
        queryKey: catalogQueryKeys.products(activeStoreId)
      })
    ]);
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof categorySchema>) =>
      editing
        ? api.patch(`/categories/${editing.id}`, values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          })
        : api.post("/categories", values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset();
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
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
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
            <form onSubmit={save}>
              <Stack gap={2}>
                <Controller
                  name="nome"
                  control={form.control}
                  render={({ field }) => <TextField {...field} label="Nome" />}
                />
                <Controller
                  name="slug"
                  control={form.control}
                  render={({ field }) => <TextField {...field} label="Slug" />}
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
                <Button type="submit" variant="contained">
                  {editing ? "Salvar" : "Criar"}
                </Button>
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
                <Button onClick={() => toggleMutation.mutate(category)}>
                  {category.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  color="error"
                  onClick={() => removeMutation.mutate(category)}
                >
                  Excluir
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      {!loading && !categories.length && (
        <Typography mt={2}>Nenhuma categoria.</Typography>
      )}
    </Box>
  );
}

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
    defaultValues: {
      codigo: 301,
      nome: "",
      slug: "",
      categoriaId: "",
      descricao: "",
      precoVenda: 0,
      markup: 25,
      peso: 0
    }
  });
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: catalogQueryKeys.products(activeStoreId)
    });
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof productSchema>) =>
      editing
        ? api.patch(`/products/${editing.id}`, values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          })
        : api.post("/products", values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset();
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
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
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
            <form onSubmit={save}>
              <Stack gap={2}>
                <Controller
                  name="codigo"
                  control={form.control}
                  render={({ field }) => (
                    <TextField {...field} label="Código" type="number" />
                  )}
                />
                <Controller
                  name="nome"
                  control={form.control}
                  render={({ field }) => <TextField {...field} label="Nome" />}
                />
                <Controller
                  name="slug"
                  control={form.control}
                  render={({ field }) => <TextField {...field} label="Slug" />}
                />
                <Controller
                  name="categoriaId"
                  control={form.control}
                  render={({ field }) => (
                    <TextField {...field} select label="Categoria">
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
                    />
                  )}
                />
                <Controller
                  name="markup"
                  control={form.control}
                  render={({ field }) => (
                    <TextField {...field} label="Markup" type="number" />
                  )}
                />
                <Button type="submit" variant="contained">
                  {editing ? "Salvar" : "Criar"}
                </Button>
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
                <Button onClick={() => toggleMutation.mutate(product)}>
                  {product.ativo ? "Desativar" : "Ativar"}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      {!loading && !products.length && (
        <Typography mt={2}>Nenhum produto.</Typography>
      )}
    </Box>
  );
}

function OperacaoPage() {
  const { stores, activeStoreId } = useAuthStore();
  const activeStore = stores.find((store) => store.id === activeStoreId);
  return (
    <Box p={3}>
      <Stack gap={2}>
        <Typography variant="h4">Operação</Typography>
        <Typography>
          Loja ativa: {activeStore?.nome ?? "Selecione uma loja"}
        </Typography>
        <Card>
          <CardContent>
            <Typography>Categoria 1</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Categoria 2</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Categoria 3</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography>Categoria 4</Typography>
          </CardContent>
        </Card>
        <Typography>Área de pendências vazia</Typography>
        <Typography>Outros módulos virão depois.</Typography>
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
  return (
    <Box p={3}>
      <Typography variant="h4">Fornecedores</Typography>
      <form onSubmit={form.handleSubmit((v) => m.mutateAsync(v))}>
        <Stack direction="row" gap={2} my={2}>
          <Controller
            name="nome"
            control={form.control}
            render={({ field }) => <TextField {...field} label="Nome" />}
          />
          <Controller
            name="moedaPadrao"
            control={form.control}
            render={({ field }) => <TextField {...field} label="Moeda" />}
          />
          <Button type="submit">Criar</Button>
        </Stack>
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
          <Button type="submit">Criar pedido</Button>
        </Stack>
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
function LogisticsPage() {
  const store = useAuthStore((s) => s.activeStoreId),
    headers = { ...authHeader(), "x-store-id": store };
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
  return (
    <Box p={3}>
      <Typography variant="h4">Logística Internacional</Typography>
      {travelers.isLoading && <Typography>Carregando...</Typography>}
      {travelers.isError && <Typography>Falha ao carregar dados</Typography>}
      <Typography variant="h6" mt={2}>
        Viajantes
      </Typography>
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

export function NotFoundPage() {
  return <div>404</div>;
}

export function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <Routes>
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
