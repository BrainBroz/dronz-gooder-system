import { Box, Divider, Stack, Typography } from "@mui/material";
import type { History } from "../../types/operations";

export function OperationsTimeline({ history }: { history?: History }) {
  if (!history?.items.length) return <Typography color="text.secondary">Nenhum evento registrado.</Typography>;
  return <Stack divider={<Divider flexItem />} gap={1} aria-label="Histórico operacional">
    {history.items.map((item) => <Box key={item.id}>
      <Typography fontWeight={700}>{item.action}</Typography>
      <Typography variant="caption">{new Date(item.createdAt).toLocaleString("pt-BR")} · {item.usuarioId ?? "Sistema"}</Typography>
      {item.reason && <Typography variant="body2">Motivo: {item.reason}</Typography>}
      {item.beforeData !== null && <Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap" }}>Antes: {JSON.stringify(item.beforeData, null, 2)}</Typography>}
      {item.afterData !== null && <Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap" }}>Depois: {JSON.stringify(item.afterData, null, 2)}</Typography>}
    </Box>)}
  </Stack>;
}
