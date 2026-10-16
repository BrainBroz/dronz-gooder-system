import * as React from "react";
import { Alert, Button, Pagination, Stack, Tabs, Tab, Typography } from "@mui/material";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { ContentCard } from "../components/ui/ContentCard";
import { PurchaseHomeHeader } from "../components/purchases/PurchaseHomeHeader";
import { EconomicPanel } from "../components/purchases/EconomicPanel";
import { PurchaseQueueFilters } from "../components/purchases/PurchaseQueueFilters";
import { PurchaseQueueTable } from "../components/purchases/PurchaseQueueTable";
import { PurchaseDetailDrawer } from "../components/purchases/PurchaseDetailDrawer";
import { NewPurchaseDrawer } from "../components/purchases/NewPurchaseDrawer";
import { matchesQuickFilter, type QuickFilterKey } from "../components/purchases/queueFilter";
import { useUnifiedPurchases } from "../hooks/useUnifiedPurchases";
import { useAuthStore } from "../stores/auth";
import type { UnifiedPurchaseFilters } from "../types/unified-purchases";

const urgencyToQuickFilter: Record<string, QuickFilterKey> = {
  mappingsPending: "mappingsPending",
  unassigned: "unassigned",
  conflicts: "conflicts",
  readyToMaterialize: "readyToMaterialize"
};

const quickFilterTabs: { key: QuickFilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "mappingsPending", label: "Sem mapping" },
  { key: "unassigned", label: "Sem atribuição" },
  { key: "readyToMaterialize", label: "Materializar" },
  { key: "conflicts", label: "Conflitos" }
];

const emptyFilters: UnifiedPurchaseFilters = { page: 1, limit: 20 };

export function PurchaseQueuePage() {
  const permissions = useAuthStore((state) => state.permissions);
  const canView = permissions.includes("COMPRAS_IMPORTADAS_VISUALIZAR");
  const canCreatePurchase = permissions.includes("COMPRAS_IMPORTADAS_IMPORTAR");
  const [filters, setFilters] = React.useState<UnifiedPurchaseFilters>(emptyFilters);
  const [quickFilter, setQuickFilter] = React.useState<QuickFilterKey>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newPurchaseOpen, setNewPurchaseOpen] = React.useState(false);
  // Reflete se o NewPurchaseDrawer tem uma mutação em voo (compra ou
  // merchant contextual). Perder COMPRAS_IMPORTADAS_VISUALIZAR não pode
  // desmontar o drawer nesse estado — só depois que a mutação terminar.
  const [drawerBusy, setDrawerBusy] = React.useState(false);

  const { overview, list } = useUnifiedPurchases(filters, canView);

  const updateFilter = <K extends keyof UnifiedPurchaseFilters>(
    key: K,
    value: UnifiedPurchaseFilters[K]
  ) => {
    setFilters((current) => ({ ...current, [key]: value || undefined, page: 1 }));
  };

  const hasActiveFilters =
    Boolean(filters.estado) ||
    Boolean(filters.plataforma) ||
    Boolean(filters.referencia) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    quickFilter !== "all";

  const filteredItems = (list.data?.items ?? []).filter((item) =>
    matchesQuickFilter(item, quickFilter)
  );

  return (
    <PageContainer>
      {!canView && (
        <Alert severity="error">
          Você não possui permissão para visualizar a staging global de compras.
          {drawerBusy &&
            " A operação de nova compra em andamento será concluída normalmente."}
        </Alert>
      )}

      {canView && (
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          eyebrow="Área global · staging"
          title="Compras"
          description="Revisão, mapping, atribuição e materialização de compras importadas."
          actions={
            canCreatePurchase && (
              <Button variant="contained" onClick={() => setNewPurchaseOpen(true)}>
                + Nova compra
              </Button>
            )
          }
        />

        {overview.isError && (
          <Alert severity="error">Falha ao carregar a visão geral de compras.</Alert>
        )}
        {overview.data && (
          <>
            <PurchaseHomeHeader
              overview={overview.data}
              activeFilter={quickFilter}
              onSelectFilter={(key) =>
                setQuickFilter(urgencyToQuickFilter[key] ?? "all")
              }
            />
            <EconomicPanel overview={overview.data} />
          </>
        )}

        <ContentCard>
          <Stack gap={2}>
            <Tabs
              value={quickFilter}
              onChange={(_event, value: QuickFilterKey) => setQuickFilter(value)}
              variant="scrollable"
              allowScrollButtonsMobile
            >
              {quickFilterTabs.map((tab) => (
                <Tab key={tab.key} value={tab.key} label={tab.label} />
              ))}
            </Tabs>
            <PurchaseQueueFilters filters={filters} onChange={updateFilter} />
          </Stack>
        </ContentCard>

        <ContentCard>
          <PurchaseQueueTable
            items={filteredItems}
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.refetch()}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={() => {
              setFilters(emptyFilters);
              setQuickFilter("all");
            }}
            onOpen={setSelectedId}
          />
          {list.data && list.data.total > list.data.limit && (
            <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
              <Typography variant="body2" color="text.secondary">
                {list.data.items.length} de {list.data.total}
              </Typography>
              <Pagination
                page={list.data.page}
                count={Math.ceil(list.data.total / list.data.limit)}
                onChange={(_event, page) => setFilters((current) => ({ ...current, page }))}
              />
            </Stack>
          )}
        </ContentCard>
      </Stack>
      )}

      {canView && (
        <PurchaseDetailDrawer purchaseId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <NewPurchaseDrawer
        open={newPurchaseOpen && (canView || drawerBusy)}
        onClose={() => setNewPurchaseOpen(false)}
        listItems={canView ? (list.data?.items ?? []) : []}
        onPendingChange={setDrawerBusy}
        canSubmit={canCreatePurchase}
      />
    </PageContainer>
  );
}
