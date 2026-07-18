import { Box, Button, Stack, Tooltip, Typography } from "@mui/material";
import { ContentCard } from "../ui/ContentCard";
import type { UnifiedPurchaseOverview } from "../../types/unified-purchases";

type UrgencyCard = {
  key: string;
  label: string;
  value: number;
  actionLabel: string;
};

export function PurchaseHomeHeader({
  overview,
  activeFilter,
  onSelectFilter
}: {
  overview: UnifiedPurchaseOverview;
  activeFilter: string;
  onSelectFilter: (key: string) => void;
}) {
  const cards: UrgencyCard[] = [
    {
      key: "mappingsPending",
      label: "Sem mapping",
      value: overview.mappingsPending,
      actionLabel: "Resolver"
    },
    {
      key: "unassigned",
      label: "Sem atribuição",
      value: overview.unassigned + overview.partiallyAssigned,
      actionLabel: "Atribuir"
    },
    {
      key: "conflicts",
      label: "Conflitos",
      value: overview.conflicts,
      actionLabel: "Resolver"
    },
    {
      key: "readyToMaterialize",
      label: "Prontas p/ materializar",
      value: overview.fullyAssigned,
      actionLabel: "Materializar"
    }
  ];

  return (
    <Stack gap={2}>
      <Typography component="h2" variant="h6">
        Exige atenção agora
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
          gap: 2
        }}
      >
        {cards.map((card) => (
          <ContentCard key={card.key}>
            <Stack gap={1}>
              <Typography color="text.secondary" variant="body2">
                {card.label}
              </Typography>
              <Typography fontWeight={700} fontSize="2rem" lineHeight={1.1}>
                {card.value}
              </Typography>
              <Tooltip
                title={
                  card.value === 0
                    ? "Nada pendente nesta categoria"
                    : `Ver ${card.label.toLowerCase()}`
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="text"
                    disabled={card.value === 0}
                    onClick={() => onSelectFilter(card.key)}
                    aria-pressed={activeFilter === card.key}
                  >
                    {card.actionLabel} →
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </ContentCard>
        ))}
      </Box>
    </Stack>
  );
}
