import React from "react";
import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "./ui/ContentCard";
import { MutationStatus } from "./ui/MutationStatus";

// Batch 18: indicadores versionados, calculados sob demanda; nunca somam moedas diferentes.
type Result = {
  versao: string;
  referenciaEm: string;
  definicoes: { codigo: string; descricao: string; formula: string }[];
  linhas: {
    codigo: string;
    dimensao: string | null;
    moeda: string | null;
    valor: string | null;
    amostra: number;
    status: string;
  }[];
};

export function IndicatorsPanel() {
  const store = useAuthStore((s) => s.activeStoreId);
  const permissions = useAuthStore((s) => s.permissions);
  const canExport =
    permissions.includes("ANALYTICS_EXPORTAR") ||
    permissions.includes("SYSTEM_ADMIN");
  const headers = { ...authHeader(), "x-store-id": store };
  const [draft, setDraft] = React.useState({ from: "", to: "", moeda: "" });
  const [params, setParams] = React.useState<Record<string, string> | null>(
    null
  );
  const result = useQuery<Result>({
    queryKey: ["analytics-indicators", store, params],
    enabled: !!store && !!params,
    queryFn: async () =>
      (await api.get("/analytics/indicators", { headers, params: params! }))
        .data
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const response = await api.get("/analytics/indicators.csv", {
        headers,
        params: params ?? {},
        responseType: "blob"
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "indicadores.csv";
      link.click();
      URL.revokeObjectURL(url);
    }
  });
  const descriptions = new Map(
    result.data?.definicoes.map((d) => [d.codigo, d.descricao]) ?? []
  );
  return (
    <ContentCard title="Indicadores">
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={(event) => {
          event.preventDefault();
          setParams(
            Object.fromEntries(
              Object.entries({
                from: draft.from && new Date(draft.from).toISOString(),
                to: draft.to && new Date(draft.to).toISOString(),
                moeda: draft.moeda
              }).filter(([, value]) => value)
            )
          );
        }}
      >
        <TextField
          type="date"
          label="Indicadores de"
          InputLabelProps={{ shrink: true }}
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <TextField
          type="date"
          label="Indicadores até (exclusivo)"
          InputLabelProps={{ shrink: true }}
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <TextField
          label="Moeda (opcional)"
          value={draft.moeda}
          onChange={(e) =>
            setDraft({ ...draft, moeda: e.target.value.toUpperCase() })
          }
        />
        <Button type="submit">Calcular indicadores</Button>
        {canExport && params && (
          <Button
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            Exportar CSV
          </Button>
        )}
      </Stack>
      <MutationStatus mutation={exportCsv} successMessage="CSV gerado." />
      {result.isLoading && <Typography>Calculando…</Typography>}
      {result.isError && (
        <Typography role="alert">Falha ao calcular indicadores.</Typography>
      )}
      {result.data && (
        <>
          <Typography variant="body2" color="text.secondary">
            Versão {result.data.versao} · corte{" "}
            {new Date(result.data.referenciaEm).toLocaleString("pt-BR")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Indicador</TableCell>
                <TableCell>Dimensão</TableCell>
                <TableCell>Moeda</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Amostra</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.data.linhas.map((line, index) => (
                <TableRow
                  key={`${line.codigo}:${line.dimensao}:${line.moeda}:${index}`}
                >
                  <TableCell>
                    {descriptions.get(line.codigo) ?? line.codigo}
                  </TableCell>
                  <TableCell>{line.dimensao ?? "—"}</TableCell>
                  <TableCell>{line.moeda ?? "—"}</TableCell>
                  <TableCell>
                    {line.status === "SEM_AMOSTRA"
                      ? "Sem amostra"
                      : (line.valor ?? "—")}
                  </TableCell>
                  <TableCell>{line.amostra}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </ContentCard>
  );
}
