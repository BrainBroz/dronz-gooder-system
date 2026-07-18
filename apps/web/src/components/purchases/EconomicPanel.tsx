import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { ContentCard } from "../ui/ContentCard";
import type { UnifiedPurchaseOverview } from "../../types/unified-purchases";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography fontWeight={700} fontSize="1.35rem" lineHeight={1.2}>
        {value}
      </Typography>
    </Box>
  );
}

function FutureMetric({ label }: { label: string }) {
  return (
    <Tooltip title="Depende de read model agregado ainda não implementado (ver matriz de capacidades do contrato de UX).">
      <Box>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography fontWeight={600} fontSize="0.95rem" color="text.secondary">
          Disponível na Fase Econômica
        </Typography>
      </Box>
    </Tooltip>
  );
}

export function EconomicPanel({ overview }: { overview: UnifiedPurchaseOverview }) {
  const readyToMaterialize = overview.fullyAssigned;
  return (
    <ContentCard title="Economia">
      <Stack gap={2}>
        <Typography variant="body2" color="text.secondary">
          {overview.totalOrders} pedidos · {overview.totalItems} itens em revisão
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
            gap: 2
          }}
        >
          <Metric label="Sem mapping" value={overview.mappingsPending} />
          <Metric
            label="Sem atribuição"
            value={overview.unassigned + overview.partiallyAssigned}
          />
          <Metric label="Prontas p/ materializar" value={readyToMaterialize} />
          <Metric label="Materializadas" value={overview.materialized} />
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
            gap: 2,
            pt: 1,
            borderTop: "1px solid",
            borderColor: "divider"
          }}
        >
          <FutureMetric label="Capital comprometido" />
          <FutureMetric label="Potencial de venda" />
        </Box>
      </Stack>
    </ContentCard>
  );
}
