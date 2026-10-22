import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import {
  ProductCell,
  StoreTag,
  TrackingCell,
  ago,
  day,
  money,
  phaseInfo,
  type Feed,
  type Phase,
  type PurchaseRow
} from "../components/purchases/purchaseParts";
import { TrackingEditDialog } from "../components/purchases/ManualPurchase";
import { extractErrorMessage } from "../utils/errors";

type Mode = "MIAMI" | "BRASIL";
type Stage = "COMPRADO" | "EM_MIAMI" | "EM_REMESSA" | "NO_BRASIL";
type Action = {
  label: string;
  etapa: Stage;
  permission: string;
  primary?: boolean;
};

const BASE = "/integrations/marketplaces";
const MIAMI_PERMISSION = "MIAMI_RECEBIMENTO_CONFIRMAR";
const BRASIL_PERMISSION = "RECEBIMENTO_CONFIRMAR";

const screens: Record<Mode, { title: string; phases: Phase[]; empty: string }> =
  {
    MIAMI: {
      title: "Estoque Miami",
      phases: ["A_CAMINHO_MIAMI", "ENTREGUE", "EM_MIAMI", "EM_REMESSA"],
      empty:
        "Nada a caminho de Miami, entregue, em Miami ou em remessa neste filtro."
    },
    BRASIL: {
      title: "Estoque Brasil",
      phases: ["NO_BRASIL"],
      empty: "Nada no estoque do Brasil neste filtro."
    }
  };

/** O que se pode fazer com compras em cada fase: avançar uma etapa ou desfazer a última. */
const arrivedInMiami: Action[] = [
  {
    label: "Chegou em Miami",
    etapa: "EM_MIAMI",
    permission: MIAMI_PERMISSION,
    primary: true
  }
];
const actionsFor: Partial<Record<Phase, Action[]>> = {
  A_CAMINHO_MIAMI: arrivedInMiami,
  ENTREGUE: arrivedInMiami,
  EM_MIAMI: [
    {
      label: "Enviar na remessa",
      etapa: "EM_REMESSA",
      permission: MIAMI_PERMISSION,
      primary: true
    },
    {
      label: "Ainda não chegou",
      etapa: "COMPRADO",
      permission: MIAMI_PERMISSION
    }
  ],
  EM_REMESSA: [
    {
      label: "Chegou no Brasil",
      etapa: "NO_BRASIL",
      permission: BRASIL_PERMISSION,
      primary: true
    },
    {
      label: "Voltar para Miami",
      etapa: "EM_MIAMI",
      permission: MIAMI_PERMISSION
    }
  ],
  NO_BRASIL: [
    {
      label: "Voltar para a remessa",
      etapa: "EM_REMESSA",
      permission: BRASIL_PERMISSION
    }
  ]
};

const today = () => new Date().toLocaleDateString("sv-SE");

/** Data e detalhe que importam em cada fase: quando o vendedor enviou, chegou em Miami, saiu na remessa ou chegou ao Brasil. */
function whenOf(row: PurchaseRow): {
  date: string | null;
  note: string | null;
} {
  const stage = row.etapa;
  if (row.fase === "NO_BRASIL")
    return {
      date: stage?.chegouBrasilEm
        ? `Chegou ${day(stage.chegouBrasilEm)}`
        : null,
      note: stage?.remessa ?? null
    };
  if (row.fase === "EM_REMESSA")
    return {
      date: stage?.enviadaEm ? `Enviada ${day(stage.enviadaEm)}` : null,
      note: stage?.remessa ?? null
    };
  if (row.fase === "ENTREGUE") {
    // Data da entrega informada pelo eBay ou pelo Parcel (pode vir com hora, sem fuso).
    const raw = row.trackings.find((tracking) => tracking.entrega?.data)
      ?.entrega?.data;
    const parsed = raw ? new Date(raw) : null;
    return {
      date: raw
        ? `Entregue ${parsed && !Number.isNaN(parsed.getTime()) ? day(parsed.toISOString()) : raw}`
        : "Entregue",
      note: null
    };
  }
  if (row.fase === "EM_MIAMI")
    return {
      date: stage?.chegouMiamiEm ? `Chegou ${day(stage.chegouMiamiEm)}` : null,
      note: null
    };
  return {
    date: row.shippedAt ? `Enviado ${day(row.shippedAt)}` : null,
    note: null
  };
}

const units = (row: PurchaseRow) =>
  row.items.reduce(
    (sum, item) => sum + item.quantity - item.cancelledQuantity,
    0
  );
const cost = (row: PurchaseRow) =>
  row.items
    .filter((item) => item.currency.toUpperCase() === "USD")
    .reduce(
      (sum, item) =>
        sum + (item.quantity - item.cancelledQuantity) * item.unitPrice,
      0
    );

export function StockStagePage({ mode }: { mode: Mode }) {
  const screen = screens[mode];
  const client = useQueryClient();
  const stores = useAuthStore((s) => s.stores);
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const viewAll = useAuthStore((s) => s.viewAll);
  const permissions = useAuthStore((s) => s.permissions);
  const can = (code: string) =>
    permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const lojaId = viewAll ? undefined : (activeStoreId ?? undefined);
  const storeName = viewAll
    ? "Todas as lojas"
    : (stores.find((store) => store.id === activeStoreId)?.nome ?? "");
  const [origem, setOrigem] = useState<"LOJA" | "PESSOAL">("LOJA");
  const [fase, setFase] = useState<"" | Phase>("");
  const [busca, setBusca] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(today);
  const [remessa, setRemessa] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [trackingRow, setTrackingRow] = useState<PurchaseRow | null>(null);

  const feed = useQuery<Feed>({
    queryKey: [
      "purchases-feed",
      "estoque",
      mode,
      lojaId ?? "todas",
      origem,
      busca
    ],
    refetchInterval: 60_000,
    queryFn: async () =>
      (
        await api.get(`${BASE}/purchases`, {
          headers: authHeader(),
          params: {
            finalidade: origem,
            fases: screen.phases.join(","),
            limit: 300,
            ...(lojaId ? { lojaId } : {}),
            ...(busca.trim() ? { busca: busca.trim() } : {})
          }
        })
      ).data
  });
  const all = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const rows = all.filter((row) => !fase || row.fase === fase);
  const chosen = rows.filter((row) => selected.has(row.candidateId));
  const chosenPhases = [...new Set(chosen.map((row) => row.fase))];
  const available = (
    chosenPhases.length === 1 ? (actionsFor[chosenPhases[0]!] ?? []) : []
  ).filter((action) => can(action.permission));
  const sending = chosenPhases[0] === "EM_MIAMI";
  // Compras a caminho cujo rastreio já consta como entregue: candidatas a "Chegou em Miami" (a equipe confirma).
  const delivered = rows.filter((row) => row.fase === "ENTREGUE");

  const change = useMutation({
    mutationFn: async (action: Action) =>
      (
        await api.put(
          `${BASE}/purchases/stage`,
          {
            candidateIds: chosen.map((row) => row.candidateId),
            etapa: action.etapa,
            ocorreuEm: new Date(`${date}T12:00:00Z`).toISOString(),
            ...(action.etapa === "EM_REMESSA" && remessa.trim()
              ? { remessa: remessa.trim() }
              : {})
          },
          { headers: authHeader() }
        )
      ).data as { alteradas: number },
    onSuccess: (data, action) => {
      setSelected(new Set());
      setRemessa("");
      setDone(
        `Pronto: ${action.label} (${data.alteradas} ${data.alteradas === 1 ? "compra" : "compras"}).`
      );
      return Promise.all([
        client.invalidateQueries({ queryKey: ["purchases-feed"] }),
        client.invalidateQueries({ queryKey: ["purchase-lots"] })
      ]);
    }
  });

  const toggle = (id: string) =>
    setSelected(
      (current) =>
        new Set(
          current.has(id)
            ? [...current].filter((entry) => entry !== id)
            : [...current, id]
        )
    );
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const summary = screen.phases.map((phase) => {
    const group = all.filter((row) => row.fase === phase);
    return {
      phase,
      orders: group.length,
      units: group.reduce((sum, row) => sum + units(row), 0),
      value: group.reduce((sum, row) => sum + cost(row), 0)
    };
  });

  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title={screen.title}
          actions={
            <Typography variant="caption" color="text.secondary">
              {storeName}
              {feed.data?.atualizadoEm
                ? ` · eBay atualizado ${ago(feed.data.atualizadoEm)}`
                : ""}
            </Typography>
          }
        />
        {done && (
          <Alert severity="success" onClose={() => setDone(null)}>
            {done}
          </Alert>
        )}
        {change.isError && (
          <Alert severity="error">{extractErrorMessage(change.error)}</Alert>
        )}

        {feed.data && (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                md: `repeat(${summary.length}, 1fr)`
              }
            }}
          >
            {summary.map((entry) => (
              <ContentCard key={entry.phase}>
                <Typography variant="caption" color="text.secondary">
                  {phaseInfo[entry.phase].label}
                </Typography>
                <Typography variant="h5">
                  {entry.orders} {entry.orders === 1 ? "pedido" : "pedidos"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {entry.units} {entry.units === 1 ? "unidade" : "unidades"} ·{" "}
                  {money(entry.value)}
                </Typography>
              </ContentCard>
            ))}
          </Box>
        )}

        <Stack
          direction={{ xs: "column", md: "row" }}
          gap={1.5}
          alignItems={{ md: "center" }}
          flexWrap="wrap"
        >
          <TextField
            size="small"
            label="Buscar produto, pedido ou rastreio"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            sx={{ minWidth: 280 }}
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={origem}
            onChange={(_e, next) => next && setOrigem(next)}
            aria-label="Origem"
          >
            <ToggleButton value="LOJA">Da loja</ToggleButton>
            <ToggleButton value="PESSOAL">Pessoais</ToggleButton>
          </ToggleButtonGroup>
          {screen.phases.length > 1 && (
            <TextField
              select
              size="small"
              label="Status"
              value={fase}
              onChange={(event) => setFase(event.target.value as "" | Phase)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">Todos</MenuItem>
              {screen.phases.map((phase) => (
                <MenuItem key={phase} value={phase}>
                  {phaseInfo[phase].label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {delivered.length > 0 && can(MIAMI_PERMISSION) && (
            <Button
              variant="outlined"
              onClick={() =>
                setSelected(new Set(delivered.map((row) => row.candidateId)))
              }
            >
              Selecionar entregues ({delivered.length})
            </Button>
          )}
        </Stack>

        {chosen.length > 0 && (
          <Box sx={{ position: "sticky", top: 8, zIndex: 2 }}>
            <ContentCard>
              <Stack
                direction={{ xs: "column", md: "row" }}
                gap={1.5}
                alignItems={{ md: "center" }}
                flexWrap="wrap"
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {chosen.length}{" "}
                  {chosen.length === 1 ? "selecionada" : "selecionadas"}
                </Typography>
                {chosenPhases.length > 1 && (
                  <Typography color="warning.main">
                    Escolha compras com o mesmo status para mudar de etapa.
                  </Typography>
                )}
                {available.length > 0 && (
                  <>
                    <TextField
                      size="small"
                      type="date"
                      label="Data"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                    {sending && (
                      <TextField
                        size="small"
                        label="Nome da remessa (opcional)"
                        value={remessa}
                        onChange={(event) => setRemessa(event.target.value)}
                      />
                    )}
                    {available.map((action) => (
                      <Button
                        key={action.etapa}
                        variant={action.primary ? "contained" : "outlined"}
                        disabled={change.isPending || !date}
                        onClick={() => change.mutate(action)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </>
                )}
                <Button size="small" onClick={() => setSelected(new Set())}>
                  Limpar seleção
                </Button>
              </Stack>
            </ContentCard>
          </Box>
        )}

        {feed.isLoading && <Typography role="status">Carregando…</Typography>}
        {feed.isError && (
          <Alert severity="error">Não foi possível carregar as compras.</Alert>
        )}
        {feed.data && rows.length === 0 && (
          <Typography>{screen.empty}</Typography>
        )}
        {feed.data && feed.data.total > all.length && (
          <Alert severity="info">
            Mostrando as {all.length} mais recentes de {feed.data.total}. Use a
            busca para achar as outras.
          </Alert>
        )}
        {rows.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label={screen.title}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={allChosen}
                      indeterminate={chosen.length > 0 && !allChosen}
                      onChange={() =>
                        setSelected(
                          allChosen
                            ? new Set()
                            : new Set(rows.map((row) => row.candidateId))
                        )
                      }
                      slotProps={{
                        input: { "aria-label": "Selecionar todas" }
                      }}
                    />
                  </TableCell>
                  {[
                    "Produto",
                    "Empresa",
                    "Tracking",
                    "Data",
                    "Qtd",
                    "Valor",
                    "Status"
                  ].map((name) => (
                    <TableCell
                      key={name}
                      sx={{
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        letterSpacing: 0.5,
                        textTransform: "uppercase"
                      }}
                    >
                      {name}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.flatMap((row) =>
                  row.items.map((item, index) => {
                    const when = whenOf(row);
                    const quantity = item.quantity - item.cancelledQuantity;
                    return (
                      <TableRow
                        key={`${row.candidateId}-${index}`}
                        hover
                        selected={selected.has(row.candidateId)}
                      >
                        <TableCell padding="checkbox">
                          {index === 0 && (
                            <Checkbox
                              size="small"
                              checked={selected.has(row.candidateId)}
                              onChange={() => toggle(row.candidateId)}
                              slotProps={{
                                input: {
                                  "aria-label": `Selecionar pedido ${row.orderId}`
                                }
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell sx={{ minWidth: 240 }}>
                          <ProductCell row={row} item={item} />
                        </TableCell>
                        <TableCell>
                          <StoreTag row={row} />
                        </TableCell>
                        <TableCell>
                          {index === 0 ? (
                            <TrackingCell row={row} onEdit={setTrackingRow} />
                          ) : null}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          <Typography variant="body2">
                            {when.date ?? "—"}
                          </Typography>
                          {when.note && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {when.note}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{quantity}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {money(quantity * item.unitPrice, item.currency)}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={phaseInfo[row.fase].color}
                            label={phaseInfo[row.fase].label.toUpperCase()}
                            sx={{ fontWeight: 700, fontSize: 11 }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
      {trackingRow && (
        <TrackingEditDialog
          key={trackingRow.candidateId}
          row={trackingRow}
          onClose={() => setTrackingRow(null)}
        />
      )}
    </PageContainer>
  );
}
