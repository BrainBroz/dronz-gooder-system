import { Chip, Tooltip } from "@mui/material";
import type { BlockedReason } from "../../types/unified-purchases";

export function BlockedReasonChip({ reason }: { reason: BlockedReason }) {
  return (
    <Tooltip title={reason.message}>
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        label={reason.message}
        sx={{ maxWidth: 220, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
      />
    </Tooltip>
  );
}
