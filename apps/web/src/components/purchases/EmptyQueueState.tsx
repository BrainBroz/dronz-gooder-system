import { Button, Stack, Typography } from "@mui/material";

export function EmptyQueueState({
  hasActiveFilters,
  onClearFilters
}: {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  return (
    <Stack alignItems="center" gap={1} py={6}>
      <Typography fontWeight={700} fontSize="1.1rem">
        {hasActiveFilters ? "Nenhuma compra encontrada" : "Nenhuma compra aguardando revisão ✓"}
      </Typography>
      <Typography color="text.secondary">
        {hasActiveFilters
          ? "Ajuste os filtros para ver mais resultados."
          : "Quando novas compras chegarem, elas aparecerão aqui."}
      </Typography>
      {hasActiveFilters && <Button onClick={onClearFilters}>Limpar filtros</Button>}
    </Stack>
  );
}
