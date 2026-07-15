import React from "react";
import { MenuItem, Stack, TextField, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from "@mui/material";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuthStore } from "../stores/auth";
import { useReport, type ReportType } from "../hooks/useReport";

const reportConfigs: Array<{ value: ReportType; label: string; description: string }> = [
  { value: "purchase-orders", label: "Pedidos de Compra", description: "Lista de pedidos com status e totais" },
  { value: "purchase-items", label: "Itens Comprados", description: "Items dos pedidos com detalhes" },
  { value: "logistics", label: "Logística por Viagem", description: "Viagens e alocações" },
  { value: "suitcase-weight", label: "Peso por Mala", description: "Malas com pesos e limites" },
  { value: "receiving", label: "Recebimentos", description: "Status de recebimento de itens" },
  { value: "inventory", label: "Posição de Estoque", description: "Estoque por produto" },
  { value: "movements", label: "Movimentações", description: "Histórico de movimentações" },
  { value: "costs", label: "Custos por Pedido", description: "Custos associados" },
  { value: "payments", label: "Pagamentos", description: "Histórico de pagamentos" },
  { value: "markup", label: "Markup e Margem", description: "Análise de margem por produto" }
];

function ReportsContent() {
  const [reportType, setReportType] = React.useState<ReportType>("purchase-orders");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  const filters = React.useMemo(() => ({
    from: fromDate ? new Date(fromDate) : undefined,
    to: toDate ? new Date(toDate) : undefined
  }), [fromDate, toDate]);

  const report = useReport(reportType, filters);

  const getDisplayValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    if (value instanceof Date) return value.toLocaleDateString("pt-BR");
    if (typeof value === "object") return JSON.stringify(value).substring(0, 50) + "...";
    return String(value);
  };

  const getColumns = (data: unknown[]): string[] => {
    if (!data || data.length === 0) return [];
    const first = data[0] as Record<string, unknown>;
    return Object.keys(first).filter(k => !k.startsWith("_"));
  };

  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      <PageHeader title="Relatórios" description="Dados operacionais por tipo e período" />

      <ContentCard title="Seleção de Relatório">
        <Stack gap={2}>
          <TextField
            select
            label="Tipo de Relatório"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            fullWidth
          >
            {reportConfigs.map((config) => (
              <MenuItem key={config.value} value={config.value}>
                {config.label} — {config.description}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: "column", md: "row" }} gap={2}>
            <TextField
              type="date"
              label="De"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              slotProps={{ input: { style: { minWidth: 180 } } }}
            />
            <TextField
              type="date"
              label="Até"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              slotProps={{ input: { style: { minWidth: 180 } } }}
            />
          </Stack>
        </Stack>
      </ContentCard>

      {report.isLoading && <Typography>Carregando relatório...</Typography>}
      {report.isError && <Typography color="error">Erro ao carregar relatório</Typography>}

      {report.data && report.data.length === 0 && (
        <Typography>Nenhum registro encontrado para os filtros selecionados.</Typography>
      )}

      {report.data && report.data.length > 0 && (
        <ContentCard
          title={reportConfigs.find(c => c.value === reportType)?.label || "Relatório"}
          description={`${report.data.length} registro(s)`}
        >
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ maxWidth: "100%", overflowX: "auto" }}
          >
            <Table size="small">
              <TableHead sx={{ backgroundColor: "#f5f5f5" }}>
                <TableRow>
                  {getColumns(report.data).map((col) => (
                    <TableCell key={col} sx={{ fontWeight: "bold" }}>
                      {col.replace(/([A-Z])/g, " $1").trim()}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {report.data.map((row, idx) => (
                  <TableRow key={idx} hover>
                    {getColumns(report.data).map((col) => (
                      <TableCell key={`${idx}-${col}`}>
                        {getDisplayValue((row as Record<string, unknown>)[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </ContentCard>
      )}
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
