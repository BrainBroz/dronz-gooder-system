import { Button, Card, CardActions, CardContent, Chip, Stack, Typography } from "@mui/material";
import type { BlockedReason } from "../../types/operations";
import { BlockedReasons } from "./OperationalState";

export function OperationCard(props: {
  title: string;
  subtitle: string;
  status: string;
  blockedReasons: BlockedReason[];
  onDetail: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
}) {
  return <Card variant="outlined"><CardContent>
    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1}>
      <div><Typography fontWeight={700}>{props.title}</Typography><Typography color="text.secondary">{props.subtitle}</Typography></div>
      <Chip label={props.status} size="small" />
    </Stack>
    <BlockedReasons reasons={props.blockedReasons} />
  </CardContent><CardActions>
    <Button onClick={props.onDetail}>Ver detalhes</Button>
    {props.onAction && <Button variant="contained" disabled={props.actionDisabled} onClick={props.onAction}>{props.actionLabel}</Button>}
  </CardActions></Card>;
}
