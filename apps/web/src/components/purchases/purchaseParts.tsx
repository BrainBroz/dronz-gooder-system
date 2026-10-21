import { useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import { storeColor, storeTextColor } from "../../theme";

export type Phase =
  | "CANCELADO"
  | "COMPRADO"
  | "A_CAMINHO_MIAMI"
  | "EM_MIAMI"
  | "EM_REMESSA"
  | "NO_BRASIL";
/** Último status de entrega de um rastreio (Parcel): 0 entregue, 2 em trânsito, 4 saiu para entrega, 7 exceção etc. */
export type Delivery = {
  status: number;
  rotulo: string;
  evento: string | null;
  local: string | null;
  data: string | null;
  consultadoEm: string;
};
export type StoreRef = { id: string; slug: string; nome: string };
export type PurchaseRow = {
  candidateId: string;
  version: number;
  status:
    | "AGUARDANDO_APROVACAO"
    | "COM_DIVERGENCIA"
    | "APROVADA"
    | "REJEITADA"
    | "CANCELADA";
  fase: Phase;
  orderId: string;
  orderedAt: string;
  currency: string;
  cancelled: boolean;
  account: string;
  purpose: "LOJA" | "PESSOAL";
  store: StoreRef | null;
  shippedAt: string | null;
  etapa: {
    chegouMiamiEm: string | null;
    remessa: string | null;
    enviadaEm: string | null;
    chegouBrasilEm: string | null;
  } | null;
  trackings: {
    carrier: string | null;
    code: string;
    entrega: Delivery | null;
  }[];
  /** Todos os rastreios da compra constam como entregues no Parcel. */
  entregue: boolean;
  /** Compra cadastrada à mão: o rastreio dela é editado aqui. */
  manual: boolean;
  canEditTracking: boolean;
  items: {
    title: string;
    quantity: number;
    cancelledQuantity: number;
    unitPrice: number;
    currency: string;
    imageUrl: string | null;
  }[];
  canApprove: boolean;
  canChangeStore: boolean;
};
export type Feed = {
  items: PurchaseRow[];
  total: number;
  atualizadoEm: string | null;
};
export const money = (value: number, currency = "USD") =>
  value.toLocaleString("pt-BR", { style: "currency", currency });
export const day = (value: string) =>
  new Date(value).toLocaleDateString("pt-BR");
/**
 * Fase da compra: cancelada; comprada (o vendedor ainda não enviou); a caminho de Miami (o vendedor enviou, com rastreio);
 * e, depois da confirmação da equipe, em Miami, a caminho do Brasil (em remessa) e no estoque do Brasil.
 */
export const phaseInfo: Record<
  Phase,
  {
    label: string;
    color: "error" | "warning" | "info" | "primary" | "secondary" | "success";
  }
> = {
  CANCELADO: { label: "Cancelado", color: "error" },
  COMPRADO: { label: "Comprado", color: "warning" },
  A_CAMINHO_MIAMI: { label: "A caminho de Miami", color: "info" },
  EM_MIAMI: { label: "Em Miami", color: "primary" },
  EM_REMESSA: { label: "A caminho do Brasil", color: "secondary" },
  NO_BRASIL: { label: "Estoque Brasil", color: "success" }
};

export const ago = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60_000)
  );
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  return minutes < 1440
    ? `há ${Math.round(minutes / 60)} h`
    : `há ${Math.round(minutes / 1440)} dias`;
};
export function CopyTracking({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sem permissão da área de transferência: o código continua visível para copiar à mão
    }
  };
  return (
    <Tooltip title={copied ? "Copiado!" : "Copiar rastreio"}>
      <Button
        size="small"
        variant="outlined"
        color={copied ? "success" : "inherit"}
        onClick={() => void copy()}
        aria-label={`Copiar rastreio ${code}`}
        sx={{ minWidth: 0, px: 0.75, py: 0.1, fontSize: 11 }}
      >
        {copied ? "✓" : "Copiar"}
      </Button>
    </Tooltip>
  );
}

const deliveryColor: Record<
  number,
  "success" | "info" | "warning" | "error" | "default"
> = {
  0: "success",
  2: "info",
  3: "warning",
  4: "info",
  6: "warning",
  7: "error",
  8: "info"
};

/** Situação da entrega vinda do Parcel; o evento mais recente aparece ao passar o mouse. */
function DeliveryChip({ entrega }: { entrega: Delivery }) {
  const detail = [entrega.evento, entrega.local, entrega.data]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip title={detail || entrega.rotulo}>
      <Chip
        size="small"
        variant="outlined"
        color={deliveryColor[entrega.status] ?? "default"}
        label={entrega.rotulo}
        sx={{ fontSize: 10, height: 20 }}
      />
    </Tooltip>
  );
}

export function TrackingCell({
  row,
  onEdit
}: {
  row: PurchaseRow;
  onEdit?: (row: PurchaseRow) => void;
}) {
  const edit = onEdit && row.canEditTracking && !row.cancelled && (
    <Button
      size="small"
      variant="text"
      onClick={() => onEdit(row)}
      sx={{ alignSelf: "flex-start", minWidth: 0, px: 0.5, fontSize: 11 }}
    >
      {row.trackings.length ? "Editar rastreio" : "Adicionar rastreio"}
    </Button>
  );
  if (!row.trackings.length)
    return (
      <Stack gap={0.25}>
        <Typography variant="body2" color="text.secondary">
          {row.cancelled
            ? "—"
            : row.manual
              ? "Sem rastreio ainda"
              : "Vendedor ainda não enviou"}
        </Typography>
        {edit}
      </Stack>
    );
  return (
    <Stack gap={0.5}>
      {row.trackings.map((tracking) => (
        <Stack
          key={`${tracking.carrier}-${tracking.code}`}
          direction="row"
          gap={0.75}
          alignItems="center"
        >
          {tracking.carrier && (
            <Chip
              size="small"
              label={tracking.carrier.toUpperCase()}
              sx={{
                fontWeight: 700,
                fontSize: 10,
                height: 20,
                bgcolor: "action.selected"
              }}
            />
          )}
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", fontSize: 12 }}
          >
            {tracking.code}
          </Typography>
          <CopyTracking code={tracking.code} />
          {tracking.entrega && <DeliveryChip entrega={tracking.entrega} />}
        </Stack>
      ))}
      {edit}
    </Stack>
  );
}

/** Produto de uma linha: foto pequena, título e, abaixo, a data do pedido e o número dele. */
export function ProductCell({
  row,
  item
}: {
  row: PurchaseRow;
  item: PurchaseRow["items"][number];
}) {
  return (
    <Stack direction="row" gap={1.25} alignItems="center">
      <Avatar
        variant="rounded"
        src={item.imageUrl ?? undefined}
        alt=""
        sx={{ width: 44, height: 44, bgcolor: "action.hover" }}
      >
        <Box component="span" sx={{ fontSize: 9, color: "text.secondary" }}>
          sem foto
        </Box>
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {item.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {day(row.orderedAt)} · pedido {row.orderId}
          {row.purpose === "PESSOAL" ? " · pessoal" : ""}
        </Typography>
      </Box>
    </Stack>
  );
}

/** Empresa (loja) da compra, só para ler: etiqueta com a cor da loja. */
export function StoreTag({ row }: { row: PurchaseRow }) {
  if (row.cancelled && !row.store)
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  return row.store ? (
    <Chip
      size="small"
      variant="outlined"
      label={row.store.nome.toUpperCase()}
      sx={{
        color: storeTextColor(row.store.slug),
        borderColor: storeColor(row.store.slug),
        fontWeight: 700,
        fontSize: 11
      }}
    />
  ) : (
    <Chip size="small" variant="outlined" label="SEM LOJA" />
  );
}
