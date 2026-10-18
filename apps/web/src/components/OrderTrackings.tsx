import { useState } from "react";
import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
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
  pacote?: string;
  pacoteId?: string;
  destino?: { id: string; nome: string; origem: "PACOTE" | "PEDIDO" } | null;
  pacoteItens?: { pedidoCompraItemId: string; quantidade: number }[];
};

// PD-04: conteúdo declarado do pacote; sem ele, "a caminho" segue o destino do pedido.
function PackageContents({
  orderId,
  store,
  pacoteId,
  current
}: {
  orderId: string;
  store: string;
  pacoteId: string;
  current: { pedidoCompraItemId: string; quantidade: number }[];
}) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const order = useQuery<{
    itens: { id: string; quantidade: number; produto?: { nome: string } }[];
  }>({
    queryKey: ["purchase-order", store, orderId],
    queryFn: async () =>
      (await api.get(`/purchase-orders/${orderId}`, { headers })).data
  });
  const [form, setForm] = useState({
    pedidoCompraItemId: "",
    quantidade: "",
    motivo: ""
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/purchase-orders/${orderId}/packages/${pacoteId}/items`,
        {
          itens: [
            ...current.filter(
              (c) => c.pedidoCompraItemId !== form.pedidoCompraItemId
            ),
            {
              pedidoCompraItemId: form.pedidoCompraItemId,
              quantidade: Number(form.quantidade)
            }
          ],
          motivo: form.motivo
        },
        { headers }
      ),
    onSuccess: () =>
      setForm({ pedidoCompraItemId: "", quantidade: "", motivo: "" }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["order-trackings", store, orderId]
      })
  });
  const names = new Map(
    (order.data?.itens ?? []).map((item, index) => [
      item.id,
      item.produto?.nome ?? `Item ${index + 1}`
    ])
  );
  return (
    <Stack direction={{ xs: "column", md: "row" }} gap={1} alignItems="center">
      <Typography variant="body2">
        Conteúdo:{" "}
        {current.length
          ? current
              .map(
                (c) =>
                  `${c.quantidade}× ${names.get(c.pedidoCompraItemId) ?? "item"}`
              )
              .join(", ")
          : "não declarado"}
      </Typography>
      <TextField
        select
        size="small"
        label="Item no pacote"
        value={form.pedidoCompraItemId}
        onChange={(e) =>
          setForm({ ...form, pedidoCompraItemId: e.target.value })
        }
        sx={{ minWidth: 160 }}
      >
        {(order.data?.itens ?? []).map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {names.get(item.id)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        type="number"
        inputProps={{ min: 1 }}
        label="Unidades"
        value={form.quantidade}
        onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
      />
      <TextField
        size="small"
        label="Motivo do conteúdo"
        value={form.motivo}
        onChange={(e) => setForm({ ...form, motivo: e.target.value })}
      />
      <Button
        size="small"
        disabled={
          !form.pedidoCompraItemId ||
          !form.quantidade ||
          form.motivo.trim().length < 3 ||
          save.isPending
        }
        onClick={() => save.mutate()}
      >
        Salvar conteúdo
      </Button>
      <MutationStatus
        mutation={save}
        successMessage="Conteúdo do pacote salvo."
      />
    </Stack>
  );
}

// D-15: destino por pacote; sem escolha própria, o pacote segue o destino do pedido.
function PackageDestination({
  orderId,
  store,
  pacoteId,
  label,
  destino
}: {
  orderId: string;
  store: string;
  pacoteId: string;
  label: string;
  destino: Tracking["destino"];
}) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const [form, setForm] = useState({ posicaoId: "", motivo: "" });
  const positions = useQuery<{ id: string; nome: string; status: string }[]>({
    queryKey: ["positions"],
    queryFn: async () => (await api.get("/positions", { headers })).data
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/purchase-orders/${orderId}/packages/${pacoteId}/destination`,
        {
          posicaoId: form.posicaoId === "PEDIDO" ? null : form.posicaoId,
          motivo: form.motivo
        },
        { headers }
      ),
    onSuccess: () => setForm({ posicaoId: "", motivo: "" }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["order-trackings", store, orderId]
      })
  });
  return (
    <Stack direction={{ xs: "column", md: "row" }} gap={1} alignItems="center">
      <Typography variant="body2">
        Pacote {label} → {destino?.nome ?? "sem destino"}
        {destino
          ? destino.origem === "PEDIDO"
            ? " (padrão do pedido)"
            : " (definido no pacote)"
          : ""}
      </Typography>
      <TextField
        select
        size="small"
        label="Novo destino"
        value={form.posicaoId}
        onChange={(e) => setForm({ ...form, posicaoId: e.target.value })}
        sx={{ minWidth: 180 }}
      >
        <MenuItem value="PEDIDO">Usar destino do pedido</MenuItem>
        {(positions.data ?? [])
          .filter((p) => p.status !== "ENCERRADA" && p.status !== "CANCELADA")
          .map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.nome}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        size="small"
        label="Motivo"
        value={form.motivo}
        onChange={(e) => setForm({ ...form, motivo: e.target.value })}
      />
      <Button
        size="small"
        disabled={
          !form.posicaoId || form.motivo.trim().length < 3 || save.isPending
        }
        onClick={() => save.mutate()}
      >
        Alterar destino
      </Button>
      <MutationStatus
        mutation={save}
        successMessage="Destino do pacote atualizado."
      />
    </Stack>
  );
}

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
  const packages = [
    ...new Map(
      (trackings.data ?? [])
        .filter((t) => t.pacoteId)
        .map((t) => [t.pacoteId!, t] as const)
    ).values()
  ];
  return (
    <Stack gap={0.5} mt={1}>
      {packages.map((t) =>
        canManage ? (
          <Stack key={t.pacoteId} gap={0.5}>
            <PackageDestination
              orderId={orderId}
              store={store}
              pacoteId={t.pacoteId!}
              label={t.pacote ?? t.pacoteId!}
              destino={t.destino ?? null}
            />
            <PackageContents
              orderId={orderId}
              store={store}
              pacoteId={t.pacoteId!}
              current={t.pacoteItens ?? []}
            />
          </Stack>
        ) : (
          <Typography key={t.pacoteId} variant="body2">
            Pacote {t.pacote} → {t.destino?.nome ?? "sem destino"}
          </Typography>
        )
      )}
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
