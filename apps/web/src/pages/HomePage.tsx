import { useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { Icon, type IconName } from "../components/layout/icons";
import { dashboardQueryKeys, logisticsQueryKeys, purchasingQueryKeys } from "../queryKeys";
import { fontMono, storeColor, storeTextColor, visualTokens } from "../theme";

type HomeResponse = {
  referenciaEm: string;
  secoes: {
    codigo: string;
    titulo: string;
    rota: string;
    itens: {
      codigo: string;
      titulo: string;
      quantidade: number;
      definicao: string;
    }[];
  }[];
};
type CompensationRequest = {
  id: string;
  createdAt: string;
  payload: {
    reason?: string;
    adjustments?: { quantityDelta: number }[];
    // PD-12: perda de estoque acima do limite usa a mesma fila.
    kind?: "STOCK_LOSS";
    move?: { quantidade: number; motivo: string; observacoes?: string };
  };
  propostoPor: { name: string };
};

const homeKey = (store: string | null) => ["home", store] as const;

function CompensationQueue({ store }: { store: string }) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const requests = useQuery<CompensationRequest[]>({
    queryKey: ["compensation-requests", store],
    queryFn: async () =>
      (await api.get("/operations/corrections/requests", { headers })).data
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["compensation-requests", store] }),
      client.invalidateQueries({ queryKey: homeKey(store) }),
      // A decisão altera estoque: os indicadores do dashboard precisam ser recalculados.
      client.invalidateQueries({ queryKey: dashboardQueryKeys.summary(store) })
    ]);
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(
        `/operations/corrections/requests/${id}/${approve ? "approve" : "reject"}`,
        approve ? {} : { motivo: reasons[id] ?? "" },
        { headers }
      ),
    onSettled: refresh
  });
  if (!requests.data?.length) return null;
  return (
    <ContentCard title="Compensações aguardando seu aval">
      <Stack gap={1}>
        {requests.data.map((request) => (
          <Stack
            key={request.id}
            direction={{ xs: "column", md: "row" }}
            gap={1}
            alignItems={{ md: "center" }}
          >
            <Typography sx={{ flex: 1 }}>
              {request.payload.kind === "STOCK_LOSS"
                ? `${request.propostoPor.name}: perda de ${request.payload.move?.quantidade} un. (${request.payload.move?.motivo}) · ${request.payload.move?.observacoes ?? ""}`
                : `${request.propostoPor.name}: ${request.payload.reason} (${request.payload.adjustments?.map((adjustment) => adjustment.quantityDelta).join(", ") ?? ""} un.)`}
            </Typography>
            <Button
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: request.id, approve: true })}
            >
              Aprovar
            </Button>
            <TextField
              size="small"
              label="Motivo da rejeição"
              value={reasons[request.id] ?? ""}
              onChange={(event) =>
                setReasons((current) => ({
                  ...current,
                  [request.id]: event.target.value
                }))
              }
            />
            <Button
              disabled={decide.isPending || !(reasons[request.id] ?? "").trim()}
              onClick={() => decide.mutate({ id: request.id, approve: false })}
            >
              Rejeitar
            </Button>
          </Stack>
        ))}
        <MutationStatus
          mutation={decide}
          successMessage="Decisão registrada."
        />
      </Stack>
    </ContentCard>
  );
}

type DashboardSummary = {
  orders: { count: number; total: Record<string, string> | null; byStatus: Record<string, number> };
  openTrips: number;
  pendingReceiving: number;
  inventory: { available: number; reserved: number; zero: number };
  payments: { pending: number; paid: Record<string, string> | null };
  belowMarkup: number;
};
type Trip = {
  id: string;
  status: string;
  modalidade: string;
  origem: string;
  destino: string;
  partidaEm: string;
  chegadaPrevistaEm: string;
  viajante: { nome: string } | null;
  malas: unknown[];
};
type RecentOrder = {
  id: string;
  numeroPedido: string;
  status: string;
  dataCompra: string;
  total: string;
  moeda: string;
  fornecedor: { nome: string };
};
type ExchangeRate = { id: string; valor: string; cotadoEm: string; vigente: boolean; idadeDias: number; aviso: string | null };

// Rótulos de exibição dos enums do backend; não alteram regra nenhuma.
const orderStatusLabel: Record<string, string> = {
  DRAFT: "Rascunho",
  PLACED: "Emitido",
  CONFIRMED: "Confirmado",
  PARTIALLY_RECEIVED_MIAMI: "Recebido parcial em Miami",
  RECEIVED_MIAMI: "Recebido em Miami",
  ALLOCATED_TO_TRIP: "Alocado em viagem",
  IN_TRANSIT_BRAZIL: "Em trânsito ao Brasil",
  ARRIVED_BRAZIL: "Chegou ao Brasil",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado"
};
const tripStatusLabel: Record<string, string> = {
  PLANNED: "Planejada",
  OPEN_FOR_ALLOCATION: "Em alocação",
  CLOSED_FOR_ALLOCATION: "Alocação fechada",
  IN_TRANSIT: "Em trânsito",
  ARRIVED_BRAZIL: "Chegou ao Brasil",
  CANCELLED: "Cancelada"
};
const activeTripStatuses = ["PLANNED", "OPEN_FOR_ALLOCATION", "CLOSED_FOR_ALLOCATION", "IN_TRANSIT"];

// Códigos internos (PD-08, X-07, F-8…) ficam na documentação, não no texto do dia a dia.
export const plainDefinition = (text: string) =>
  text
    .replace(/\s*\((?:PD|D|X|F)-\d+\)/g, "")
    .replace(/,\s*(?:PD|D|X|F)-\d+(?=\))/g, "")
    .replace(/\bem PLANNING\b/g, "em preparação");

const money = (currency: string, value: string | number) => {
  try {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency });
  } catch {
    return `${currency} ${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
  }
};
const byCurrency = (totals: Record<string, string>) => {
  const entries = Object.entries(totals);
  return entries.length ? entries.map(([currency, value]) => money(currency, value)).join(" · ") : "Sem valores";
};
// Exibição padrão no fuso operacional Brasil (X-13), independente do fuso do navegador.
const TIME_ZONE = "America/Sao_Paulo";
export const date = (value: string) => new Date(value).toLocaleDateString("pt-BR", { timeZone: TIME_ZONE });
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: TIME_ZONE });

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card component="section" aria-label={title} sx={{ height: "100%" }}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5} gap={1}>
          <Typography component="h2" variant="h6">{title}</Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function Muted({ children, role }: { children: ReactNode; role?: string }) {
  return (
    <Typography variant="body2" color="text.secondary" role={role}>
      {children}
    </Typography>
  );
}

function QueryState({ query, label }: { query: { isLoading: boolean; isError: boolean }; label: string }) {
  if (query.isLoading) return <Muted role="status">Carregando {label}…</Muted>;
  if (query.isError) return <Muted role="alert">Não foi possível carregar {label}. Tente novamente.</Muted>;
  return null;
}

function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub: ReactNode; tone: string; icon: IconName }) {
  return (
    <Card>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" gap={1.5} alignItems="flex-start">
          <Box sx={{ width: 34, height: 34, borderRadius: "9px", display: "grid", placeItems: "center", color: tone, bgcolor: `${tone}1F`, flexShrink: 0 }}>
            <Icon name={icon} size={17} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: visualTokens.textMuted }}>
              {label}
            </Typography>
            <Typography sx={{ fontFamily: fontMono, fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.25 }}>{value}</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary }}>{sub}</Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// tone pinta fundo e borda; text é o tom claro do mesmo matiz, para o rótulo manter contraste AA sobre a tinta.
function StatusBadge({ label, tone, text }: { label: string; tone: string; text: string }) {
  return (
    <Box component="span" sx={{ px: 0.875, py: 0.25, borderRadius: "6px", fontSize: "0.6875rem", fontWeight: 600, color: text, bgcolor: `${tone}1F`, border: `1px solid ${tone}33`, whiteSpace: "nowrap" }}>
      {label}
    </Box>
  );
}

function ExchangeChip({ store }: { store: string }) {
  const rates = useQuery<ExchangeRate[]>({
    queryKey: ["exchange-rates", store, "USD", "BRL"],
    queryFn: async () =>
      (await api.get("/finance/exchange-rates", {
        headers: { ...authHeader(), "x-store-id": store },
        params: { moedaOrigem: "USD", moedaDestino: "BRL" }
      })).data
  });
  const current = rates.data?.find((rate) => rate.vigente);
  const old = current?.aviso === "COTACAO_ANTIGA";
  const label = rates.isLoading
    ? "Câmbio: carregando…"
    : rates.isError
      ? "Câmbio indisponível"
      : current
        ? `USD→BRL ${Number(current.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} · ${current.idadeDias === 0 ? "hoje" : `há ${current.idadeDias} d`}`
        : "Sem cotação USD→BRL";
  return (
    <Tooltip title={old ? "Cotação vigente antiga: registre uma nova no Financeiro." : current ? `Cotada em ${dateTime(current.cotadoEm)}` : ""}>
      <Box sx={{ alignSelf: "flex-start", px: 1.25, py: 0.5, borderRadius: "8px", fontFamily: fontMono, fontSize: "0.75rem", color: old || !current ? visualTokens.amber : visualTokens.textSecondary, bgcolor: old || !current ? "rgba(245, 158, 11, 0.12)" : visualTokens.bg3, border: `1px solid ${visualTokens.border}` }}>
        {label}
      </Box>
    </Tooltip>
  );
}

function HomeContent() {
  const { stores, activeStoreId: store, permissions } = useAuthStore();
  const navigate = useNavigate();
  const can = (code: string) => permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const headers = { ...authHeader(), "x-store-id": store };
  const activeStore = stores.find((s) => s.id === store);

  const home = useQuery<HomeResponse>({
    queryKey: homeKey(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/operations/home", { headers })).data
  });
  const summary = useQuery<DashboardSummary>({
    queryKey: dashboardQueryKeys.summary(store),
    enabled: !!store && can("ANALYTICS_VISUALIZAR"),
    queryFn: async () => (await api.get("/analytics/dashboard", { headers })).data
  });
  const trips = useQuery<Trip[]>({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const orders = useQuery<{ items: RecentOrder[] }>({
    // Prefixo de purchasingQueryKeys.orders: invalidações da página de pedidos também valem aqui.
    queryKey: [...purchasingQueryKeys.orders(store), "recent"],
    enabled: !!store && can("PEDIDOS_COMPRA_VISUALIZAR"),
    queryFn: async () => (await api.get("/purchase-orders", { headers, params: { page: 1, limit: 5 } })).data
  });

  // Mantém o título da seção vindo do backend: ele carrega o escopo (ex.: compras em staging global).
  const pendingSections = (home.data?.secoes ?? [])
    .map((section) => ({ ...section, itens: section.itens.filter((item) => item.quantidade > 0) }))
    .filter((section) => section.itens.length > 0);
  const activeTrips = (trips.data ?? []).filter((trip) => activeTripStatuses.includes(trip.status));
  const statusEntries = Object.entries(summary.data?.orders.byStatus ?? {}).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...statusEntries.map(([, count]) => count));

  return (
    <Stack gap={2}>
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} justifyContent="space-between" gap={1.5}>
        <Box>
          <Typography variant="h4" component="h1">Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            Visão geral da loja{" "}
            <Box component="span" sx={{ color: storeTextColor(activeStore?.slug), fontWeight: 600 }}>{activeStore?.nome ?? "—"}</Box>
            {home.data && ` · pendências calculadas em ${dateTime(home.data.referenciaEm)}`}
          </Typography>
        </Box>
        {store && can("FINANCEIRO_VISUALIZAR") && <ExchangeChip store={store} />}
      </Stack>

      {can("ANALYTICS_VISUALIZAR") ? (
        <>
          <QueryState query={summary} label="os indicadores" />
          {summary.data && (
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
              <Kpi
                icon="cart"
                tone={visualTokens.blue}
                label="Pedidos de compra"
                value={summary.data.orders.count}
                sub={summary.data.orders.total ? byCurrency(summary.data.orders.total) : "Valores exigem acesso financeiro"}
              />
              <Kpi icon="plane" tone={visualTokens.gooder} label="Viagens abertas" value={summary.data.openTrips} sub="Planejadas, em alocação ou em trânsito" />
              <Kpi icon="truck" tone={visualTokens.amber} label="Recebimentos pendentes" value={summary.data.pendingReceiving} sub="Ainda não concluídos" />
              <Kpi
                icon="warehouse"
                tone={visualTokens.green}
                label="Estoque disponível"
                value={summary.data.inventory.available}
                sub={`${summary.data.inventory.reserved} reservadas · ${summary.data.inventory.zero} sem saldo disponível`}
              />
            </Box>
          )}
        </>
      ) : (
        <Muted>Indicadores consolidados exigem permissão de análise. As pendências abaixo continuam disponíveis.</Muted>
      )}

      {summary.data && (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
          <Panel title="Visão econômica">
            {summary.data.orders.total && summary.data.payments.paid ? (
              <Stack gap={1.5}>
                <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
                  {[
                    ["Total em pedidos", byCurrency(summary.data.orders.total)],
                    ["Pagamentos confirmados", byCurrency(summary.data.payments.paid)],
                    ["Pagamentos pendentes", String(summary.data.payments.pending)]
                  ].map(([label, value]) => (
                    <Box key={label}>
                      <Typography sx={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: visualTokens.textMuted }}>{label}</Typography>
                      <Typography sx={{ fontFamily: fontMono, fontSize: "0.95rem", fontWeight: 600 }}>{value}</Typography>
                    </Box>
                  ))}
                </Box>
                <Muted>
                  Valores separados por moeda, sem conversão. Evolução por período ainda não está disponível neste painel:
                  o servidor entrega apenas o acumulado.
                </Muted>
              </Stack>
            ) : (
              <Muted>Valores econômicos exigem acesso financeiro.</Muted>
            )}
          </Panel>
          <Panel title="Pedidos por situação">
            {statusEntries.length ? (
              <Stack gap={1} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {statusEntries.map(([status, count]) => (
                  <li key={status}>
                    <Stack direction="row" justifyContent="space-between" sx={{ fontSize: "0.75rem" }}>
                      <span>{orderStatusLabel[status] ?? status}</span>
                      <Box component="span" sx={{ fontFamily: fontMono }}>{count}</Box>
                    </Stack>
                    <Box sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: visualTokens.bg3 }}>
                      <Box sx={{ height: "100%", width: `${(count / maxStatus) * 100}%`, borderRadius: 3, bgcolor: visualTokens.blue }} />
                    </Box>
                  </li>
                ))}
              </Stack>
            ) : (
              <Muted>Nenhum pedido registrado nesta loja.</Muted>
            )}
          </Panel>
        </Box>
      )}

      {home.data?.secoes.some((section) => section.codigo === "CORRECOES") && store && <CompensationQueue store={store} />}

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: "repeat(3, 1fr)" }, alignItems: "stretch" }}>
        <Panel title="Pendências e alertas">
          <QueryState query={home} label="as pendências" />
          {home.data && (
            <Stack gap={1}>
              {summary.data && summary.data.belowMarkup > 0 && (
                <Stack direction="row" gap={1} alignItems="center" sx={{ p: 1, borderRadius: "8px", bgcolor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                  <Box sx={{ color: visualTokens.red, display: "flex" }}><Icon name="alert" size={15} /></Box>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {summary.data.belowMarkup} produto(s) com markup abaixo de 25%
                  </Typography>
                  {can("CATALOGO_VISUALIZAR") && <Button size="small" onClick={() => navigate("/produtos")}>Ver</Button>}
                </Stack>
              )}
              {pendingSections.length === 0 && <Muted>Nenhuma ação pendente neste contexto.</Muted>}
              {pendingSections.map((section) => (
                <Box key={section.codigo}>
                  <Typography component="h3" sx={{ fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: visualTokens.textMuted, mt: 0.5 }}>
                    {section.titulo}
                  </Typography>
                  {section.itens.map((item) => (
                <Stack key={item.codigo} direction="row" gap={1.25} alignItems="flex-start" sx={{ py: 0.75, borderBottom: `1px solid ${visualTokens.border}`, "&:last-child": { borderBottom: 0 } }}>
                  <Typography sx={{ fontFamily: fontMono, fontWeight: 600, color: visualTokens.amber, minWidth: 28 }}>{item.quantidade}</Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.titulo}</Typography>
                    <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary }}>{plainDefinition(item.definicao)}</Typography>
                  </Box>
                  {section.rota !== "/" && <Button size="small" onClick={() => navigate(section.rota)}>Abrir</Button>}
                </Stack>
                  ))}
                </Box>
              ))}
            </Stack>
          )}
        </Panel>

        <Panel title="Situação logística" action={<Button size="small" onClick={() => navigate("/logistica")}>Ver viagens</Button>}>
          <QueryState query={trips} label="as viagens" />
          {trips.data && activeTrips.length === 0 && <Muted>Nenhuma viagem ativa nesta loja.</Muted>}
          <Stack gap={1}>
            {activeTrips.slice(0, 5).map((trip) => (
              <Box key={trip.id} sx={{ p: 1.25, borderRadius: "8px", bgcolor: visualTokens.bg, border: `1px solid ${visualTokens.border}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {trip.origem} → {trip.destino}
                  </Typography>
                  <StatusBadge label={tripStatusLabel[trip.status] ?? trip.status} {...(trip.status === "IN_TRANSIT"
                      ? { tone: visualTokens.gooder, text: visualTokens.gooderText }
                      : { tone: visualTokens.blue, text: visualTokens.blueSoft })}
                  />
                </Stack>
                <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary, mt: 0.25 }}>
                  {trip.viajante?.nome ?? (trip.modalidade === "CAIXA_AEREA" ? "Caixa aérea" : "Sem viajante")} · {trip.malas.length} volume(s) · partida {date(trip.partidaEm)} · chegada prevista {date(trip.chegadaPrevistaEm)}
                </Typography>
              </Box>
            ))}
            {activeTrips.length > 5 && <Muted>+{activeTrips.length - 5} viagem(ns) ativa(s).</Muted>}
          </Stack>
        </Panel>

        <Panel
          title="Compras recentes"
          action={can("PEDIDOS_COMPRA_VISUALIZAR") ? <Button size="small" onClick={() => navigate("/pedidos")}>Ver pedidos</Button> : undefined}
        >
          {can("PEDIDOS_COMPRA_VISUALIZAR") ? (
            <>
              <QueryState query={orders} label="os pedidos" />
              {orders.data && orders.data.items.length === 0 && <Muted>Nenhum pedido ativo nesta loja.</Muted>}
              <Stack gap={1}>
                {orders.data?.items.map((order) => (
                  <Box key={order.id} sx={{ pl: 1.25, py: 0.5, borderLeft: `2px solid ${storeColor(activeStore?.slug)}` }}>
                    <Stack direction="row" justifyContent="space-between" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{order.numeroPedido}</Typography>
                      <Typography sx={{ fontFamily: fontMono, fontSize: "0.75rem" }}>{money(order.moeda, order.total)}</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary }} noWrap>
                      {order.fornecedor.nome} · {orderStatusLabel[order.status] ?? order.status} · {date(order.dataCompra)}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </>
          ) : (
            <Muted>Sem permissão para ver pedidos de compra.</Muted>
          )}
        </Panel>
      </Box>
    </Stack>
  );
}

export function HomePage() {
  const store = useAuthStore((s) => s.activeStoreId);
  return (
    <PageContainer>
      <HomeContent key={store} />
    </PageContainer>
  );
}
