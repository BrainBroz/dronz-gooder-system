import React from "react";
import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
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
import { purchasingQueryKeys } from "../queryKeys";
import type { Supplier, PurchaseOrder } from "../types/purchasing";
import { useProducts } from "../hooks/useCatalog";

function PurchaseOrdersContent() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
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
    queryKey: purchasingQueryKeys.orders(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/purchase-orders", {
          headers: { ...authHeader(), "x-store-id": store }
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
      await client.invalidateQueries({
        queryKey: purchasingQueryKeys.orders(store)
      });
      form.reset();
    }
  });
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
          </ContentCard>
        ))}
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
