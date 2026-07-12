import React from "react";
import { Box, Typography, Stack } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../api/client";
import { useAuthStore, authHeader } from "../stores/auth";
import { dashboardQueryKeys } from "../queryKeys";

function DashboardContent() {
  const { stores, activeStoreId } = useAuthStore();
  const activeStore = stores.find((store) => store.id === activeStoreId);

  const summary = useQuery({
    queryKey: dashboardQueryKeys.summary(activeStoreId),
    enabled: !!activeStoreId,
    queryFn: async () =>
      (
        await api.get("/analytics/dashboard", {
          headers: { ...authHeader(), "x-store-id": activeStoreId }
        })
      ).data
  });

  const formatNumber = (n: number | undefined) => {
    if (!n) return "0";
    return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  };

  const indicadores = [
    {
      title: "Pedidos Totais",
      value: summary.data?.orders.count,
      subtitle: `Total: ${formatNumber(summary.data?.orders.total)}`
    },
    {
      title: "Estoque Disponível",
      value: summary.data?.inventory.available,
      subtitle: "Itens prontos"
    },
    {
      title: "Estoque Reservado",
      value: summary.data?.inventory.reserved,
      subtitle: "Itens comprometidos"
    },
    {
      title: "Estoque Zerado",
      value: summary.data?.inventory.zero,
      subtitle: "Produtos sem estoque"
    },
    {
      title: "Viagens Abertas",
      value: summary.data?.openTrips,
      subtitle: "Em planejamento/trânsito"
    },
    {
      title: "Recebimentos Pendentes",
      value: summary.data?.pendingReceiving,
      subtitle: "Aguardando conclusão"
    },
    {
      title: "Pagamentos Pendentes",
      value: summary.data?.payments.pending,
      subtitle: "Aguardando processamento"
    },
    {
      title: "Produtos Abaixo do Markup",
      value: summary.data?.belowMarkup,
      subtitle: "Revise preços (min 25%)"
    }
  ];

  const pedidosPorStatus = (summary.data?.orders.byStatus || {}) as Record<string, number>;
  const statusList = Object.entries(pedidosPorStatus).map(([status, count]) => ({
    status,
    count: count as number
  }));

  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      <PageHeader
        eyebrow="Visão geral"
        title="Dashboard Operacional"
        description={`Loja ativa: ${activeStore?.nome ?? "Selecione uma loja"}`}
      />

      {summary.isLoading && <Typography>Carregando indicadores...</Typography>}
      {summary.isError && (
        <Typography color="error">Falha ao carregar dados do dashboard</Typography>
      )}

      {summary.data && (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 2
            }}
          >
            {indicadores.map((ind) => (
              <ContentCard key={ind.title}>
                <Typography color="text.secondary" variant="body2">
                  {ind.title}
                </Typography>
                <Typography fontSize="2rem" fontWeight={700} lineHeight={1.1} mt={1}>
                  {ind.value ?? "—"}
                </Typography>
                <Typography variant="caption" color="text.secondary" mt={1} sx={{ display: "block" }}>
                  {ind.subtitle}
                </Typography>
              </ContentCard>
            ))}
          </Box>

          <ContentCard title="Pedidos por Status">
            {statusList.length === 0 ? (
              <Typography>Nenhum pedido registrado</Typography>
            ) : (
              <Stack gap={1}>
                {statusList.map((item) => (
                  <Box
                    key={item.status}
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      p: 1,
                      borderBottom: "1px solid #eee"
                    }}
                  >
                    <Typography variant="body2">{item.status}</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {item.count}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </ContentCard>

          <ContentCard title="Resumo Operacional">
            <Stack gap={1}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Pedidos Processados
                  </Typography>
                  <Typography variant="h6">
                    {(summary.data.orders.byStatus["COMPLETED"] ?? 0) +
                      (summary.data.orders.byStatus["CANCELLED"] ?? 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Investido
                  </Typography>
                  <Typography variant="h6">
                    {formatNumber(summary.data.orders.total)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Pagamentos Confirmados
                  </Typography>
                  <Typography variant="h6">
                    {formatNumber(summary.data.payments.paid)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Itens em Trânsito
                  </Typography>
                  <Typography variant="h6">
                    {summary.data.openTrips > 0 ? `${summary.data.openTrips} viagem(ns)` : "Nenhuma"}
                  </Typography>
                </Box>
              </Box>
            </Stack>
          </ContentCard>

          <Typography variant="caption" color="text.secondary">
            Os dados refletem apenas a loja ativa. Navegue para módulos específicos para detalhes completos.
          </Typography>
        </>
      )}
    </Stack>
  );
}

export function DashboardPage() {
  const store = useAuthStore((s) => s.activeStoreId);

  return (
    <PageContainer>
      <DashboardContent key={store} />
    </PageContainer>
  );
}
