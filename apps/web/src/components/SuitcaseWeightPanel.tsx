import { Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { ContentCard } from "./ui/ContentCard";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { logisticsQueryKeys } from "../queryKeys";

type SuitcaseWeight = {
  conteudoKg: string;
  taraKg: string;
  totalKg: string;
  restanteKg: string;
  excesso: boolean;
};

const formatKg = (value: string) => `${Number(value).toFixed(2)} kg`;

export function SuitcaseWeightPanel({ malaId }: { malaId: string | null }) {
  const store = useAuthStore((s) => s.activeStoreId);
  const weight = useQuery<SuitcaseWeight>({
    queryKey: logisticsQueryKeys.suitcaseWeight(store, malaId),
    enabled: !!store && !!malaId,
    queryFn: async () =>
      (
        await api.get(`/logistics/suitcases/${malaId}/weight`, {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data
  });

  return (
    <ContentCard title="Peso da mala">
      {!malaId && <Typography>Selecione uma mala para ver o peso.</Typography>}
      {malaId && weight.isLoading && <Typography>Carregando peso...</Typography>}
      {malaId && weight.isError && (
        <Typography color="error.main">Falha ao carregar peso.</Typography>
      )}
      {malaId && weight.data && (
        <Stack gap={1}>
          <Stack direction={{ xs: "column", sm: "row" }} gap={{ xs: 0.5, sm: 3 }} flexWrap="wrap">
            <Typography>Conteúdo: {formatKg(weight.data.conteudoKg)}</Typography>
            <Typography>Tara: {formatKg(weight.data.taraKg)}</Typography>
            <Typography>Total: {formatKg(weight.data.totalKg)}</Typography>
            <Typography>Restante: {formatKg(weight.data.restanteKg)}</Typography>
          </Stack>
          {weight.data.excesso && (
            <Typography color="error.main">Excesso de peso.</Typography>
          )}
        </Stack>
      )}
    </ContentCard>
  );
}
