import { useState } from "react";
import { Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader } from "../stores/auth";
import { MutationStatus } from "./ui/MutationStatus";

type Tracking = {
  id: string;
  codigo: string;
  transportadora: string | null;
  origem: string;
  ativo: boolean;
};

// Tracking é evidência de envio: não confirma recebimento nem cria estoque.
export function OrderTrackings({
  orderId,
  store,
  canManage
}: {
  orderId: string;
  store: string;
  canManage: boolean;
}) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const [form, setForm] = useState({
    codigo: "",
    transportadora: "",
    substitui: ""
  });
  const trackings = useQuery<Tracking[]>({
    queryKey: ["order-trackings", store, orderId],
    queryFn: async () =>
      (await api.get(`/purchase-orders/${orderId}/trackings`, { headers }))
        .data,
    retry: false
  });
  const add = useMutation({
    mutationFn: () =>
      api.post(
        `/purchase-orders/${orderId}/trackings`,
        {
          codigo: form.codigo,
          ...(form.transportadora.trim()
            ? { transportadora: form.transportadora.trim() }
            : {}),
          ...(form.substitui ? { substituiTrackingId: form.substitui } : {})
        },
        { headers }
      ),
    onSuccess: () => setForm({ codigo: "", transportadora: "", substitui: "" }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["order-trackings", store, orderId]
      })
  });
  if (trackings.isError) return null; // pedido sem compra de origem não tem tracking
  return (
    <Stack gap={0.5} mt={1}>
      {trackings.data?.map((tracking) => (
        <Stack key={tracking.id} direction="row" gap={1} alignItems="center">
          <Typography
            variant="body2"
            sx={{ textDecoration: tracking.ativo ? "none" : "line-through" }}
          >
            {tracking.transportadora ?? "—"} {tracking.codigo} ·{" "}
            {tracking.origem === "MANUAL" ? "manual" : "marketplace"}
          </Typography>
          {canManage && tracking.ativo && (
            <Button
              size="small"
              onClick={() =>
                setForm((current) => ({ ...current, substitui: tracking.id }))
              }
            >
              Corrigir
            </Button>
          )}
        </Stack>
      ))}
      {canManage && (
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            size="small"
            label={form.substitui ? "Código corrigido" : "Código de tracking"}
            value={form.codigo}
            onChange={(event) =>
              setForm((current) => ({ ...current, codigo: event.target.value }))
            }
          />
          <TextField
            size="small"
            label="Transportadora"
            value={form.transportadora}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                transportadora: event.target.value
              }))
            }
          />
          <Button
            size="small"
            disabled={add.isPending || form.codigo.trim().length < 4}
            onClick={() => add.mutate()}
          >
            {form.substitui ? "Substituir tracking" : "Adicionar tracking"}
          </Button>
        </Stack>
      )}
      <MutationStatus mutation={add} successMessage="Tracking registrado." />
    </Stack>
  );
}
