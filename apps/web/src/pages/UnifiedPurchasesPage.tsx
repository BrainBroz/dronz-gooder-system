import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Pagination,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import {
  BlockingReasons,
  PurchaseDetail
} from "../components/unified-purchases/PurchaseDetail";
import {
  CreationDialog,
  type CreationMode
} from "../components/unified-purchases/CreationDialog";
import { useUnifiedPurchases } from "../hooks/useUnifiedPurchases";
import { useAuthStore } from "../stores/auth";
import type {
  PurchaseProvider,
  UnifiedPurchaseFilters
} from "../types/unified-purchases";

const providers: PurchaseProvider[] = [
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA",
  "MANUAL"
];
const states = [
  "IMPORTADA",
  "EM_REVISAO",
  "CANCELADA",
  "COM_DIVERGENCIA"
] as const;

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <ContentCard>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography variant="h5">{value}</Typography>
    </ContentCard>
  );
}

export function UnifiedPurchasesPage() {
  const permissions = useAuthStore((state) => state.permissions);
  const stores = useAuthStore((state) => state.stores);
  const [filters, setFilters] = React.useState<UnifiedPurchaseFilters>({
    page: 1,
    limit: 10
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [creation, setCreation] = React.useState<CreationMode>(null);
  const [view, setView] = React.useState<"all" | "store">("all");
  const canView = permissions.includes("COMPRAS_IMPORTADAS_VISUALIZAR");
  const purchases = useUnifiedPurchases(filters, canView);
  const canImport = permissions.includes("COMPRAS_IMPORTADAS_IMPORTAR");
  const canCreateAccount = permissions.includes("CONTA_EXTERNA_GERENCIAR");
  const canCreateMerchant = permissions.includes(
    "MAPPING_FORNECEDOR_GERENCIAR"
  );
  if (!canView)
    return (
      <PageContainer>
        <Alert severity="error">
          Você não possui permissão para visualizar a staging global.
        </Alert>
      </PageContainer>
    );
  const updateFilter = <K extends keyof UnifiedPurchaseFilters>(
    key: K,
    value: UnifiedPurchaseFilters[K]
  ) => {
    setSelectedId(null);
    setFilters((current) => ({
      ...current,
      [key]: value || undefined,
      page: 1
    }));
  };
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Compras Unificadas"
          description="Staging global para revisão, atribuição por quantidade e materialização por loja."
          actions={
            <Stack direction="row" gap={1} flexWrap="wrap">
              {canCreateAccount && (
                <Button onClick={() => setCreation("account")}>
                  Nova conta
                </Button>
              )}
              {canCreateMerchant && (
                <Button onClick={() => setCreation("merchant")}>
                  Novo merchant
                </Button>
              )}
              {canImport && (
                <Button onClick={() => setCreation("import")}>
                  Registrar externa
                </Button>
              )}
              {canImport && (
                <Button
                  variant="contained"
                  onClick={() => setCreation("manual")}
                >
                  Compra manual
                </Button>
              )}
            </Stack>
          }
        />
        {purchases.overview.isLoading ? (
          <CircularProgress aria-label="Carregando visão geral" />
        ) : purchases.overview.isError ? (
          <Alert
            severity="error"
            action={
              <Button onClick={() => void purchases.overview.refetch()}>
                Tentar novamente
              </Button>
            }
          >
            Falha ao carregar visão geral.
          </Alert>
        ) : (
          purchases.overview.data && (
            <Grid container spacing={2}>
              {[
                ["Compras", purchases.overview.data.totalOrders],
                ["Itens", purchases.overview.data.totalItems],
                ["Não atribuídos", purchases.overview.data.unassigned],
                ["Parciais", purchases.overview.data.partiallyAssigned],
                ["Materializados", purchases.overview.data.materialized],
                ["Saldo pendente", purchases.overview.data.pending],
                ["Conflitos", purchases.overview.data.conflicts],
                ["Mappings pendentes", purchases.overview.data.mappingsPending]
              ].map(([label, value]) => (
                <Grid key={String(label)} size={{ xs: 6, md: 3 }}>
                  <Metric label={String(label)} value={Number(value)} />
                </Grid>
              ))}
            </Grid>
          )
        )}
        <ContentCard>
          <Stack gap={2}>
            <Tabs
              value={view}
              onChange={(_event, value: "all" | "store") => {
                setView(value);
                updateFilter(
                  "lojaId",
                  value === "store" ? stores[0]?.id : undefined
                );
              }}
            >
              <Tab value="all" label="Todas" />
              <Tab value="store" label="Por loja" />
            </Tabs>
            <Stack
              direction={{ xs: "column", md: "row" }}
              gap={1}
              flexWrap="wrap"
            >
              {view === "store" && (
                <TextField
                  select
                  label="Loja"
                  value={filters.lojaId ?? ""}
                  onChange={(event) =>
                    updateFilter("lojaId", event.target.value)
                  }
                >
                  {stores.map((store) => (
                    <MenuItem key={store.id} value={store.id}>
                      {store.nome}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                select
                label="Estado"
                value={filters.estado ?? ""}
                onChange={(event) =>
                  updateFilter(
                    "estado",
                    event.target.value as UnifiedPurchaseFilters["estado"]
                  )
                }
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">Todos</MenuItem>
                {states.map((state) => (
                  <MenuItem key={state} value={state}>
                    {state}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Plataforma"
                value={filters.plataforma ?? ""}
                onChange={(event) =>
                  updateFilter(
                    "plataforma",
                    event.target.value as PurchaseProvider
                  )
                }
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">Todas</MenuItem>
                {providers.map((provider) => (
                  <MenuItem key={provider} value={provider}>
                    {provider}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Referência"
                value={filters.referencia ?? ""}
                onChange={(event) =>
                  updateFilter("referencia", event.target.value)
                }
              />
              <TextField
                label="ID da conta"
                value={filters.contaExternaId ?? ""}
                onChange={(event) =>
                  updateFilter("contaExternaId", event.target.value)
                }
              />
              <TextField
                label="ID do merchant"
                value={filters.merchantExternoId ?? ""}
                onChange={(event) =>
                  updateFilter("merchantExternoId", event.target.value)
                }
              />
              <TextField
                type="date"
                label="De"
                InputLabelProps={{ shrink: true }}
                value={filters.from ?? ""}
                onChange={(event) => updateFilter("from", event.target.value)}
              />
              <TextField
                type="date"
                label="Até"
                InputLabelProps={{ shrink: true }}
                value={filters.to ?? ""}
                onChange={(event) => updateFilter("to", event.target.value)}
              />
            </Stack>
          </Stack>
        </ContentCard>
        {purchases.list.isLoading && (
          <CircularProgress aria-label="Carregando compras unificadas" />
        )}
        {purchases.list.isError && (
          <Alert
            severity="error"
            action={
              <Button onClick={() => void purchases.list.refetch()}>
                Tentar novamente
              </Button>
            }
          >
            Não foi possível carregar as compras.
          </Alert>
        )}
        {purchases.list.data?.items.map((purchase) => (
          <ContentCard key={purchase.id}>
            <Stack gap={1.5}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                gap={1}
              >
                <Box>
                  <Typography variant="h6">{purchase.reference}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {purchase.provider} ·{" "}
                    {purchase.account?.name ?? "sem conta"} ·{" "}
                    {purchase.merchant?.name ?? "sem merchant"}
                  </Typography>
                </Box>
                <Stack direction="row" gap={1} alignItems="center">
                  <Chip label={purchase.state} />
                  <Button onClick={() => setSelectedId(purchase.id)}>
                    Ver detalhes
                  </Button>
                </Stack>
              </Stack>
              <Typography variant="body2">
                Total {purchase.progress.total} · atribuído{" "}
                {purchase.progress.assigned} · materializado{" "}
                {purchase.progress.materialized} · pendente{" "}
                {purchase.progress.pending}
              </Typography>
              <BlockingReasons reasons={purchase.blockedReasons} />
            </Stack>
          </ContentCard>
        ))}
        {purchases.list.data && purchases.list.data.items.length === 0 && (
          <Alert severity="info">Nenhuma compra corresponde aos filtros.</Alert>
        )}
        {purchases.list.data &&
          purchases.list.data.total > purchases.list.data.limit && (
            <Pagination
              page={purchases.list.data.page}
              count={Math.ceil(
                purchases.list.data.total / purchases.list.data.limit
              )}
              onChange={(_event, page) =>
                setFilters((current) => ({ ...current, page }))
              }
            />
          )}
        {selectedId && (
          <>
            <Divider />{" "}
            <PurchaseDetail
              id={selectedId}
              onClose={() => setSelectedId(null)}
            />
          </>
        )}
        <CreationDialog mode={creation} onClose={() => setCreation(null)} />
      </Stack>
    </PageContainer>
  );
}
