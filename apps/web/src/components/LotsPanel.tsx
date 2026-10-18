import React from "react";
import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "./ui/ContentCard";
import { MutationStatus } from "./ui/MutationStatus";

// PD-03: diagnóstico de lotes. Reconciliar e ligar custo são ações explícitas com motivo.
type Diagnosis = {
  estoqueFisico: number;
  saldoLotes: number;
  reconciliado: boolean;
  lotes: {
    movimentoEntradaId: string;
    tipo: string;
    entradaEm: string;
    quantidade: number;
    restante: number;
    custoConhecido: boolean;
  }[];
  saidasSemLote: {
    id: string;
    tipo: string;
    motivo: string;
    createdAt: string;
    pendente: number;
  }[];
};

export function LotsPanel({
  products
}: {
  products: { produtoId: string; nome: string }[];
}) {
  const store = useAuthStore((s) => s.activeStoreId);
  const permissions = useAuthStore((s) => s.permissions);
  const canAdjust =
    permissions.includes("ESTOQUE_AJUSTAR") ||
    permissions.includes("SYSTEM_ADMIN");
  const headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const [produtoId, setProdutoId] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [link, setLink] = React.useState({
    movimentoEntradaId: "",
    pedidoCompraItemId: ""
  });
  const diagnosis = useQuery<Diagnosis>({
    queryKey: ["inventory-lots", store, produtoId],
    enabled: !!store && !!produtoId,
    queryFn: async () =>
      (await api.get(`/inventory/lots/${produtoId}`, { headers })).data
  });
  const refresh = () =>
    client.invalidateQueries({
      queryKey: ["inventory-lots", store, produtoId]
    });
  const write = (url: string, body: object) =>
    api.post(url, body, {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() }
    });
  const reconcile = useMutation({
    mutationFn: () =>
      write(`/inventory/lots/${produtoId}/reconcile`, { motivo }),
    onSuccess: async () => {
      setMotivo("");
      await refresh();
    }
  });
  const linkLot = useMutation({
    mutationFn: () =>
      write(
        `/inventory/lots/entries/${link.movimentoEntradaId}/purchase-item`,
        {
          pedidoCompraItemId: link.pedidoCompraItemId,
          motivo
        }
      ),
    onSuccess: async () => {
      setLink({ movimentoEntradaId: "", pedidoCompraItemId: "" });
      await refresh();
    }
  });
  const d = diagnosis.data;
  return (
    <ContentCard title="Lotes do estoque">
      <TextField
        select
        label="Produto"
        value={produtoId}
        onChange={(e) => setProdutoId(e.target.value)}
      >
        {products.map((p) => (
          <MenuItem key={p.produtoId} value={p.produtoId}>
            {p.nome}
          </MenuItem>
        ))}
      </TextField>
      {diagnosis.isError && (
        <Typography role="alert">Falha ao carregar os lotes.</Typography>
      )}
      {d && (
        <Stack gap={1}>
          <Typography>
            Físico {d.estoqueFisico} · Saldo dos lotes {d.saldoLotes} ·{" "}
            {d.reconciliado
              ? "reconciliado"
              : "precisa de reconciliação (vendas bloqueadas)"}
          </Typography>
          {d.lotes.map((lot) => (
            <Typography key={lot.movimentoEntradaId} variant="body2">
              {lot.tipo} de {lot.entradaEm.slice(0, 10)} · {lot.restante}/
              {lot.quantidade} un.
              {lot.custoConhecido ? "" : " · sem custo de compra"}
            </Typography>
          ))}
          {d.saidasSemLote.map((out) => (
            <Typography key={out.id} variant="body2" color="warning.main">
              Saída sem lote: {out.tipo}/{out.motivo} de{" "}
              {out.createdAt.slice(0, 10)} · {out.pendente} un.
            </Typography>
          ))}
          {canAdjust && (
            <>
              <TextField
                label="Motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <Stack direction={{ xs: "column", md: "row" }} gap={1}>
                <Button
                  disabled={
                    !d.saidasSemLote.length ||
                    motivo.trim().length < 3 ||
                    reconcile.isPending
                  }
                  onClick={() => reconcile.mutate()}
                >
                  Reconciliar saídas com os lotes mais antigos
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} gap={1}>
                <TextField
                  select
                  size="small"
                  label="Lote sem custo"
                  value={link.movimentoEntradaId}
                  onChange={(e) =>
                    setLink({ ...link, movimentoEntradaId: e.target.value })
                  }
                  sx={{ minWidth: 200 }}
                >
                  {d.lotes
                    .filter((lot) => !lot.custoConhecido)
                    .map((lot) => (
                      <MenuItem
                        key={lot.movimentoEntradaId}
                        value={lot.movimentoEntradaId}
                      >
                        {lot.tipo} de {lot.entradaEm.slice(0, 10)}
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  size="small"
                  label="ID do item de compra"
                  value={link.pedidoCompraItemId}
                  onChange={(e) =>
                    setLink({ ...link, pedidoCompraItemId: e.target.value })
                  }
                />
                <Button
                  disabled={
                    !link.movimentoEntradaId ||
                    !link.pedidoCompraItemId ||
                    motivo.trim().length < 3 ||
                    linkLot.isPending
                  }
                  onClick={() => linkLot.mutate()}
                >
                  Ligar lote ao item
                </Button>
              </Stack>
            </>
          )}
          <MutationStatus
            mutation={reconcile}
            successMessage="Lotes reconciliados."
          />
          <MutationStatus
            mutation={linkLot}
            successMessage="Lote ligado ao item de compra."
          />
        </Stack>
      )}
    </ContentCard>
  );
}
