import { MenuItem, Stack, TextField } from "@mui/material";
import type { PurchaseProvider, UnifiedPurchaseFilters } from "../../types/unified-purchases";

const providers: PurchaseProvider[] = [
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA",
  "MANUAL"
];
const states = ["IMPORTADA", "EM_REVISAO", "CANCELADA", "COM_DIVERGENCIA"] as const;

export function PurchaseQueueFilters({
  filters,
  onChange
}: {
  filters: UnifiedPurchaseFilters;
  onChange: <K extends keyof UnifiedPurchaseFilters>(
    key: K,
    value: UnifiedPurchaseFilters[K]
  ) => void;
}) {
  return (
    <Stack direction={{ xs: "column", md: "row" }} gap={1.5} flexWrap="wrap">
      <TextField
        label="Buscar referência"
        placeholder="Referência, pedido..."
        value={filters.referencia ?? ""}
        onChange={(event) => onChange("referencia", event.target.value)}
        sx={{ minWidth: 220 }}
      />
      <TextField
        select
        label="Estado"
        value={filters.estado ?? ""}
        onChange={(event) =>
          onChange("estado", event.target.value as UnifiedPurchaseFilters["estado"])
        }
        sx={{ minWidth: 170 }}
      >
        <MenuItem value="">Todos</MenuItem>
        {states.map((state) => (
          <MenuItem key={state} value={state}>
            {state}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Fonte"
        value={filters.plataforma ?? ""}
        onChange={(event) => onChange("plataforma", event.target.value as PurchaseProvider)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="">Todas</MenuItem>
        {providers.map((provider) => (
          <MenuItem key={provider} value={provider}>
            {provider}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        type="date"
        label="De"
        slotProps={{ inputLabel: { shrink: true } }}
        value={filters.from ?? ""}
        onChange={(event) => onChange("from", event.target.value)}
      />
      <TextField
        type="date"
        label="Até"
        slotProps={{ inputLabel: { shrink: true } }}
        value={filters.to ?? ""}
        onChange={(event) => onChange("to", event.target.value)}
      />
    </Stack>
  );
}
