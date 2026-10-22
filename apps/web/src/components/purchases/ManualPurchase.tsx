import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { authHeader, useAuthStore } from "../../stores/auth";
import { extractErrorMessage } from "../../utils/errors";
import type { PurchaseRow } from "./purchaseParts";

const BASE = "/integrations/marketplaces";
const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "Outra"];
const today = () => new Date().toLocaleDateString("sv-SE");
const blankItem = () => ({ titulo: "", quantidade: "1", preco: "", foto: "" });

const useRefreshPurchases = () => {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["purchases-feed"] }),
      client.invalidateQueries({ queryKey: ["purchase-lots"] })
    ]);
};

/** Compra feita fora do eBay (Shop.com, Amazon, loja…): entra confirmada e já aparece nos lotes, no Estoque e no rastreio. */
export function ManualPurchaseDrawer({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (pedido: string) => void;
}) {
  const stores = useAuthStore((s) => s.stores);
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const refresh = useRefreshPurchases();
  const [lojaId, setLojaId] = useState(activeStoreId ?? stores[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [vendedor, setVendedor] = useState("");
  const [referencia, setReferencia] = useState("");
  const [items, setItems] = useState([blankItem()]);
  const [codigo, setCodigo] = useState("");
  const [transportadora, setTransportadora] = useState("");
  // Uma chave por tentativa: apertar duas vezes não cadastra duas compras.
  const key = useRef(crypto.randomUUID());

  const parsed = items.map((item) => ({
    titulo: item.titulo.trim(),
    quantidade: Number(item.quantidade),
    precoUnitario: Number(item.preco.replace(",", ".")),
    fotoUrl: item.foto.trim()
  }));
  const valid =
    Boolean(lojaId && date) &&
    items.every((item, index) => {
      const entry = parsed[index]!;
      return (
        entry.titulo !== "" &&
        Number.isInteger(entry.quantidade) &&
        entry.quantidade >= 1 &&
        item.preco.trim() !== "" &&
        Number.isFinite(entry.precoUnitario) &&
        entry.precoUnitario >= 0
      );
    });

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          `${BASE}/purchases/manual`,
          {
            lojaId,
            dataPedido: date,
            ...(vendedor.trim() ? { vendedor: vendedor.trim() } : {}),
            ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
            itens: parsed.map((item) => ({
              titulo: item.titulo,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              ...(item.fotoUrl ? { fotoUrl: item.fotoUrl } : {})
            })),
            ...(codigo.trim()
              ? {
                  rastreio: {
                    codigo: codigo.trim(),
                    ...(transportadora ? { transportadora } : {})
                  }
                }
              : {})
          },
          { headers: { ...authHeader(), "idempotency-key": key.current } }
        )
      ).data as { numeroPedido: string },
    onSuccess: async (data) => {
      key.current = crypto.randomUUID();
      setItems([blankItem()]);
      setCodigo("");
      setTransportadora("");
      setVendedor("");
      setReferencia("");
      await refresh();
      onCreated(data.numeroPedido);
      onClose();
    }
  });
  const setItem = (
    index: number,
    field: keyof ReturnType<typeof blankItem>,
    value: string
  ) =>
    setItems((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={create.isPending ? undefined : onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, p: 3 } } }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        mb={2}
      >
        <Box>
          <Typography variant="h6">Cadastrar compra</Typography>
          <Typography variant="body2" color="text.secondary">
            Para compras fora do eBay. Entra já confirmada.
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          aria-label="Fechar"
          disabled={create.isPending}
        >
          ✕
        </IconButton>
      </Stack>
      <Stack gap={2}>
        {create.isError && (
          <Alert severity="error">{extractErrorMessage(create.error)}</Alert>
        )}
        <Stack direction="row" gap={1.5}>
          <TextField
            select
            size="small"
            label="Loja"
            value={lojaId}
            onChange={(event) => setLojaId(event.target.value)}
            sx={{ flex: 1 }}
          >
            {stores.map((store) => (
              <MenuItem key={store.id} value={store.id}>
                {store.nome}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Data da compra"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ flex: 1 }}
          />
        </Stack>
        <Stack direction="row" gap={1.5}>
          <TextField
            size="small"
            label="Vendedor ou site"
            value={vendedor}
            onChange={(event) => setVendedor(event.target.value)}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="Nº do pedido (opcional)"
            value={referencia}
            onChange={(event) => setReferencia(event.target.value)}
            sx={{ flex: 1 }}
          />
        </Stack>
        {items.map((item, index) => (
          <Stack
            key={index}
            gap={1.25}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="subtitle2">Item {index + 1}</Typography>
              {items.length > 1 && (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() =>
                    setItems((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remover item {index + 1}
                </Button>
              )}
            </Stack>
            <TextField
              size="small"
              label={`Produto ${index + 1}`}
              value={item.titulo}
              onChange={(event) => setItem(index, "titulo", event.target.value)}
            />
            <Stack direction="row" gap={1.5}>
              <TextField
                size="small"
                type="number"
                label={`Quantidade ${index + 1}`}
                value={item.quantidade}
                onChange={(event) =>
                  setItem(index, "quantidade", event.target.value)
                }
                slotProps={{ htmlInput: { min: 1 } }}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label={`Preço unitário (US$) ${index + 1}`}
                value={item.preco}
                onChange={(event) =>
                  setItem(index, "preco", event.target.value)
                }
                inputMode="decimal"
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              size="small"
              label={`Link da foto ${index + 1} (opcional)`}
              value={item.foto}
              onChange={(event) => setItem(index, "foto", event.target.value)}
            />
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => setItems((current) => [...current, blankItem()])}
        >
          + Adicionar outro item
        </Button>
        <Stack direction="row" gap={1.5}>
          <TextField
            size="small"
            label="Rastreio (opcional)"
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
            sx={{ flex: 2 }}
          />
          <TextField
            select
            size="small"
            label="Transportadora"
            value={transportadora}
            onChange={(event) => setTransportadora(event.target.value)}
            sx={{ flex: 1 }}
          >
            <MenuItem value="">—</MenuItem>
            {CARRIERS.map((carrier) => (
              <MenuItem key={carrier} value={carrier}>
                {carrier}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Cadastrando…" : "Cadastrar compra"}
        </Button>
      </Stack>
    </Drawer>
  );
}

/** Inclui, troca ou tira o rastreio de uma compra cadastrada à mão. */
export function TrackingEditDialog({
  row,
  onClose
}: {
  row: PurchaseRow | null;
  onClose: () => void;
}) {
  const refresh = useRefreshPurchases();
  const current = row?.trackings[0];
  const [codigo, setCodigo] = useState(current?.code ?? "");
  const [transportadora, setTransportadora] = useState(current?.carrier ?? "");
  const save = useMutation({
    mutationFn: async (
      rastreio: { codigo: string; transportadora?: string } | null
    ) =>
      (
        await api.put(
          `${BASE}/purchases/${row!.candidateId}/tracking`,
          { rastreio },
          { headers: authHeader() }
        )
      ).data,
    onSuccess: async () => {
      await refresh();
      onClose();
    }
  });
  return (
    <Dialog
      open={Boolean(row)}
      onClose={save.isPending ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>Rastreio do pedido {row?.orderId}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          {save.isError && (
            <Alert severity="error">{extractErrorMessage(save.error)}</Alert>
          )}
          <TextField
            size="small"
            autoFocus
            label="Código de rastreio"
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
          />
          <TextField
            select
            size="small"
            label="Transportadora"
            value={transportadora}
            onChange={(event) => setTransportadora(event.target.value)}
          >
            <MenuItem value="">—</MenuItem>
            {CARRIERS.map((carrier) => (
              <MenuItem key={carrier} value={carrier}>
                {carrier}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        {current && (
          <Button
            color="inherit"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Remover rastreio
          </Button>
        )}
        <Button disabled={save.isPending} onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={save.isPending || codigo.trim().length < 3}
          onClick={() =>
            save.mutate({
              codigo: codigo.trim(),
              ...(transportadora ? { transportadora } : {})
            })
          }
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
