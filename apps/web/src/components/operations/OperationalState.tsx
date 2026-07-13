import { Alert, Button, Skeleton, Stack, Typography } from "@mui/material";
import type { BlockedReason } from "../../types/operations";

export function OperationalLoading() {
  return <Stack aria-label="Carregando operação" gap={1}><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></Stack>;
}
export function OperationalError({ retry }: { retry: () => void }) {
  return <Alert severity="error" action={<Button onClick={retry}>Tentar novamente</Button>}>Não foi possível carregar esta etapa.</Alert>;
}
export function OperationalEmpty() {
  return <Typography color="text.secondary">Nenhum registro disponível nesta etapa.</Typography>;
}
export function BlockedReasons({ reasons }: { reasons: BlockedReason[] }) {
  if (!reasons.length) return null;
  return <Stack gap={0.5}>{reasons.map((reason) => <Alert key={reason.code} severity="warning">{reason.message}</Alert>)}</Stack>;
}
