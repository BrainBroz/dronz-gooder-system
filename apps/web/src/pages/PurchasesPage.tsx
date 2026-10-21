import { useState } from "react";
import { Alert, Avatar, Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
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

type PurchaseRow = {
  candidateId: string;
  version: number;
  status: "AGUARDANDO_APROVACAO" | "COM_DIVERGENCIA" | "APROVADA" | "REJEITADA" | "CANCELADA";
  orderId: string;
  orderedAt: string;
  currency: string;
  total: number | null;
  cancelled: boolean;
  externalStatus: string | null;
  account: string;
  purpose: "LOJA" | "PESSOAL";
  store: { id: string; slug: string; nome: string } | null;
  shippedAt: string | null;
  trackings: { carrier: string | null; code: string }[];
  items: { title: string; quantity: number; cancelledQuantity: number; unitPrice: number; currency: string; imageUrl: string | null }[];
  canApprove: boolean;
  canChangeStore: boolean;
};
type Feed = { items: PurchaseRow[]; total: number };

const BASE = "/integrations/marketplaces";
const money = (value: number, currency: string) => value.toLocaleString("pt-BR", { style: "currency", currency });
const day = (value: string) => new Date(value).toLocaleDateString("pt-BR");

/** Situação para quem compra: o que o vendedor já fez (cancelou, enviou com rastreio ou ainda não enviou). */
export function shippingState(row: Pick<PurchaseRow, "cancelled" | "trackings" | "shippedAt">): { label: string; color: "error" | "success" | "warning" } {
  if (row.cancelled) return { label: "Cancelado", color: "error" };
  if (row.trackings.length) return { label: "Enviado pelo vendedor", color: "success" };
  return { label: row.shippedAt ? "Enviado, sem rastreio ainda" : "Aguardando envio do vendedor", color: "warning" };
}

/** Bolinhas coloridas, uma por loja: a da loja atual fica cheia; clicar atribui a compra inteira àquela loja. */
function StorePicker({ row, stores, onPick, busy }: { row: PurchaseRow; stores: { id: string; slug: string; nome: string }[]; onPick: (lojaId: string) => void; busy: boolean }) {
  return (
    <Stack direction="row" gap={0.75} alignItems="center" role="group" aria-label="Loja da compra">
      {stores.map((store) => {
        const selected = row.store?.id === store.id;
        return (
          <Tooltip key={store.id} title={selected ? `Loja: ${store.nome}` : `Atribuir à ${store.nome}`}>
            <span>
              <Box
                component="button" type="button" disabled={busy || selected} aria-label={`Atribuir à ${store.nome}`} aria-pressed={selected}
                onClick={() => onPick(store.id)}
                sx={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${storeColor(store.slug)}`, bgcolor: selected ? storeColor(store.slug) : "transparent", cursor: selected ? "default" : "pointer", p: 0 }}
              />
            </span>
          </Tooltip>
        );
      })}
      <Typography variant="caption" sx={{ color: row.store ? storeTextColor(row.store.slug) : "warning.main", fontWeight: 600 }}>
        {row.store ? row.store.nome : "Escolha a loja"}
      </Typography>
    </Stack>
  );
}

function PurchaseCard({ row, stores, onConfirm, onPickStore, busy }: { row: PurchaseRow; stores: { id: string; slug: string; nome: string }[]; onConfirm: () => void; onPickStore: (lojaId: string) => void; busy: boolean }) {
  const shipping = shippingState(row);
  const confirmed = row.status === "APROVADA";
  return (
    <ContentCard>
      <Stack gap={1.5}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          {row.canChangeStore ? (
            <StorePicker row={row} stores={stores} onPick={onPickStore} busy={busy} />
          ) : row.store ? (
            <Chip
              size="small" variant="outlined" label={row.store.nome}
              sx={{ color: storeTextColor(row.store.slug), borderColor: storeColor(row.store.slug), fontWeight: 600 }}
            />
          ) : (
            <Chip size="small" variant="outlined" label="Sem loja" />
          )}
          {row.purpose === "PESSOAL" && <Chip size="small" label="Pessoal" />}
          <Chip size="small" color={shipping.color} label={shipping.label} />
          <Chip size="small" variant="outlined" color={confirmed ? "success" : "default"} label={confirmed ? "Confirmada" : row.status === "AGUARDANDO_APROVACAO" ? "A confirmar" : row.status === "COM_DIVERGENCIA" ? "Com divergência" : "Rejeitada"} />
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            {day(row.orderedAt)} · pedido {row.orderId} · conta {row.account}
          </Typography>
        </Stack>
        {row.items.map((item, index) => (
          <Stack key={index} direction="row" gap={1.5} alignItems="center">
            <Avatar variant="rounded" src={item.imageUrl ?? undefined} alt="" sx={{ width: 64, height: 64, bgcolor: "action.hover" }}>
              <Box component="span" sx={{ fontSize: 11, color: "text.secondary" }}>sem foto</Box>
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {item.quantity} × {money(item.unitPrice, item.currency)} = <strong>{money(item.quantity * item.unitPrice, item.currency)}</strong>
              </Typography>
            </Box>
          </Stack>
        ))}
        <Stack direction={{ xs: "column", sm: "row" }} gap={1} alignItems={{ sm: "center" }} justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {row.trackings.length
              ? `Rastreio: ${row.trackings.map((t) => `${t.carrier ? `${t.carrier} ` : ""}${t.code}`).join(" · ")}`
              : "Rastreio: o vendedor ainda não informou"}
          </Typography>
          {row.canApprove && (
            <Button variant="contained" size="small" disabled={busy} onClick={onConfirm}>Confirmar compra</Button>
          )}
        </Stack>
      </Stack>
    </ContentCard>
  );
}

export function PurchasesPage() {
  const client = useQueryClient();
  const stores = useAuthStore((s) => s.stores);
  const permissions = useAuthStore((s) => s.permissions);
  const can = (code: string) => permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const [loja, setLoja] = useState("");
  const [origem, setOrigem] = useState<"LOJA" | "PESSOAL">("LOJA");
  const [situacao, setSituacao] = useState<"AGUARDANDO_APROVACAO" | "APROVADA" | "">("");
  const [newOpen, setNewOpen] = useState(false);
  const feed = useQuery<Feed>({
    queryKey: ["purchases-feed", loja, origem, situacao],
    queryFn: async () =>
      (await api.get(`${BASE}/purchases`, { headers: authHeader(), params: { finalidade: origem, limit: 100, ...(loja ? { lojaId: loja } : {}), ...(situacao ? { status: situacao } : {}) } })).data
  });
  const legacy = useUnifiedPurchases({ page: 1, limit: 100 }, can("COMPRAS_IMPORTADAS_VISUALIZAR"));
  const confirm = useMutation({
    mutationFn: async (rows: PurchaseRow[]) => {
      for (const row of rows)
        await api.post(`${BASE}/buyer-candidates/${row.candidateId}/decision`, { decision: "APROVAR", expectedVersion: row.version }, { headers: { ...authHeader(), "idempotency-key": crypto.randomUUID() } });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["purchases-feed"] })
  });
  const changeStore = useMutation({
    mutationFn: async ({ candidateId, lojaId }: { candidateId: string; lojaId: string }) =>
      (await api.put(`${BASE}/purchases/${candidateId}/store`, { lojaId }, { headers: authHeader() })).data,
    onSettled: () => client.invalidateQueries({ queryKey: ["purchases-feed"] })
  });
  const rows = feed.data?.items ?? [];
  const toConfirm = rows.filter((row) => row.canApprove);
  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title="Compras"
          description="Tudo o que foi comprado, com foto, valor, loja e rastreio. As compras do eBay entram já confirmadas; só o que não pôde ser confirmado sozinho fica marcado como A confirmar."
          actions={can("COMPRAS_IMPORTADAS_IMPORTAR") && <Button variant="outlined" onClick={() => setNewOpen(true)}>Cadastrar compra</Button>}
        />
        <Stack direction={{ xs: "column", md: "row" }} gap={2} alignItems={{ md: "center" }} flexWrap="wrap">
          <ToggleButtonGroup size="small" exclusive value={loja} onChange={(_e, next) => next !== null && setLoja(next)} aria-label="Loja">
            <ToggleButton value="">Todas as lojas</ToggleButton>
            {stores.map((store) => <ToggleButton key={store.id} value={store.id}>{store.nome}</ToggleButton>)}
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={origem} onChange={(_e, next) => next && setOrigem(next)} aria-label="Origem">
            <ToggleButton value="LOJA">Compras da loja</ToggleButton>
            <ToggleButton value="PESSOAL">Compras pessoais</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={situacao} onChange={(_e, next) => next !== null && setSituacao(next)} aria-label="Situação">
            <ToggleButton value="AGUARDANDO_APROVACAO">A confirmar</ToggleButton>
            <ToggleButton value="APROVADA">Confirmadas</ToggleButton>
            <ToggleButton value="">Todas</ToggleButton>
          </ToggleButtonGroup>
          {toConfirm.length > 1 && (
            <Button variant="contained" disabled={confirm.isPending} onClick={() => confirm.mutate(toConfirm)} sx={{ ml: { md: "auto" } }}>
              Confirmar todas ({toConfirm.length})
            </Button>
          )}
        </Stack>
        {confirm.isError && <Alert severity="error">{extractErrorMessage(confirm.error)}</Alert>}
        {changeStore.isError && <Alert severity="error">{extractErrorMessage(changeStore.error)}</Alert>}
        {feed.isLoading && <Typography role="status">Carregando…</Typography>}
        {feed.isError && <Alert severity="error">Não foi possível carregar as compras.</Alert>}
        {feed.data && rows.length === 0 && <Typography>Nenhuma compra neste filtro.</Typography>}
        {rows.map((row) => (
          <PurchaseCard
            key={row.candidateId} row={row} stores={stores} busy={confirm.isPending || changeStore.isPending}
            onConfirm={() => confirm.mutate([row])} onPickStore={(lojaId) => changeStore.mutate({ candidateId: row.candidateId, lojaId })}
          />
        ))}
      </Stack>
      <NewPurchaseDrawer open={newOpen} onClose={() => setNewOpen(false)} listItems={legacy.list.data?.items ?? []} />
    </PageContainer>
  );
}
