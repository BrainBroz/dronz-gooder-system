import { Skeleton, TableCell, TableRow } from "@mui/material";

export function PurchaseSkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton variant="circular" width={10} height={10} />
      </TableCell>
      <TableCell>
        <Skeleton width={120} />
      </TableCell>
      <TableCell>
        <Skeleton width={100} />
      </TableCell>
      <TableCell>
        <Skeleton width={140} height={20} />
      </TableCell>
      <TableCell>
        <Skeleton width={60} />
      </TableCell>
      <TableCell>
        <Skeleton width={70} />
      </TableCell>
    </TableRow>
  );
}
