import React from "react";
import { Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
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
import {
  CardsPanel,
  ExpensesPanel,
  ReconciliationPanel,
  RefundAction
} from "../components/FinanceLedger";

function FinanceContent() {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [draftOrderNumber, setDraftOrderNumber] = React.useState("");
  const [orderNumber, setOrderNumber] = React.useState("");
  const [ordersPage, setOrdersPage] = React.useState(1);
  const exchangeForm = useForm<{
    moedaOrigem: string;
    moedaDestino: string;
    valor: number;
    margem: number;
    fonte: string;
    cotadoEm: string;
  }>({
    defaultValues: {
      moedaOrigem: "BRL",
      moedaDestino: "USD",
      valor: 0,
      fonte: "",
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
  // PD-10: cancelados e estornos ficam fora da lista ativa por padrão; os totais mostram tudo.
  const [incluirCancelados, setIncluirCancelados] = React.useState(false);
  const payments = useQuery<{
    items: { id: string; formaPagamento: string; valor: string; moeda: string; status: string; estornoDeId?: string | null }[];
    totais: { moeda: string; bruto: string; cancelado: string; reembolsado: string; liquido: string }[];
  }>({
    queryKey: [...financeQueryKeys.payments(store), incluirCancelados],
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/finance/payments", {
          headers: { ...authHeader(), "x-store-id": store },
          ...(incluirCancelados ? { params: { incluirCancelados: "true" } } : {})
        })
      ).data
  });
  const orders = useQuery<PurchaseOrder[]>({
    queryKey: [...purchasingQueryKeys.orders(store), "search", orderNumber, ordersPage],
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/purchase-orders", { headers, params: { numero: orderNumber, page: ordersPage, limit: 20 } })).data.items
  });
  const exchange = useMutation({
    mutationFn: (v: {
      moedaOrigem: string;
      moedaDestino: string;
      valor: number;
      margem: number;
      fonte: string;
      cotadoEm: string;
    }) =>
      api.post(
        "/finance/exchange-rates",
        {
          moedaOrigem: v.moedaOrigem,
          moedaDestino: v.moedaDestino,
          valorMercado: Number(v.valor),
          margem: Number(v.margem),
          fonte: v.fonte,
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
            type="number"
            inputProps={{ step: "0.000001" }}
            label="Margem"
            {...exchangeForm.register("margem", {
              valueAsNumber: true,
              required: true,
              min: 0
            })}
          />
          <TextField
            label="Fonte"
            {...exchangeForm.register("fonte", { required: true })}
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
      <ContentCard title="Buscar pedido operacional">
        <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1} onSubmit={(event) => {
          event.preventDefault();
          const nextOrderNumber = draftOrderNumber.trim();
          if (nextOrderNumber === orderNumber) return;
          paymentForm.resetField("pedidoCompraId");
          costForm.resetField("pedidoCompraId");
          setOrdersPage(1);
          setOrderNumber(nextOrderNumber);
        }}>
          <TextField label="Número do pedido" value={draftOrderNumber} onChange={(event) => setDraftOrderNumber(event.target.value)} />
          <Button type="submit">Buscar</Button>
        </Stack>
        <Stack direction="row" alignItems="center" gap={2}>
          <Button disabled={ordersPage === 1 || orders.isFetching} onClick={() => {
            paymentForm.resetField("pedidoCompraId");
            costForm.resetField("pedidoCompraId");
            setOrdersPage(ordersPage - 1);
          }}>Anterior</Button>
          <Typography>Página {ordersPage}</Typography>
          <Button disabled={orders.isFetching || (orders.data?.length ?? 0) < 20} onClick={() => {
            paymentForm.resetField("pedidoCompraId");
            costForm.resetField("pedidoCompraId");
            setOrdersPage(ordersPage + 1);
          }}>Próxima</Button>
        </Stack>
        {orders.isError && <Typography>Falha ao buscar pedidos.</Typography>}
      </ContentCard>
      <ContentCard title="Pagamento">
        <Stack
          component="form"
          direction={{ xs: "column", md: "row" }}
          gap={1}
          onSubmit={paymentForm.handleSubmit((v) => payment.mutate(v))}
        >
          <TextField
            key={`${orderNumber}:${ordersPage}`}
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
        <FormControlLabel
          control={
            <Checkbox
              checked={incluirCancelados}
              onChange={(e) => setIncluirCancelados(e.target.checked)}
            />
          }
          label="Incluir cancelados e estornos"
        />
        {payments.data?.totais?.map((t) => (
          <Typography key={t.moeda} variant="body2">
            {t.moeda}: bruto {t.bruto} · cancelado {t.cancelado} · reembolsado {t.reembolsado} · líquido {t.liquido}
          </Typography>
        ))}
        {payments.data?.items?.map(
          (p: {
            id: string;
            formaPagamento: string;
            valor: string;
            moeda: string;
            status: string;
            estornoDeId?: string | null;
          }) => (
            <Card key={p.id}>
              <CardContent>
                <Typography>
                  {p.estornoDeId ? "Reembolso" : p.formaPagamento} · {p.moeda}{" "}
                  {p.valor}
                </Typography>
                <Typography>{p.status}</Typography>
                {!p.estornoDeId && <RefundAction paymentId={p.id} />}
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
            key={`${orderNumber}:${ordersPage}`}
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
        {costs.data?.data?.avisoCotacao && (
          <Typography role="status" color="warning.main">
            {costs.data.data.avisoCotacao === "COTACAO_SUBSTITUIDA"
              ? "Atenção: existe cotação mais recente para este par; o custo usou a escolhida."
              : "Atenção: a cotação usada tem mais de 7 dias."}
          </Typography>
        )}
      </ContentCard>
    </Stack>
  );
}

const TABS = ["Pagamentos", "Conciliação", "Cartões e faturas", "Despesas"];

export function FinancePage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const [tab, setTab] = React.useState(0);

  return (
    <PageContainer>
      <Tabs
        value={tab}
        onChange={(_, value: number) => setTab(value)}
        variant="scrollable"
        sx={{ mb: 2 }}
      >
        {TABS.map((label) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      {tab === 0 && <FinanceContent key={store} />}
      {tab === 1 && <ReconciliationPanel key={store} />}
      {tab === 2 && <CardsPanel key={store} />}
      {tab === 3 && <ExpensesPanel key={store} />}
    </PageContainer>
  );
}
