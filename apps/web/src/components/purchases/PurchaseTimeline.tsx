import { Box, Stack, Typography } from "@mui/material";
import { visualTokens } from "../../theme";
import type { UnifiedPurchaseDetail } from "../../types/unified-purchases";
import { commercialStageIndex, commercialStages } from "./commercialStage";

export function PurchaseTimeline({ detail }: { detail: UnifiedPurchaseDetail }) {
  const currentIndex = commercialStageIndex(detail);
  const blocked = detail.blockedReasons.length > 0;
  return (
    <Stack gap={1} aria-label="Linha do tempo comercial">
      <Stack direction="row" alignItems="center">
        {commercialStages.map((stage, index) => {
          const reached = index <= currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <Stack key={stage} direction="row" alignItems="center" sx={{ flex: 1 }}>
              <Box
                aria-current={isCurrent ? "step" : undefined}
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: reached
                    ? isCurrent && blocked
                      ? visualTokens.red
                      : visualTokens.blue
                    : visualTokens.bg3,
                  border: `2px solid ${reached ? visualTokens.blue : visualTokens.border}`,
                  flexShrink: 0
                }}
              />
              {index < commercialStages.length - 1 && (
                <Box
                  sx={{
                    flex: 1,
                    height: 2,
                    backgroundColor: index < currentIndex ? visualTokens.blue : visualTokens.border
                  }}
                />
              )}
            </Stack>
          );
        })}
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        {commercialStages.map((stage, index) => (
          <Typography
            key={stage}
            variant="caption"
            color={index === currentIndex ? "text.primary" : "text.secondary"}
            fontWeight={index === currentIndex ? 700 : 400}
          >
            {stage}
          </Typography>
        ))}
      </Stack>
      {blocked && (
        <Typography variant="body2" color="error">
          Bloqueado: {detail.blockedReasons[0].message}
        </Typography>
      )}
    </Stack>
  );
}
