import React from "react";
import { MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { reportQueryKeys } from "../queryKeys";

const reportTypes = [
  ["purchase-orders", "Pedidos de Compra"],
  ["purchase-items", "Itens Comprados"],
  ["logistics", "Logística por Viagem"],
  ["suitcase-weight", "Peso por Mala"],
  ["receiving", "Recebimentos"],
  ["inventory", "Posição de Estoque"],
  ["movements", "Movimentações"],
  ["costs", "Custos por Pedido"],
  ["payments", "Pagamentos"],
  ["markup", "Markup e Margem"]
] as const;

function ReportsContent() {
  const store = useAuthStore((s) => s.activeStoreId);
  const [type, setType] = React.useState<string>("purchase-orders");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const report = useQuery<unknown[]>({
    queryKey: reportQueryKeys.report(store, type, from, to),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get(`/analytics/reports/${type}`, {
          headers: { ...authHeader(), "x-store-id": store },
          params: { from: from || undefined, to: to || undefined }
        })
      ).data
  });

  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      <PageHeader title="Relatórios" />
      <ContentCard>
        <Stack direction={{ xs: "column", md: "row" }} gap={2}>
          <TextField
            select
            label="Relatório"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {reportTypes.map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="date"
            label="De"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            type="date"
            label="Até"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </ContentCard>
      {report.isLoading && <Typography>Carregando...</Typography>}
      {report.isError && <Typography>Falha ao carregar relatório</Typography>}
      {!report.isLoading && !report.data?.length && (
        <Typography>Nenhum registro.</Typography>
      )}
      {report.data?.map((row, index) => (
        <ContentCard key={String((row as { id?: string }).id ?? index)}>
          <Typography component="pre" sx={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(row, null, 2)}
          </Typography>
        </ContentCard>
      ))}
    </Stack>
  );
}

export function ReportsPage() {
  const store = useAuthStore((s) => s.activeStoreId);

  return (
    <PageContainer>
      <ReportsContent key={store} />
    </PageContainer>
  );
}
