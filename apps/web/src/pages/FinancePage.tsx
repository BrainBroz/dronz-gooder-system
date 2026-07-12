import { Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { financeQueryKeys, purchasingQueryKeys } from "../queryKeys";
import type { PurchaseOrder } from "../types/purchasing";

export function FinancePage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const exchangeForm = useForm<{
    moedaOrigem: string;
    moedaDestino: string;
    valor: number;
    cotadoEm: string;
  }>({
    defaultValues: {
      moedaOrigem: "BRL",
      moedaDestino: "USD",
      valor: 0,
      cotadoEm: ""
    }
  });
  const paymentForm = useForm<{
    pedidoCompraId: string;
    formaPagamento:
      "CREDIT_CARD" | "PAYPAL" | "BANK_TRANSFER" | "CASH" | "OTHER";
    moeda: string;
    valor: number;
  }>({
    defaultValues: {
      pedidoCompraId: "",
      formaPagamento: "OTHER",
      moeda: "USD",
      valor: 0
    }
  });
  const costForm = useForm<{
    pedidoCompraId: string;
    iofPercentual: number;
    taxas: number;
    custoAdicional: number;
  }>({
    defaultValues: {
      pedidoCompraId: "",
      iofPercentual: 0,
      taxas: 0,
      custoAdicional: 0
    }
  });
  const headers = { ...authHeader(), "x-store-id": store };
  const payments = useQuery({
    queryKey: financeQueryKeys.payments(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/finance/payments", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data
  });
  const orders = useQuery<PurchaseOrder[]>({
    queryKey: purchasingQueryKeys.orders(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/purchase-orders", { headers })).data.items
  });
  const exchange = useMutation({
    mutationFn: (v: {
      moedaOrigem: string;
      moedaDestino: string;
      valor: number;
      cotadoEm: string;
    }) =>
      api.post(
        "/finance/exchange-rates",
        {
          ...v,
          valor: Number(v.valor),
          cotadoEm: v.cotadoEm || new Date().toISOString()
        },
        { headers }
      ),
    onSuccess: () => exchangeForm.reset()
  });
  const payment = useMutation({
    mutationFn: (v: {
      pedidoCompraId: string;
      formaPagamento: string;
      moeda: string;
      valor: number;
    }) =>
      api.post(
        "/finance/payments",
        { ...v, valor: Number(v.valor) },
        { headers }
      ),
    onSuccess: async () => {
      paymentForm.reset();
      await client.invalidateQueries({
        queryKey: financeQueryKeys.payments(store)
      });
    }
  });
  const costs = useMutation({
    mutationFn: (v: {
      pedidoCompraId: string;
      iofPercentual: number;
      taxas: number;
      custoAdicional: number;
    }) =>
      api.put(
        `/finance/orders/${v.pedidoCompraId}/costs`,
        {
          iofPercentual: Number(v.iofPercentual),
          taxas: Number(v.taxas),
          custoAdicional: Number(v.custoAdicional)
        },
        { headers }
      )
  });
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Financeiro de Compras"
          description="Câmbio e PayPal são registros manuais."
        />
        <ContentCard title="Câmbio">
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={exchangeForm.handleSubmit((v) => exchange.mutate(v))}
          >
            <TextField
              label="Moeda origem"
              {...exchangeForm.register("moedaOrigem", {
                required: true,
                minLength: 3,
                maxLength: 3
              })}
            />
            <TextField
              label="Moeda destino"
              {...exchangeForm.register("moedaDestino", {
                required: true,
                minLength: 3,
                maxLength: 3
              })}
            />
            <TextField
              type="number"
              inputProps={{ step: "0.000001" }}
              label="Cotação"
              {...exchangeForm.register("valor", {
                valueAsNumber: true,
                min: 0.000001
              })}
            />
            <TextField
              type="datetime-local"
              label="Data"
              InputLabelProps={{ shrink: true }}
              {...exchangeForm.register("cotadoEm")}
            />
            <Button type="submit" disabled={exchange.isPending}>
              Registrar câmbio
            </Button>
          </Stack>
          <MutationStatus
            mutation={exchange}
            successMessage="Câmbio registrado."
          />
        </ContentCard>
        <ContentCard title="Pagamento">
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={paymentForm.handleSubmit((v) => payment.mutate(v))}
          >
            <TextField
              select
              label="Pedido"
              defaultValue=""
              {...paymentForm.register("pedidoCompraId", { required: true })}
            >
              <MenuItem value="" disabled>
                Selecione
              </MenuItem>
              {orders.data?.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.numeroPedido}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Forma"
              defaultValue="OTHER"
              {...paymentForm.register("formaPagamento")}
            >
              {["CREDIT_CARD", "PAYPAL", "BANK_TRANSFER", "CASH", "OTHER"].map(
                (x) => (
                  <MenuItem key={x} value={x}>
                    {x}
                  </MenuItem>
                )
              )}
            </TextField>
            <TextField
              label="Moeda"
              {...paymentForm.register("moeda", {
                required: true,
                minLength: 3,
                maxLength: 3
              })}
            />
            <TextField
              type="number"
              inputProps={{ step: "0.01" }}
              label="Valor"
              {...paymentForm.register("valor", {
                valueAsNumber: true,
                min: 0.01
              })}
            />
            <Button type="submit" disabled={payment.isPending}>
              Registrar pagamento
            </Button>
          </Stack>
          <MutationStatus
            mutation={payment}
            successMessage="Pagamento registrado."
          />
          {payments.isLoading && <Typography>Carregando...</Typography>}
          {payments.isError && <Typography>Falha ao carregar dados</Typography>}
          {payments.data?.map(
            (p: {
              id: string;
              formaPagamento: string;
              valor: string;
              moeda: string;
              status: string;
            }) => (
              <Card key={p.id}>
                <CardContent>
                  <Typography>
                    {p.formaPagamento} · {p.moeda} {p.valor}
                  </Typography>
                  <Typography>{p.status}</Typography>
                </CardContent>
              </Card>
            )
          )}
        </ContentCard>
        <ContentCard title="Custos">
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={costForm.handleSubmit((v) => costs.mutate(v))}
          >
            <TextField
              select
              label="Pedido para custos"
              defaultValue=""
              {...costForm.register("pedidoCompraId", { required: true })}
            >
              <MenuItem value="" disabled>
                Selecione
              </MenuItem>
              {orders.data?.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.numeroPedido}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="number"
              label="IOF %"
              {...costForm.register("iofPercentual", {
                valueAsNumber: true,
                min: 0
              })}
            />
            <TextField
              type="number"
              label="Taxas"
              {...costForm.register("taxas", { valueAsNumber: true, min: 0 })}
            />
            <TextField
              type="number"
              label="Adicional"
              {...costForm.register("custoAdicional", {
                valueAsNumber: true,
                min: 0
              })}
            />
            <Button type="submit" disabled={costs.isPending}>
              Calcular custos
            </Button>
          </Stack>
          <MutationStatus mutation={costs} successMessage="Custos calculados." />
        </ContentCard>
      </Stack>
    </PageContainer>
  );
}
