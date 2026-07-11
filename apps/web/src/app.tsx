import React from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AppBar, Box, Button, Card, CardContent, CssBaseline, Drawer, List, ListItemButton, MenuItem, Select, Stack, Toolbar, Typography, ThemeProvider, createTheme } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

type AuthState = { accessToken: string | null; user: { name: string; email: string } | null; stores: { slug: string; nome: string }[]; activeStore: string | null };
const AuthContext = React.createContext<{
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

const theme = createTheme({
  palette: { mode: "dark", background: { default: "#0d1117", paper: "#161b27" } }
});

const loginSchema = z.object({ email: z.string().email("Informe um e-mail válido"), password: z.string().min(1, "Senha obrigatória") });

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ accessToken: null, user: null, stores: [], activeStore: null });
  const login = async (email: string, password: string) => {
    if (email !== "admin@example.com" || password !== "password") throw new Error("invalid_credentials");
    setState({ accessToken: "access", user: { name: "Admin", email }, stores: [{ slug: "dronz", nome: "Dronz" }, { slug: "gooder", nome: "Gooder" }], activeStore: "dronz" });
  };
  const logout = () => setState({ accessToken: null, user: null, stores: [], activeStore: null });
  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("missing auth");
  return ctx;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const onSubmit = handleSubmit(async (values) => { await login(values.email, values.password); navigate("/operacao"); });
  return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Card sx={{ width: 360 }}><CardContent><Typography variant="h5">Entrar</Typography><form onSubmit={onSubmit}><Stack gap={2} mt={2}><Controller name="email" control={control} render={({ field }) => <input placeholder="E-mail" {...field} />} /><Typography color="error">{errors.email?.message}</Typography><Controller name="password" control={control} render={({ field }) => <input type="password" placeholder="Senha" {...field} />} /><Typography color="error">{errors.password?.message}</Typography><Button type="submit" disabled={isSubmitting}>Entrar</Button></Stack></form></CardContent></Card></Box>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useAuth();
  return <Box sx={{ display: "flex" }}><CssBaseline /><Drawer variant="permanent"><List>{state.stores.map((store) => <ListItemButton key={store.slug}>{store.nome}</ListItemButton>)}</List></Drawer><Box component="main" sx={{ flex: 1, ml: 30 }}><AppBar position="static"><Toolbar><Typography sx={{ flex: 1 }}>{state.user?.email}</Typography><Button onClick={logout}>Sair</Button></Toolbar></AppBar>{children}</Box></Box>;
}

export function OperacaoPage() {
  const { state } = useAuth();
  return <Box p={3}><Stack gap={2}><Typography variant="h4">Operação</Typography><Select value={state.activeStore ?? ""}><MenuItem value="dronz">Dronz</MenuItem><MenuItem value="gooder">Gooder</MenuItem></Select><Stack direction="row" gap={2}>{["Card 1", "Card 2", "Card 3", "Card 4"].map((title) => <Card key={title} sx={{ flex: 1 }}><CardContent><Typography>{title}</Typography></CardContent></Card>)}</Stack><Card><CardContent><Typography>Área de pendências vazia</Typography></CardContent></Card><Typography>Outros módulos virão depois.</Typography></Stack></Box>;
}

export function NotFoundPage() { return <div>404</div>; }

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.accessToken ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return <ThemeProvider theme={theme}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/operacao" element={<ProtectedRoute><Shell><OperacaoPage /></Shell></ProtectedRoute>} /><Route path="*" element={<NotFoundPage />} /></Routes></ThemeProvider>;
}

export { AuthProvider, useAuth };
