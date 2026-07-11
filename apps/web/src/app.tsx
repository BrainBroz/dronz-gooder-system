import { Navigate, Route, Routes } from "react-router-dom";
import React from "react";

export function LoginPage() {
  return <div>Login</div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div>Shell administrativo{children}</div>;
}

export function OperacaoPage() {
  return <div>Operação</div>;
}

export function NotFoundPage() {
  return <div>404</div>;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authenticated = true;
  return authenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/operacao"
        element={
          <ProtectedRoute>
            <AppShell>
              <OperacaoPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
