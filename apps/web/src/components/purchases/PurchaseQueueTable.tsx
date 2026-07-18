import { Alert, Button, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";
import { PurchaseQueueRow } from "./PurchaseQueueRow";
import { PurchaseSkeletonRow } from "./PurchaseSkeletonRow";
import { EmptyQueueState } from "./EmptyQueueState";

export function PurchaseQueueTable({
  items,
  isLoading,
  isError,
  onRetry,
  hasActiveFilters,
  onClearFilters,
  onOpen
}: {
  items: UnifiedPurchaseListItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
}) {
  if (isError) {
    return (
      <Alert severity="error" action={<Button onClick={onRetry}>Tentar novamente</Button>}>
        Falha ao carregar a fila de compras.
      </Alert>
    );
  }
  if (!isLoading && items.length === 0) {
    return <EmptyQueueState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />;
  }
  return (
    <Table size="small" aria-label="Fila de compras">
      <TableHead>
        <TableRow>
          <TableCell aria-hidden />
          <TableCell>Referência</TableCell>
          <TableCell>Merchant</TableCell>
          <TableCell>Progresso</TableCell>
          <TableCell>Idade</TableCell>
          <TableCell align="right">Ação</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {isLoading
          ? Array.from({ length: 6 }).map((_, index) => <PurchaseSkeletonRow key={index} />)
          : items.map((item) => <PurchaseQueueRow key={item.id} item={item} onOpen={onOpen} />)}
      </TableBody>
    </Table>
  );
}
