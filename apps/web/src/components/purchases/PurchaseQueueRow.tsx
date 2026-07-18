import { Button, TableCell, TableRow, Typography } from "@mui/material";
import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";
import { PriorityIndicator } from "./PriorityIndicator";
import { SegmentedProgressBar } from "./SegmentedProgressBar";
import { purchasePriority } from "./priority";
import { formatAge } from "./age";

export function PurchaseQueueRow({
  item,
  onOpen
}: {
  item: UnifiedPurchaseListItem;
  onOpen: (id: string) => void;
}) {
  const priority = purchasePriority(item);
  return (
    <TableRow hover onClick={() => onOpen(item.id)} sx={{ cursor: "pointer" }}>
      <TableCell>
        <PriorityIndicator priority={priority} />
      </TableCell>
      <TableCell>
        <Typography fontWeight={600}>{item.reference}</Typography>
      </TableCell>
      <TableCell>{item.merchant?.name ?? item.provider}</TableCell>
      <TableCell>
        <SegmentedProgressBar progress={item.progress} compact />
      </TableCell>
      <TableCell>
        <Typography variant="body2" color="text.secondary">
          {formatAge(item.orderedAt)}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item.id);
          }}
        >
          Abrir
        </Button>
      </TableCell>
    </TableRow>
  );
}
