import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Box, Button, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { NewPurchaseDrawer } from "../components/purchases/NewPurchaseDrawer";
import { useUnifiedPurchases } from "../hooks/useUnifiedPurchases";
import { extractErrorMessage } from "../utils/errors";
import { storeColor, storeTextColor } from "../theme";
import { ProductCell, StoreTag, TrackingCell, ago, money, phaseInfo, type Feed, type Phase, type PurchaseRow, type StoreRef } from "../components/purchases/purchaseParts";

type Lot = { mes: string; pedidos: number; unidades: number; custoUsd: number; cancelados: number; aConfirmar: number; semLoja: number; porLoja: Record<string, number> };
type Lots = { lotes: Lot[]; semLojaTotal: number; atualizadoEm: string | null };
type RefreshResult = { conexao: string; status: string; criados?: number; atualizados?: number; erro?: string };

const BASE = "/integrations/marketplaces";
export const monthLabel = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(" de ", " ").toUpperCase();

const refreshProblem: Record<string, string> = {
  marketplace_authorization_expired: "autorização do eBay expirada: reconecte em Integrações",
  marketplace_provider_not_configured: "leitura do eBay desligada neste servidor",
  parcel_rejected: "o Parcel recusou a chave: confira PARCEL_API_KEY",
  parcel_unavailable: "o Parcel não respondeu agora",
  marketplace_sync_in_progress: "já estava atualizando"
};

/** Empresa (loja) da compra, com a cor dela; em conta compartilhada, bolinhas coloridas para escolher a loja com um clique. */
function StoreCell({ row, stores, onPick, busy }: { row: PurchaseRow; stores: StoreRef[]; onPick: (lojaId: string) => void; busy: boolean }) {
  if (row.canChangeStore)
    return (
      <Stack direction="row" gap={0.75} alignItems="center" role="group" aria-label="Loja da compra">
        {stores.map((store) => {
          const selected = row.store?.id === store.id;
          return (
            <Tooltip key={store.id} title={selected ? `Loja: ${store.nome}` : `Atribuir à ${store.nome}`}>
              <span>
                <Box
                  component="button" type="button" disabled={busy || selected} aria-label={`Atribuir à ${store.nome}`} aria-pressed={selected} onClick={() => onPick(store.id)}
                  sx={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${storeColor(store.slug)}`, bgcolor: selected ? storeColor(store.slug) : "transparent", cursor: selected ? "default" : "pointer", p: 0 }}
                />
              </span>
            </Tooltip>
          );
        })}
        <Typography variant="caption" sx={{ color: row.store ? storeTextColor(row.store.slug) : "warning.main", fontWeight: 600 }}>{row.store ? row.store.nome : "Escolha a loja"}</Typography>
      </Stack>
    );
  return <StoreTag row={row} />;
}

function StatusCell({ row, onConfirm, busy }: { row: PurchaseRow; onConfirm: () => void; busy: boolean }) {
  const phase = phaseInfo[row.fase];
  return (
    <Stack gap={0.5} alignItems="flex-start">
      <Chip size="small" color={phase.color} label={phase.label.toUpperCase()} sx={{ fontWeight: 700, fontSize: 11 }} />
      {row.canApprove && <Button size="small" variant="contained" disabled={busy} onClick={onConfirm} sx={{ py: 0.1, fontSize: 11 }}>Confirmar compra</Button>}
      {!row.canApprove && row.status === "AGUARDANDO_APROVACAO" && <Chip size="small" variant="outlined" label="A confirmar" />}
      {row.status === "COM_DIVERGENCIA" && <Chip size="small" variant="outlined" color="warning" label="Com divergência" />}
    </Stack>
  );
}

function LotCard({ lot, onOpen }: { lot: Lot; onOpen: () => void }) {
  return (
    <ContentCard>
      <Box component="button" type="button" onClick={onOpen} aria-label={`Abrir lote ${monthLabel(lot.mes)}`} sx={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
        <Stack gap={1.25}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{monthLabel(lot.mes)}</Typography>
          <Stack direction="row" gap={3}>
            <Box><Typography variant="caption" color="text.secondary">Pedidos</Typography><Typography variant="h6">{lot.pedidos}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">Unidades</Typography><Typography variant="h6">{lot.unidades}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">Custo total</Typography><Typography variant="h6">{money(lot.custoUsd)}</Typography></Box>
          </Stack>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {Object.entries(lot.porLoja).map(([slug, count]) => (
              <Chip key={slug} size="small" variant="outlined" label={`${slug.toUpperCase()} ${count}`} sx={{ color: storeTextColor(slug), borderColor: storeColor(slug), fontWeight: 700, fontSize: 11 }} />
            ))}
            {lot.semLoja > 0 && <Chip size="small" color="warning" variant="outlined" label={`${lot.semLoja} sem loja`} />}
            {lot.aConfirmar > 0 && <Chip size="small" color="warning" variant="outlined" label={`${lot.aConfirmar} a confirmar`} />}
            {lot.cancelados > 0 && <Chip size="small" color="error" variant="outlined" label={lot.cancelados === 1 ? "1 cancelado" : `${lot.cancelados} cancelados`} />}
          </Stack>
        </Stack>
      </Box>
    </ContentCard>
  );
}

export function PurchasesPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes");
  const stores = useAuthStore((s) => s.stores);
  const setViewAll = useAuthStore((s) => s.setViewAll);
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const viewAll = useAuthStore((s) => s.viewAll);
  const permissions = useAuthStore((s) => s.permissions);
  const can = (code: string) => permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const lojaId = viewAll ? undefined : (activeStoreId ?? undefined);
  const storeName = viewAll ? "Todas as lojas" : (stores.find((store) => store.id === activeStoreId)?.nome ?? "");
  const [origem, setOrigem] = useState<"LOJA" | "PESSOAL">("LOJA");
  const [fase, setFase] = useState<"" | Phase>("");
  const [busca, setBusca] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [refreshed, setRefreshed] = useState<RefreshResult[] | null>(null);

  const lots = useQuery<Lots>({
    queryKey: ["purchase-lots", lojaId ?? "todas", origem],
    refetchInterval: 60_000,
    queryFn: async () => (await api.get(`${BASE}/purchases/lots`, { headers: authHeader(), params: { finalidade: origem, ...(lojaId ? { lojaId } : {}) } })).data
  });
  const feed = useQuery<Feed>({
    queryKey: ["purchases-feed", mes, lojaId ?? "todas", origem, busca],
    enabled: Boolean(mes),
    refetchInterval: 60_000,
    queryFn: async () =>
      (await api.get(`${BASE}/purchases`, { headers: authHeader(), params: { finalidade: origem, mes, limit: 300, ...(lojaId ? { lojaId } : {}), ...(busca.trim() ? { busca: busca.trim() } : {}) } })).data
  });
  const legacy = useUnifiedPurchases({ page: 1, limit: 100 }, can("COMPRAS_IMPORTADAS_VISUALIZAR"));
  const invalidate = () => Promise.all([client.invalidateQueries({ queryKey: ["purchases-feed"] }), client.invalidateQueries({ queryKey: ["purchase-lots"] })]);
  const refresh = useMutation({
    mutationFn: async () => (await api.post(`${BASE}/purchases/refresh`, {}, { headers: authHeader() })).data as { resultados: RefreshResult[] },
    onSuccess: (data) => {
      setRefreshed(data.resultados);
      return invalidate();
    }
  });
  const confirm = useMutation({
    mutationFn: async (rows: PurchaseRow[]) => {
      for (const row of rows)
        await api.post(`${BASE}/buyer-candidates/${row.candidateId}/decision`, { decision: "APROVAR", expectedVersion: row.version }, { headers: { ...authHeader(), "idempotency-key": crypto.randomUUID() } });
    },
    onSettled: invalidate
  });
  const changeStore = useMutation({
    mutationFn: async ({ candidateId, lojaId: target }: { candidateId: string; lojaId: string }) =>
      (await api.put(`${BASE}/purchases/${candidateId}/store`, { lojaId: target }, { headers: authHeader() })).data,
    onSettled: invalidate
  });
  const busy = confirm.isPending || changeStore.isPending;
  const openMonth = (value: string | null) => setParams(value ? { mes: value } : {}, { replace: false });

  const rows = (feed.data?.items ?? []).filter((row) => !fase || row.fase === fase);
  const live = rows.filter((row) => !row.cancelled);
  const units = live.reduce((sum, row) => sum + row.items.reduce((acc, item) => acc + item.quantity - item.cancelledQuantity, 0), 0);
  const cost = live.reduce((sum, row) => sum + row.items.filter((item) => item.currency.toUpperCase() === "USD").reduce((acc, item) => acc + (item.quantity - item.cancelledQuantity) * item.unitPrice, 0), 0);
  const toConfirm = rows.filter((row) => row.canApprove);
  const updatedAt = (mes ? feed.data?.atualizadoEm : lots.data?.atualizadoEm) ?? null;

  const actions = (
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      <Typography variant="caption" color="text.secondary">{storeName} · {updatedAt ? `atualizado ${ago(updatedAt)}` : "ainda não atualizado"}</Typography>
      {can("INTEGRACAO_MARKETPLACE_SINCRONIZAR") && (
        <Button variant="outlined" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? "Atualizando…" : "Atualizar agora"}</Button>
      )}
      {can("COMPRAS_IMPORTADAS_IMPORTAR") && <Button variant="outlined" onClick={() => setNewOpen(true)}>Cadastrar compra</Button>}
    </Stack>
  );

  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title={mes ? monthLabel(mes) : "Compras"}
          eyebrow={mes ? undefined : "Lotes de compra por mês"}
          actions={actions}
        />
        {mes && (
          <Button size="small" variant="text" onClick={() => openMonth(null)} sx={{ alignSelf: "flex-start" }}>← Voltar aos lotes</Button>
        )}
        {refresh.isError && <Alert severity="error">{extractErrorMessage(refresh.error)}</Alert>}
        {refreshed && (
          <Alert severity={refreshed.some((entry) => entry.erro) ? "warning" : "success"} onClose={() => setRefreshed(null)}>
            {refreshed.length === 0
              ? "Nenhuma conta do eBay conectada para atualizar."
              : refreshed.map((entry) => (entry.erro ? `${entry.conexao}: ${refreshProblem[entry.erro] ?? entry.erro}` : `${entry.conexao}: ${entry.criados ?? 0} com novidades, ${entry.atualizados ?? 0} sem mudança`)).join(" · ")}
          </Alert>
        )}
        {confirm.isError && <Alert severity="error">{extractErrorMessage(confirm.error)}</Alert>}
        {changeStore.isError && <Alert severity="error">{extractErrorMessage(changeStore.error)}</Alert>}

        <Stack direction={{ xs: "column", md: "row" }} gap={1.5} alignItems={{ md: "center" }} flexWrap="wrap">
          {mes && <TextField size="small" label="Buscar produto, pedido ou rastreio" value={busca} onChange={(event) => setBusca(event.target.value)} sx={{ minWidth: 280 }} />}
          <ToggleButtonGroup size="small" exclusive value={origem} onChange={(_e, next) => next && setOrigem(next)} aria-label="Origem">
            <ToggleButton value="LOJA">Da loja</ToggleButton>
            <ToggleButton value="PESSOAL">Pessoais</ToggleButton>
          </ToggleButtonGroup>
          {mes && (
            <TextField select size="small" label="Status" value={fase} onChange={(event) => setFase(event.target.value as "" | Phase)} sx={{ minWidth: 190 }}>
              <MenuItem value="">Todos</MenuItem>
              {(Object.keys(phaseInfo) as Phase[]).map((key) => <MenuItem key={key} value={key}>{phaseInfo[key].label}</MenuItem>)}
            </TextField>
          )}
          {mes && toConfirm.length > 1 && (
            <Button variant="contained" disabled={busy} onClick={() => confirm.mutate(toConfirm)} sx={{ ml: { md: "auto" } }}>Confirmar todas ({toConfirm.length})</Button>
          )}
        </Stack>

        {!viewAll && (lots.data?.semLojaTotal ?? 0) > 0 && (
          <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => setViewAll(true)}>Ver em Todos</Button>}>
            {lots.data!.semLojaTotal === 1 ? "1 compra confirmada ainda está sem loja" : `${lots.data!.semLojaTotal} compras confirmadas ainda estão sem loja`}. Elas só aparecem em Todos, onde você escolhe a loja de cada uma.
          </Alert>
        )}

        {!mes && (
          <>
            {lots.isLoading && <Typography role="status">Carregando…</Typography>}
            {lots.isError && <Alert severity="error">Não foi possível carregar os lotes.</Alert>}
            {lots.data && lots.data.lotes.length === 0 && <Typography>Nenhuma compra neste filtro.</Typography>}
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" } }}>
              {lots.data?.lotes.map((lot) => <LotCard key={lot.mes} lot={lot} onOpen={() => openMonth(lot.mes)} />)}
            </Box>
          </>
        )}

        {mes && (
          <>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
              {[
                ["Pedidos", String(rows.length)],
                ["Unidades", String(units)],
                ["Custo total", money(cost)],
                ["Cancelados", String(rows.length - live.length)]
              ].map(([label, value]) => (
                <ContentCard key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h5">{value}</Typography></ContentCard>
              ))}
            </Box>
            {feed.isLoading && <Typography role="status">Carregando…</Typography>}
            {feed.isError && <Alert severity="error">Não foi possível carregar as compras.</Alert>}
            {feed.data && rows.length === 0 && <Typography>Nenhuma compra neste filtro.</Typography>}
            {rows.length > 0 && (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" aria-label="Compras do lote">
                  <TableHead>
                    <TableRow>
                      {["Produto", "Empresa", "Qtd", "Custo unid.", "Venda proj.", "Markup", "Status", "Tracking"].map((name) => <TableCell key={name} sx={{ whiteSpace: "nowrap", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>{name}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.flatMap((row) =>
                      row.items.map((item, index) => (
                        <TableRow key={`${row.candidateId}-${index}`} hover sx={{ borderLeft: `3px solid ${row.store ? storeColor(row.store.slug) : "transparent"}`, opacity: row.cancelled ? 0.6 : 1 }}>
                          <TableCell sx={{ minWidth: 240 }}>
                            <ProductCell row={row} item={item} />
                          </TableCell>
                          <TableCell><StoreCell row={row} stores={stores} busy={busy} onPick={(target) => changeStore.mutate({ candidateId: row.candidateId, lojaId: target })} /></TableCell>
                          <TableCell>{item.quantity - item.cancelledQuantity || item.quantity}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{money(item.unitPrice, item.currency)}</TableCell>
                          <TableCell>—</TableCell>
                          <TableCell>—</TableCell>
                          <TableCell><StatusCell row={row} busy={busy} onConfirm={() => confirm.mutate([row])} /></TableCell>
                          <TableCell><TrackingCell row={row} /></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Box>
            )}
          </>
        )}
      </Stack>
      <NewPurchaseDrawer open={newOpen} onClose={() => setNewOpen(false)} listItems={legacy.list.data?.items ?? []} />
    </PageContainer>
  );
}
