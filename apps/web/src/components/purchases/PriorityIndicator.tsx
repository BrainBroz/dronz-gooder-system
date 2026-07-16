import { Box, Tooltip } from "@mui/material";
import { visualTokens } from "../../theme";
import { priorityLabel, type PurchasePriority } from "./priority";

const colors: Record<PurchasePriority, string> = {
  critical: visualTokens.red,
  high: visualTokens.amber,
  normal: visualTokens.textSecondary,
  done: visualTokens.green
};

export function PriorityIndicator({ priority }: { priority: PurchasePriority }) {
  return (
    <Tooltip title={`Prioridade: ${priorityLabel[priority]}`}>
      <Box
        aria-label={`Prioridade ${priorityLabel[priority]}`}
        sx={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: colors[priority],
          flexShrink: 0
        }}
      />
    </Tooltip>
  );
}
