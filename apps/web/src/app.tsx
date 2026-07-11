import React from "react";
import axios from "axios";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AppBar, Box, Button, Card, CardContent, CssBaseline, Drawer, MenuItem, Select, Stack, TextField, Toolbar, Typography, ThemeProvider, createTheme } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { create } from "zustand";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const api = axios.create({ baseURL: API_URL, withCredentials: true });

type Store = { id: string; slug: string; nome: string };
type AuthUser = { id: string; name: string; email: string; active: boolean };
type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  stores: Store[];
  activeStoreId: string | null;
  setSession: (payload: { accessToken: string; user: AuthUser; stores: Store[] }) => void;
  setActiveStoreId: (storeId: string) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  stores: [],
  activeStoreId: null,
  setSession: (payload) => set({ accessToken: payload.accessToken, user: payload.user, stores: payload.stores, activeStoreId: payload.stores[0]?.id ?? null }),
  setActiveStoreId: (activeStoreId) => set({ activeStoreId }),
  clear: () => set({ accessToken: null, user: null, stores: [], activeStoreId: null })
}));

const theme = createTheme({ palette: { mode: "dark", background: { default: "#0d1117", paper: "#161b27" } } });
const loginSchema = z.object({ email: z.string().email("Informe um e-mail válido"), password: z.string().min(1, "Senha obrigatória") });
const categorySchema = z.object({ nome: z.string().min(1), slug: z.string().min(1), descricao: z.string().optional(), ordem: z.coerce.number().int().default(0), ativo: z.boolean().optional() });
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

type Category = { id: string; nome: string; slug: string; descricao?: string | null; ordem: number; ativo: boolean };
type Product = { id: string; codigo: number; nome: string; slug: string; descricao?: string | null; precoVenda: string; markup: string; ativo: boolean; categoria: Category };

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function loadSession() {
  try {
    const refreshed = await api.post("/auth/refresh");
    useAuthStore.getState().setSession({ accessToken: refreshed.data.accessToken, user: useAuthStore.getState().user ?? { id: "", name: "", email: "", active: true }, stores: useAuthStore.getState().stores });
    const response = await api.get("/auth/me", { headers: authHeader() });
    useAuthStore.getState().setSession({ accessToken: refreshed.data.accessToken, user: response.data.user, stores: response.data.lojas.map((s: { id: string; slug: string; nome: string }) => ({ id: s.id, slug: s.slug, nome: s.nome })) });
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
  const { control, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await api.post("/auth/login", values);
      useAuthStore.getState().setSession({ accessToken: response.data.accessToken, user: response.data.user, stores: response.data.stores });
      navigate("/operacao");
    } catch {
      setError("password", { message: "Credenciais inválidas" });
    }
  });
  return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}><Card sx={{ width: 380 }}><CardContent><Typography variant="h5" mb={2}>Entrar</Typography><form onSubmit={onSubmit}><Stack gap={2}><Controller name="email" control={control} render={({ field }) => <TextField {...field} label="E-mail" error={!!errors.email} helperText={errors.email?.message} />} /><Controller name="password" control={control} render={({ field }) => <TextField {...field} type="password" label="Senha" error={!!errors.password} helperText={errors.password?.message} />} /><Button type="submit" variant="contained" disabled={isSubmitting}>Entrar</Button></Stack></form></CardContent></Card></Box>;
}

function useStoreData() {
  const { activeStoreId, accessToken } = useAuthStore();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      if (!activeStoreId || !accessToken) return;
      setLoading(true);
      try {
        const [cat, prod] = await Promise.all([
          api.get("/categories", { headers: { ...authHeader(), "x-store-id": activeStoreId } }),
          api.get("/products", { headers: { ...authHeader(), "x-store-id": activeStoreId } })
        ]);
        if (!alive) return;
        setCategories(cat.data.items ?? []);
        setProducts(prod.data.items ?? []);
        setError(null);
      } catch {
        if (alive) setError("Falha ao carregar dados");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeStoreId, accessToken]);
  return { categories, products, setCategories, setProducts, error, loading };
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, stores, activeStoreId, setActiveStoreId, clear } = useAuthStore();
  const navigate = useNavigate();
  const logout = async () => { await api.post("/auth/logout"); clear(); navigate("/login"); };
  return <Box sx={{ display: "flex" }}><CssBaseline /><Drawer variant="permanent"><Box p={2}><Typography variant="h6">Dronz & Gooder</Typography><Stack mt={2} gap={1}>{stores.map((store) => <Button key={store.id} variant={store.id === activeStoreId ? "contained" : "text"} onClick={() => setActiveStoreId(store.id)}>{store.nome}</Button>)}</Stack></Box></Drawer><Box component="main" sx={{ flex: 1, ml: 28 }}><AppBar position="static"><Toolbar><Typography sx={{ flex: 1 }}>{user?.email}</Typography><Select size="small" value={activeStoreId ?? ""} onChange={(event) => setActiveStoreId(String(event.target.value))} sx={{ mr: 2, minWidth: 140 }}>{stores.map((store) => <MenuItem key={store.id} value={store.id}>{store.nome}</MenuItem>)}</Select><Button onClick={logout}>Sair</Button></Toolbar></AppBar>{children}</Box></Box>;
}

function CategoriesPage() {
  const { categories, setCategories, error, loading } = useStoreData();
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const [editing, setEditing] = React.useState<Category | null>(null);
  const form = useForm({ resolver: zodResolver(categorySchema), defaultValues: { nome: "", slug: "", descricao: "", ordem: 0, ativo: true } });
  const save = form.handleSubmit(async (values) => {
    if (!activeStoreId) return;
    const payload = { ...values };
    const response = editing
      ? await api.patch(`/categories/${editing.id}`, payload, { headers: { ...authHeader(), "x-store-id": activeStoreId } })
      : await api.post("/categories", payload, { headers: { ...authHeader(), "x-store-id": activeStoreId } });
    const next = editing ? categories.map((item) => item.id === editing.id ? response.data : item) : [...categories, response.data];
    setCategories(next);
    setEditing(null);
    form.reset();
  });
  const toggle = async (category: Category) => {
    if (!activeStoreId) return;
    const response = await api.patch(`/categories/${category.id}/status`, {}, { headers: { ...authHeader(), "x-store-id": activeStoreId } });
    setCategories(categories.map((item) => item.id === category.id ? response.data : item));
  };
  const remove = async (category: Category) => {
    if (!activeStoreId) return;
    await api.delete(`/categories/${category.id}`, { headers: { ...authHeader(), "x-store-id": activeStoreId } });
    setCategories(categories.filter((item) => item.id !== category.id));
  };
  return <Box p={3}><Typography variant="h4" mb={2}>Categorias</Typography>{loading && <div>Carregando...</div>}{error && <div>{error}</div>}<Stack direction="row" gap={2} flexWrap="wrap"><Card sx={{ width: 340 }}><CardContent><form onSubmit={save}><Stack gap={2}><Controller name="nome" control={form.control} render={({ field }) => <TextField {...field} label="Nome" />} /><Controller name="slug" control={form.control} render={({ field }) => <TextField {...field} label="Slug" />} /><Controller name="descricao" control={form.control} render={({ field }) => <TextField {...field} label="Descrição" />} /><Controller name="ordem" control={form.control} render={({ field }) => <TextField {...field} label="Ordem" type="number" />} /><Button type="submit" variant="contained">{editing ? "Salvar" : "Criar"}</Button></Stack></form></CardContent></Card>{categories.map((category) => <Card key={category.id} sx={{ width: 300, opacity: category.ativo ? 1 : 0.6 }}><CardContent><Typography>{category.nome}</Typography><Typography variant="body2">{category.slug}</Typography><Stack direction="row" gap={1} mt={2}><Button onClick={() => { setEditing(category); form.reset({ nome: category.nome, slug: category.slug, descricao: category.descricao ?? "", ordem: category.ordem, ativo: category.ativo }); }}>Editar</Button><Button onClick={() => toggle(category)}>{category.ativo ? "Desativar" : "Ativar"}</Button><Button color="error" onClick={() => remove(category)}>Excluir</Button></Stack></CardContent></Card>)}</Stack>{!categories.length && <Typography mt={2}>Nenhuma categoria.</Typography>}</Box>;
}

function ProductsPage() {
  const { categories, products, setProducts, error, loading } = useStoreData();
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const form = useForm({ resolver: zodResolver(productSchema), defaultValues: { codigo: 301, nome: "", slug: "", categoriaId: "", descricao: "", precoVenda: 0, markup: 25, peso: 0 } });
  const save = form.handleSubmit(async (values) => {
    if (!activeStoreId) return;
    const response = editing
      ? await api.patch(`/products/${editing.id}`, values, { headers: { ...authHeader(), "x-store-id": activeStoreId } })
      : await api.post("/products", values, { headers: { ...authHeader(), "x-store-id": activeStoreId } });
    setProducts(editing ? products.map((item) => item.id === editing.id ? response.data : item) : [...products, response.data]);
    setEditing(null);
    form.reset();
  });
  return <Box p={3}><Typography variant="h4" mb={2}>Produtos</Typography>{loading && <div>Carregando...</div>}{error && <div>{error}</div>}<Stack direction="row" gap={2} flexWrap="wrap"><Card sx={{ width: 360 }}><CardContent><form onSubmit={save}><Stack gap={2}><Controller name="codigo" control={form.control} render={({ field }) => <TextField {...field} label="Código" type="number" />} /><Controller name="nome" control={form.control} render={({ field }) => <TextField {...field} label="Nome" />} /><Controller name="slug" control={form.control} render={({ field }) => <TextField {...field} label="Slug" />} /><Controller name="categoriaId" control={form.control} render={({ field }) => <TextField {...field} select label="Categoria">{categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.nome}</MenuItem>)}</TextField>} /><Controller name="precoVenda" control={form.control} render={({ field }) => <TextField {...field} label="Preço de venda" type="number" />} /><Controller name="markup" control={form.control} render={({ field }) => <TextField {...field} label="Markup" type="number" />} /><Button type="submit" variant="contained">{editing ? "Salvar" : "Criar"}</Button></Stack></form></CardContent></Card>{products.map((product) => <Card key={product.id} sx={{ width: 320, opacity: product.ativo ? 1 : 0.6 }}><CardContent><Typography>{product.nome}</Typography><Typography variant="body2">Código {product.codigo}</Typography><Typography variant="body2">{Number(product.precoVenda) === 0 ? "A definir" : product.precoVenda}</Typography><Stack direction="row" gap={1} mt={2}><Button onClick={() => { setEditing(product); form.reset({ codigo: product.codigo, nome: product.nome, slug: product.slug, categoriaId: product.categoria.id, descricao: product.descricao ?? "", precoVenda: Number(product.precoVenda), markup: Number(product.markup), peso: 0 }); }}>Editar</Button><Button onClick={async () => { if (!activeStoreId) return; const response = await api.patch(`/products/${product.id}/status`, {}, { headers: { ...authHeader(), "x-store-id": activeStoreId } }); setProducts(products.map((item) => item.id === product.id ? response.data : item)); }}>{product.ativo ? "Desativar" : "Ativar"}</Button></Stack></CardContent></Card>)}</Stack>{!products.length && <Typography mt={2}>Nenhum produto.</Typography>}</Box>;
}

function OperacaoPage() {
  const { stores, activeStoreId } = useAuthStore();
  const activeStore = stores.find((store) => store.id === activeStoreId);
  return <Box p={3}><Stack gap={2}><Typography variant="h4">Operação</Typography><Typography>Loja ativa: {activeStore?.nome ?? "Selecione uma loja"}</Typography><Card><CardContent><Typography>Categoria 1</Typography></CardContent></Card><Card><CardContent><Typography>Categoria 2</Typography></CardContent></Card><Card><CardContent><Typography>Categoria 3</Typography></CardContent></Card><Card><CardContent><Typography>Categoria 4</Typography></CardContent></Card><Typography>Área de pendências vazia</Typography><Typography>Outros módulos virão depois.</Typography></Stack></Box>;
}

export function NotFoundPage() {
  return <div>404</div>;
}

export function AppRoutes() {
  return <ThemeProvider theme={theme}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/operacao" element={<AuthGate><Shell><OperacaoPage /></Shell></AuthGate>} /><Route path="/categorias" element={<AuthGate><Shell><CategoriesPage /></Shell></AuthGate>} /><Route path="/produtos" element={<AuthGate><Shell><ProductsPage /></Shell></AuthGate>} /><Route path="*" element={<NotFoundPage />} /></Routes></ThemeProvider>;
}
