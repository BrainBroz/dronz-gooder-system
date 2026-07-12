import React from "react";
import { Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { inventoryQueryKeys, logisticsQueryKeys } from "../queryKeys";
import { formatSalePrice } from "../utils/formatting";

export function InventoryPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const movementForm = useForm<{
    produtoId: string;
    tipo:
      | "RESERVE"
      | "RELEASE_RESERVATION"
      | "EXIT"
      | "ADJUSTMENT_POSITIVE"
      | "ADJUSTMENT_NEGATIVE"
      | "RETURN_ENTRY"
      | "RETURN_EXIT";
    quantidade: number;
    observacoes: string;
  }>({
    defaultValues: {
      produtoId: "",
      tipo: "RESERVE",
      quantidade: 1,
      observacoes: ""
    }
  });
  const receiptForm = useForm<{ viagemId: string; malaId: string }>({
    defaultValues: { viagemId: "", malaId: "" }
  });
  const stock = useQuery({
    queryKey: inventoryQueryKeys.stock(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/inventory", { headers })).data
  });
  const receiving = useQuery({
    queryKey: inventoryQueryKeys.receiving(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/receiving", { headers })).data
  });
  const trips = useQuery({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const bags = useQuery({
    queryKey: logisticsQueryKeys.suitcases(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/suitcases", { headers })).data
  });
  const refreshInventory = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: inventoryQueryKeys.stock(store) }),
      client.invalidateQueries({
        queryKey: inventoryQueryKeys.receiving(store)
      }),
      client.invalidateQueries({
        queryKey: inventoryQueryKeys.movements(store)
      })
    ]);
  const move = useMutation({
    mutationFn: (v: {
      produtoId: string;
      tipo: string;
      quantidade: number;
      observacoes: string;
    }) =>
      api.post(
        "/inventory/movements",
        {
          ...v,
          quantidade: Number(v.quantidade),
          motivo:
            v.tipo === "RESERVE"
              ? "RESERVATION"
              : v.tipo === "RELEASE_RESERVATION"
                ? "RESERVATION_RELEASE"
                : v.tipo === "EXIT"
                  ? "SALE"
                  : v.tipo.startsWith("RETURN")
                    ? "RETURN"
                    : "MANUAL_CORRECTION",
          observacoes: v.observacoes || undefined
        },
        { headers }
      ),
    onSuccess: async () => {
      movementForm.reset();
      await refreshInventory();
    }
  });
  const createReceipt = useMutation({
    mutationFn: (v: { viagemId: string; malaId: string }) =>
      api.post("/receiving", v, { headers }),
    onSuccess: async () => {
      receiptForm.reset();
      await refreshInventory();
    }
  });
  const confirmReceipt = useMutation({
    mutationFn: ({
      receiptId,
      itemId,
      quantity
    }: {
      receiptId: string;
      itemId: string;
      quantity: number;
    }) =>
      api.post(
        `/receiving/${receiptId}/items/${itemId}/confirm`,
        { quantidadeRecebida: quantity, quantidadeRejeitada: 0 },
        { headers }
      ),
    onSuccess: refreshInventory
  });
  React.useEffect(() => {
    movementForm.reset();
    receiptForm.reset();
    move.reset();
    createReceipt.reset();
    confirmReceipt.reset();
  }, [store, movementForm, receiptForm, move, createReceipt, confirmReceipt]);

  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Estoque e Recebimentos" />
        {stock.isLoading && <Typography>Carregando...</Typography>}
        {stock.isError && <Typography>Falha ao carregar dados</Typography>}
        <ContentCard title="Posição de estoque">
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={movementForm.handleSubmit((v) => move.mutate(v))}
          >
            <TextField
              select
              label="Produto"
              defaultValue=""
              {...movementForm.register("produtoId", { required: true })}
            >
              <MenuItem value="" disabled>
                Selecione
              </MenuItem>
              {stock.data?.map(
                (x: { produtoId: string; produto: { nome: string } }) => (
                  <MenuItem key={x.produtoId} value={x.produtoId}>
                    {x.produto.nome}
                  </MenuItem>
                )
              )}
            </TextField>
            <TextField
              select
              label="Movimento"
              defaultValue="RESERVE"
              {...movementForm.register("tipo")}
            >
              {[
                "RESERVE",
                "RELEASE_RESERVATION",
                "EXIT",
                "ADJUSTMENT_POSITIVE",
                "ADJUSTMENT_NEGATIVE",
                "RETURN_ENTRY",
                "RETURN_EXIT"
              ].map((x) => (
                <MenuItem key={x} value={x}>
                  {x}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="number"
              label="Quantidade"
              {...movementForm.register("quantidade", {
                valueAsNumber: true,
                min: 1
              })}
            />
            <TextField
              label="Observação"
              {...movementForm.register("observacoes")}
            />
            <Button type="submit" disabled={move.isPending}>
              Registrar movimento
            </Button>
          </Stack>
          <MutationStatus mutation={move} successMessage="Movimento registrado." />
          {stock.data?.map(
            (item: {
              id: string;
              quantidadeFisica: number;
              quantidadeReservada: number;
              produto: { nome: string; precoVenda: string; ativo: boolean };
            }) => {
              const disponivel = item.quantidadeFisica - item.quantidadeReservada;
              const semEstoque = disponivel === 0;
              return (
                <Card
                  key={item.id}
                  sx={{
                    opacity: semEstoque ? 0.38 : item.produto.ativo ? 1 : 0.65,
                    filter: semEstoque ? "grayscale(1)" : "none"
                  }}
                >
                  <CardContent>
                    <Typography>{item.produto.nome}</Typography>
                    <Typography>
                      Físico {item.quantidadeFisica} · Reservado{" "}
                      {item.quantidadeReservada} · Disponível {disponivel}
                    </Typography>
                    <Typography>
                      {formatSalePrice(item.produto.precoVenda)}
                    </Typography>
                    <Typography>
                      {semEstoque
                        ? "Sem estoque"
                        : item.produto.ativo
                          ? "Ativo"
                          : "Produto inativo"}
                    </Typography>
                  </CardContent>
                </Card>
              );
            }
          )}
        </ContentCard>
        <ContentCard title="Recebimentos">
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={receiptForm.handleSubmit((v) => createReceipt.mutate(v))}
          >
            <TextField
              select
              label="Viagem chegada"
              defaultValue=""
              {...receiptForm.register("viagemId", { required: true })}
            >
              <MenuItem value="" disabled>
                Selecione
              </MenuItem>
              {trips.data
                ?.filter((t: { status: string }) => t.status === "ARRIVED_BRAZIL")
                .map((t: { id: string; origem: string; destino: string }) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.origem} → {t.destino}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              select
              label="Mala"
              defaultValue=""
              {...receiptForm.register("malaId", { required: true })}
            >
              <MenuItem value="" disabled>
                Selecione
              </MenuItem>
              {bags.data
                ?.filter((b: { status: string }) =>
                  ["ARRIVED_BRAZIL", "RECEIVED"].includes(b.status)
                )
                .map((b: { id: string; codigo: string }) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.codigo}
                  </MenuItem>
                ))}
            </TextField>
            <Button type="submit" disabled={createReceipt.isPending}>
              Iniciar recebimento
            </Button>
          </Stack>
          <MutationStatus
            mutation={createReceipt}
            successMessage="Recebimento iniciado."
          />
          {receiving.data?.map(
            (item: {
              id: string;
              status: string;
              itens: {
                id: string;
                quantidadeEsperada: number;
                quantidadeRecebida: number;
                quantidadeRejeitada: number;
                produto: { nome: string };
              }[];
            }) => (
              <Card key={item.id}>
                <CardContent>
                  <Typography>{item.status}</Typography>
                  <Typography>{item.itens.length} item(ns)</Typography>
                  {item.itens.map((received) => {
                    const remaining =
                      received.quantidadeEsperada -
                      received.quantidadeRecebida -
                      received.quantidadeRejeitada;
                    return (
                      <Stack
                        key={received.id}
                        direction="row"
                        gap={1}
                        alignItems="center"
                      >
                        <Typography>
                          {received.produto.nome}: {received.quantidadeRecebida}/
                          {received.quantidadeEsperada}
                        </Typography>
                        {remaining > 0 && (
                          <Button
                            disabled={confirmReceipt.isPending}
                            onClick={() =>
                              confirmReceipt.mutate({
                                receiptId: item.id,
                                itemId: received.id,
                                quantity: remaining
                              })
                            }
                          >
                            Confirmar {remaining}
                          </Button>
                        )}
                      </Stack>
                    );
                  })}
                </CardContent>
              </Card>
            )
          )}
          <MutationStatus
            mutation={confirmReceipt}
            successMessage="Item confirmado."
          />
        </ContentCard>
      </Stack>
    </PageContainer>
  );
}
