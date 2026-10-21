import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { extractErrorMessage } from "../utils/errors";

type Connection = {
  id: string;
  provider: string;
  name: string;
  account: { name: string; externalIdentifier: string };
  allowedStore: { id: string; name: string } | null;
  status: "NOT_CONFIGURED" | "ACTIVE" | "INACTIVE" | "AUTHORIZATION_EXPIRED" | "ERROR";
  authorizationExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  allowedActions: string[];
};
const BASE = "/integrations/marketplaces";
const statusLabel: Record<Connection["status"], [string, "success" | "warning" | "error" | "default"]> = {
  ACTIVE: ["Conectada", "success"],
  NOT_CONFIGURED: ["Não configurada", "default"],
  INACTIVE: ["Inativa", "default"],
  AUTHORIZATION_EXPIRED: ["Autorização expirada: reconecte", "warning"],
  ERROR: ["Com erro", "error"]
};
// O eBay pode devolver a página padrão sem o `state`; guardamos o da última tentativa para completar a conexão.
const STATE_KEY = "ebay-connect-state";
const rememberState = (url: string) => {
  try {
    localStorage.setItem(STATE_KEY, new URL(url).searchParams.get("state") ?? "");
  } catch {
    // sem armazenamento: o endereço colado precisa trazer o state
  }
};
const rememberedState = () => {
  try {
    return localStorage.getItem(STATE_KEY) || undefined;
  } catch {
    return undefined;
  }
};
const when = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "—");
export const callbackAddress = () => `${window.location.origin}/integracoes/ebay/callback`;

function StoreConnections({ store, connections, canManage }: { store: { id: string; nome: string }; connections: Connection[]; canManage: boolean }) {
  const client = useQueryClient();
  const headers = authHeader();
  const [label, setLabel] = useState("");
  const [pasted, setPasted] = useState("");
  const start = useMutation({
    mutationFn: async () => (await api.post(`${BASE}/ebay/connect-intents`, { lojaId: store.id, nome: label.trim() || undefined }, { headers })).data as { url: string },
    onSuccess: (data) => {
      rememberState(data.url);
      window.location.assign(data.url);
    }
  });
  const finish = useMutation({
    mutationFn: async () => (await api.post(`${BASE}/ebay/connections/complete`, { redirectedUrl: pasted.trim(), state: rememberedState() }, { headers })).data,
    onSuccess: () => {
      setPasted("");
      return client.invalidateQueries({ queryKey: ["marketplace-connections"] });
    }
  });
  const sync = useMutation({
    mutationFn: async (id: string) => (await api.post(`${BASE}/connections/${id}/sync-runs`, {}, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } })).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ["marketplace-connections"] })
  });
  return (
    <ContentCard>
      <Stack gap={1.5}>
        <Typography variant="h6" component="h2">{store.nome}</Typography>
        {connections.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma conta do eBay conectada a esta loja.</Typography>}
        {connections.map((connection) => {
          const [text, color] = statusLabel[connection.status];
          return (
            <Stack key={connection.id} direction={{ xs: "column", sm: "row" }} gap={1.5} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Box>
                <Typography>{connection.name} <Typography component="span" variant="body2" color="text.secondary">· conta eBay {connection.account.externalIdentifier}</Typography></Typography>
                <Typography variant="body2" color="text.secondary">
                  Autorização vale até {when(connection.authorizationExpiresAt)} · última sincronização {when(connection.lastSyncAt)}
                </Typography>
                {connection.lastError && <Typography variant="body2" color="error">{connection.lastError}</Typography>}
              </Box>
              <Stack direction="row" gap={1} alignItems="center">
                <Chip size="small" color={color} label={text} />
                {connection.allowedActions.includes("SYNC_CONNECTION") && (
                  <Button size="small" variant="outlined" disabled={sync.isPending} onClick={() => sync.mutate(connection.id)}>Sincronizar agora</Button>
                )}
              </Stack>
            </Stack>
          );
        })}
        <MutationStatus mutation={sync} loadingMessage="Sincronizando com o eBay…" successMessage="Sincronização concluída. As compras aparecem na revisão de compras." />
        {canManage && (
          <Stack gap={1.5} sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} gap={1.5}>
              <TextField size="small" label="Nome da conta (opcional)" value={label} onChange={(event) => setLabel(event.target.value)} sx={{ minWidth: 240 }} />
              <Button variant="contained" disabled={start.isPending} onClick={() => start.mutate()}>Conectar conta eBay</Button>
            </Stack>
            <MutationStatus mutation={start} loadingMessage="Abrindo o eBay…" successMessage="Redirecionando para o eBay…" />
            <Stack direction={{ xs: "column", sm: "row" }} gap={1.5} alignItems={{ sm: "flex-start" }}>
              <TextField
                size="small" fullWidth label="Já autorizou no eBay? Cole aqui o endereço da página para onde ele devolveu você"
                value={pasted} onChange={(event) => setPasted(event.target.value)}
              />
              <Button variant="outlined" disabled={!pasted.trim() || finish.isPending} onClick={() => finish.mutate()} sx={{ whiteSpace: "nowrap" }}>Concluir conexão</Button>
            </Stack>
            <MutationStatus mutation={finish} loadingMessage="Concluindo a conexão…" successMessage="Conta conectada." />
          </Stack>
        )}
      </Stack>
    </ContentCard>
  );
}

export function MarketplaceConnectionsPage() {
  const stores = useAuthStore((s) => s.stores);
  const permissions = useAuthStore((s) => s.permissions);
  const canManage = permissions.includes("SYSTEM_ADMIN") || permissions.includes("INTEGRACAO_MARKETPLACE_GERENCIAR");
  const list = useQuery<Connection[]>({
    queryKey: ["marketplace-connections"],
    queryFn: async () => (await api.get(`${BASE}/connections`, { headers: authHeader(), params: { provider: "EBAY" } })).data
  });
  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title="Integrações"
          description="Conecte uma conta do eBay para cada loja. As compras entram para revisão; nada vira estoque sem aprovação."
        />
        <ContentCard>
          <Typography variant="body2" color="text.secondary">
            No portal de desenvolvedor do eBay, o endereço de retorno (accepted URL) do RuName usado aqui deve ser <strong>{callbackAddress()}</strong>.
            Se o eBay devolver você para outro endereço, copie o endereço completo da página e use "Concluir conexão".
          </Typography>
        </ContentCard>
        {list.isLoading && <Typography role="status">Carregando…</Typography>}
        {list.isError && <Typography color="error" role="alert">Não foi possível carregar as conexões.</Typography>}
        {list.data && stores.map((store) => (
          <StoreConnections key={store.id} store={store} canManage={canManage} connections={list.data.filter((connection) => connection.allowedStore?.id === store.id)} />
        ))}
      </Stack>
    </PageContainer>
  );
}

/** Página para onde o eBay devolve o usuário: troca o código pela conexão uma única vez. */
export function EbayCallbackPage() {
  const [params] = useSearchParams();
  const started = useRef(false);
  const client = useQueryClient();
  const [result, setResult] = useState<{ ok: true; ebayUserId: string } | { ok: false; message: string } | null>(null);
  const code = params.get("code");
  const state = params.get("state");
  useEffect(() => {
    if (started.current || !code || !state) return;
    started.current = true;
    api
      .post(`${BASE}/ebay/connections/complete`, { code, state }, { headers: authHeader() })
      .then((response) => {
        setResult({ ok: true, ebayUserId: response.data.ebayUserId });
        return client.invalidateQueries({ queryKey: ["marketplace-connections"] });
      })
      .catch((error) => setResult({ ok: false, message: extractErrorMessage(error) }));
  }, [code, state, client]);
  const outcome = !code || !state ? ({ ok: false, message: params.get("error_description") ?? "O eBay não devolveu o código de autorização." } as const) : result;
  return (
    <PageContainer>
      <Stack gap={2}>
        <PageHeader title="Conexão com o eBay" />
        {!outcome && <Typography role="status">Concluindo a conexão…</Typography>}
        {outcome?.ok && <Typography color="success.main" role="status">Conta {outcome.ebayUserId} conectada com sucesso.</Typography>}
        {outcome && !outcome.ok && <Typography color="error" role="alert">{outcome.message}</Typography>}
        <Button component={RouterLink} to="/integracoes" variant="outlined" sx={{ alignSelf: "flex-start" }}>Voltar para Integrações</Button>
      </Stack>
    </PageContainer>
  );
}
