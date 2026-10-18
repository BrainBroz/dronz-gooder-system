import React, { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { logisticsQueryKeys, purchasingQueryKeys } from "../queryKeys";
import { operationsKeys } from "../hooks/useOperations";
import type { Supplier, PurchaseOrder } from "../types/purchasing";
import { useProducts } from "../hooks/useCatalog";

function PurchaseOrdersContent() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedAction, setSelectedAction] = useState<{ id: string; number: string; status: "PLACED" | "CONFIRMED" } | null>(null);
  const { products } = useProducts();
  const suppliers = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data.items
  });
  const orders = useQuery<PurchaseOrder[]>({
    queryKey: [...purchasingQueryKeys.orders(store), page],
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/purchase-orders", {
          headers: { ...authHeader(), "x-store-id": store },
          params: { page, limit: 20 }
        })
      ).data.items
  });
  const form = useForm({
    resolver: zodResolver(
      z.object({
        numeroPedido: z.string().min(1),
        fornecedorId: z.string().min(1),
        produtoId: z.string().min(1),
        quantidade: z.coerce.number().int().positive(),
        precoUnitario: z.coerce.number().min(0),
        descontoItem: z.coerce.number().min(0)
      })
    ),
    defaultValues: {
      numeroPedido: "",
      fornecedorId: "",
      produtoId: "",
      quantidade: 1,
      precoUnitario: 0,
      descontoItem: 0
    }
  });
  const createOrder = useMutation({
    mutationFn: (v: {
      numeroPedido: string;
      fornecedorId: string;
      produtoId: string;
      quantidade: number;
      precoUnitario: number;
      descontoItem: number;
    }) =>
      api.post(
        "/purchase-orders",
        {
          fornecedorId: v.fornecedorId,
          numeroPedido: v.numeroPedido,
          dataCompra: new Date().toISOString(),
          moeda: "USD",
          descontoPedido: 0,
          frete: 0,
          imposto: 0,
          itens: [
            {
              produtoId: v.produtoId,
              quantidade: v.quantidade,
              precoUnitario: v.precoUnitario,
              descontoItem: v.descontoItem
            }
          ]
        },
        { headers: { ...authHeader(), "x-store-id": store } }
      ),
    onSuccess: async () => {
      setPage(1);
      await client.invalidateQueries({
        queryKey: purchasingQueryKeys.orders(store)
      });
      form.reset();
    }
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "PLACED" | "CONFIRMED" }) =>
      api.patch(`/purchase-orders/${id}/status`, { status }, { headers: { ...authHeader(), "x-store-id": store } }),
    onSuccess: async () => {
      setSelectedAction(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: purchasingQueryKeys.orders(store) }),
        client.invalidateQueries({ queryKey: operationsKeys.all(store) })
      ]);
    },
    onError: async () => {
      await client.invalidateQueries({ queryKey: purchasingQueryKeys.orders(store) });
    }
  });
  const positions = useQuery<{ id: string; nome: string; status: string }[]>({
    queryKey: logisticsQueryKeys.positions(),
    queryFn: async () => (await api.get("/positions", { headers: authHeader() })).data
  });
  // D-15: destino padrão do pedido; a API recusa a troca depois do primeiro recebimento.
  const changeDestination = useMutation({
    mutationFn: ({ id, posicaoId }: { id: string; posicaoId: string }) =>
      api.put(`/purchase-orders/${id}/destination`, { posicaoId }, { headers: { ...authHeader(), "x-store-id": store } }),
    onSettled: () => client.invalidateQueries({ queryKey: purchasingQueryKeys.orders(store) })
  });
  const actionAvailable = Boolean(selectedAction && orders.data?.some((order) =>
    order.id === selectedAction.id && order.allowedStatusTransitions.includes(selectedAction.status)
  ));
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Pedidos Operacionais"
          description="Pedidos materializados e pedidos diretos da loja ativa"
        />
        <ContentCard>
          <form onSubmit={form.handleSubmit((v) => createOrder.mutateAsync(v))}>
            <Stack direction="row" gap={1} flexWrap="wrap">
              <Controller
                name="numeroPedido"
                control={form.control}
                render={({ field }) => (
                  <TextField {...field} label="Número" />
                )}
              />
              <Controller
                name="fornecedorId"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Fornecedor"
                    sx={{ minWidth: 180 }}
                  >
                    {(suppliers.data ?? [])
                      .filter((s) => s.ativo)
                      .map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.nome}
                        </MenuItem>
                      ))}
                  </TextField>
                )}
              />
              <Controller
                name="produtoId"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Produto"
                    sx={{ minWidth: 180 }}
                  >
                    {products.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.nome}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="quantidade"
                control={form.control}
                render={({ field }) => (
                  <TextField {...field} type="number" label="Quantidade" />
                )}
              />
              <Controller
                name="precoUnitario"
                control={form.control}
                render={({ field }) => (
                  <TextField {...field} type="number" label="Preço unitário" />
                )}
              />
              <Controller
                name="descontoItem"
                control={form.control}
                render={({ field }) => (
                  <TextField {...field} type="number" label="Desconto" />
                )}
              />
              <Button type="submit" disabled={createOrder.isPending}>
                Criar pedido
              </Button>
            </Stack>
            <MutationStatus
              mutation={createOrder}
              successMessage="Pedido criado com sucesso."
            />
          </form>
        </ContentCard>
        <Typography>
          Fornecedores disponíveis:{" "}
          {suppliers.data?.filter((s) => s.ativo).length ?? 0}
        </Typography>
        <MutationStatus mutation={changeDestination} successMessage="Destino atualizado." />
        {orders.isLoading && <Typography>Carregando...</Typography>}
        {orders.isError && <Typography>Falha ao carregar dados</Typography>}
        {orders.data?.map((o) => (
          <ContentCard key={o.id}>
            <Typography>{o.numeroPedido}</Typography>
            <Typography color="text.secondary" variant="body2">
              {o.fornecedor.nome} — {o.status}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Subtotal {o.subtotal} · Total {o.total}
            </Typography>
            {!!positions.data?.length && (
              <TextField
                select
                size="small"
                label="Destino"
                value={o.destinoPosicaoId}
                disabled={changeDestination.isPending}
                onChange={(event) => changeDestination.mutate({ id: o.id, posicaoId: event.target.value })}
              >
                {positions.data
                  .filter((position) => position.id === o.destinoPosicaoId || position.status === "ATIVA" || position.status === "CRIADA")
                  .map((position) => (
                    <MenuItem key={position.id} value={position.id}>{position.nome}</MenuItem>
                  ))}
              </TextField>
            )}
            {(["PLACED", "CONFIRMED"] as const).filter((status) =>
              o.allowedStatusTransitions?.includes(status)
            ).map((status) => (
              <Button key={status} disabled={changeStatus.isPending} onClick={() => { changeStatus.reset(); setSelectedAction({ id: o.id, number: o.numeroPedido, status }); }}>
                {status === "PLACED" ? "Enviar pedido" : "Confirmar pedido"}
              </Button>
            ))}
          </ContentCard>
        ))}
        <Stack direction="row" alignItems="center" gap={2}>
          <Button disabled={page === 1 || orders.isFetching} onClick={() => { setSelectedAction(null); setPage(page - 1); }}>Anterior</Button>
          <Typography>Página {page}</Typography>
          <Button disabled={orders.isFetching || (orders.data?.length ?? 0) < 20} onClick={() => { setSelectedAction(null); setPage(page + 1); }}>Próxima</Button>
        </Stack>
        <Dialog open={actionAvailable} onClose={() => !changeStatus.isPending && setSelectedAction(null)}>
          <DialogTitle>Confirmar mudança de status</DialogTitle>
          <DialogContent>
            <Typography>{selectedAction?.number}: {selectedAction?.status === "PLACED" ? "enviar pedido" : "confirmar compra"}?</Typography>
            {changeStatus.isError && <Alert severity="error">Não foi possível alterar o status. Confira o pedido atualizado e tente novamente.</Alert>}
          </DialogContent>
          <DialogActions>
            <Button disabled={changeStatus.isPending} onClick={() => setSelectedAction(null)}>Cancelar</Button>
            <Button disabled={changeStatus.isPending || !actionAvailable} onClick={() => selectedAction && changeStatus.mutate(selectedAction)}>Confirmar</Button>
          </DialogActions>
        </Dialog>
        {changeStatus.isError && !actionAvailable && <Alert severity="error">O pedido mudou ou a operação falhou. Confira os dados atualizados.</Alert>}
        {!orders.isLoading && !orders.data?.length && (
          <Typography>Nenhum pedido.</Typography>
        )}
      </Stack>
    </PageContainer>
  );
}

export function PurchaseOrdersPage() {
  const store = useAuthStore((state) => state.activeStoreId);
  return <PurchaseOrdersContent key={store} />;
}
