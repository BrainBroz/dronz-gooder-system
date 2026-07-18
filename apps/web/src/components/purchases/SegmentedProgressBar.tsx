import { Box, Stack, Typography } from "@mui/material";
import { visualTokens } from "../../theme";
import type { PurchaseProgress } from "../../types/unified-purchases";

export function SegmentedProgressBar({
  progress,
  compact = false
}: {
  progress: PurchaseProgress;
  compact?: boolean;
}) {
  const total = Math.max(progress.total, 1);
  const materializedPct = (progress.materialized / total) * 100;
  const assignedOnlyPct = (Math.max(progress.assigned - progress.materialized, 0) / total) * 100;

  return (
    <Stack gap={0.5} sx={{ minWidth: compact ? 96 : 160 }}>
      <Box
        role="progressbar"
        aria-valuenow={progress.assigned}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label={`Progresso: ${progress.assigned} de ${progress.total} atribuídos, ${progress.materialized} materializados`}
        sx={{
          display: "flex",
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          backgroundColor: visualTokens.bg3
        }}
      >
        <Box sx={{ width: `${materializedPct}%`, backgroundColor: visualTokens.green }} />
        <Box sx={{ width: `${assignedOnlyPct}%`, backgroundColor: visualTokens.blue }} />
      </Box>
      {!compact && (
        <Typography variant="caption" color="text.secondary">
          {progress.assigned}/{progress.total} atribuídos · {progress.materialized}/{progress.total} materializados
        </Typography>
      )}
    </Stack>
  );
}
