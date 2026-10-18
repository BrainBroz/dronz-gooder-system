import React from "react";
import {
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { financeQueryKeys } from "../queryKeys";
import { ContentCard } from "./ui/ContentCard";
import { MutationStatus } from "./ui/MutationStatus";

// Batch 16: conciliação, cartões/faturas e despesas. Toda confirmação é ação humana; nada concilia sozinho.
type Account = {
  id: string;
  tipo: "PAYPAL" | "CARTAO" | "BANCO" | "CAIXA";
  apelido: string;
  moedaPrincipal: string;
  ultimosQuatro?: string | null;
};
type Totals = {
  debitos: string;
  creditos: string;
  pagos: string;
  saldo: string;
};
type Statement = {
  id: string;
  moeda: string;
  inicio: string;
  fim: string;
  vencimento: string;
  estado: string;
  totais: Totals;
};
type Reconciliation = {
  id: string;
  estado: string;
  motivo?: string | null;
  sugeridoPagamentoId?: string | null;
  pagamentoId?: string | null;
  transacao: {
    provider: string;
    transactionId: string;
    versao: number;
    moeda: string;
    bruto: string;
    occurredAt: string;
    conta: { apelido: string };
  };
};

const RECONCILIATION_LABEL: Record<string, string> = {
  PENDENTE_REVISAO: "Pendente de revisão",
  CONCILIADO: "Conciliado",
  POSSIVEL_DUPLICIDADE: "Possível duplicidade",
  SEM_PAGAMENTO_ASSOCIADO: "Sem pagamento associado",
  IGNORADO: "Ignorado"
};
const day = (value: string) => value.slice(0, 10);

function useFinanceContext() {
  const store = useAuthStore((s) => s.activeStoreId);
  const permissions = useAuthStore((s) => s.permissions);
  const headers = { ...authHeader(), "x-store-id": store };
  const can = (code: string) =>
    permissions.includes(code) || permissions.includes("SYSTEM_ADMIN");
  return { store, headers, can };
}

function useAccounts() {
  const { store, headers } = useFinanceContext();
  return useQuery<Account[]>({
    queryKey: financeQueryKeys.accounts(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/finance/accounts", { headers })).data
  });
}

export function ReconciliationPanel() {
  const { store, headers, can } = useFinanceContext();
  const client = useQueryClient();
  const accounts = useAccounts();
  const [estado, setEstado] = React.useState("PENDENTE_REVISAO");
  const [source, setSource] = React.useState({
    contaId: "",
    transactionId: "",
    tipo: "COMPRA",
    moeda: "USD",
    bruto: "",
    occurredAt: ""
  });
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  const list = useQuery<Reconciliation[]>({
    queryKey: financeQueryKeys.reconciliations(store, estado),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/finance/reconciliations", {
          headers,
          params: estado ? { estado } : {}
        })
      ).data
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["finance-reconciliations", store] });
  const register = useMutation({
    mutationFn: () => {
      const account = accounts.data?.find((a) => a.id === source.contaId);
      return api.post(
        "/finance/source-transactions",
        {
          ...source,
          provider: account?.tipo ?? "MANUAL",
          bruto: Number(source.bruto),
          occurredAt: new Date(source.occurredAt || Date.now()).toISOString()
        },
        { headers }
      );
    },
    onSuccess: refresh
  });
  const confirm = useMutation({
    mutationFn: (v: { id: string; pagamentoId: string }) =>
      api.post(
        `/finance/reconciliations/${v.id}/confirm`,
        { pagamentoId: v.pagamentoId },
        { headers }
      ),
    onSuccess: refresh
  });
  const ignore = useMutation({
    mutationFn: (id: string) =>
      api.post(
        `/finance/reconciliations/${id}/ignore`,
        { motivo: "Ignorado na revisão manual" },
        { headers }
      ),
    onSuccess: refresh
  });
  const writable = can("FINANCEIRO_CONCILIAR");
  return (
    <Stack gap={2}>
      {writable && (
        <ContentCard title="Registrar transação de extrato">
          <Typography variant="body2" color="text.secondary">
            Integração PayPal: NOT_CONFIGURED. Lançamentos de extrato entram
            manualmente; repetir a mesma transação não duplica.
          </Typography>
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={(event) => {
              event.preventDefault();
              register.mutate();
            }}
          >
            <TextField
              select
              required
              label="Conta"
              value={source.contaId}
              onChange={(e) =>
                setSource({ ...source, contaId: e.target.value })
              }
            >
              {accounts.data?.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.apelido}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              label="ID da transação"
              value={source.transactionId}
              onChange={(e) =>
                setSource({ ...source, transactionId: e.target.value })
              }
            />
            <TextField
              select
              label="Tipo"
              value={source.tipo}
              onChange={(e) => setSource({ ...source, tipo: e.target.value })}
            >
              {[
                "COMPRA",
                "TAXA",
                "CONVERSAO",
                "REEMBOLSO",
                "PAGAMENTO_FATURA"
              ].map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              label="Moeda"
              value={source.moeda}
              onChange={(e) =>
                setSource({ ...source, moeda: e.target.value.toUpperCase() })
              }
            />
            <TextField
              required
              type="number"
              inputProps={{ step: "0.01", min: "0.01" }}
              label="Valor bruto"
              value={source.bruto}
              onChange={(e) => setSource({ ...source, bruto: e.target.value })}
            />
            <TextField
              type="datetime-local"
              label="Data"
              InputLabelProps={{ shrink: true }}
              value={source.occurredAt}
              onChange={(e) =>
                setSource({ ...source, occurredAt: e.target.value })
              }
            />
            <Button type="submit" disabled={register.isPending}>
              Registrar
            </Button>
          </Stack>
          <MutationStatus
            mutation={register}
            successMessage="Transação registrada para revisão."
          />
        </ContentCard>
      )}
      <ContentCard title="Conciliação">
        <TextField
          select
          label="Estado"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          <MenuItem value="">Todos</MenuItem>
          {Object.entries(RECONCILIATION_LABEL).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <MutationStatus
          mutation={confirm}
          successMessage="Conciliação confirmada."
        />
        <MutationStatus
          mutation={ignore}
          successMessage="Marcado como ignorado."
        />
        {list.isLoading && <Typography>Carregando…</Typography>}
        {list.isError && (
          <Typography role="alert">Falha ao carregar conciliações.</Typography>
        )}
        {list.data && !list.data.length && (
          <Typography>Nenhuma conciliação neste estado.</Typography>
        )}
        {list.data?.map((item) => {
          const open =
            item.estado !== "CONCILIADO" && item.estado !== "IGNORADO";
          const pagamentoId = chosen[item.id] ?? item.sugeridoPagamentoId ?? "";
          return (
            <Card key={item.id} variant="outlined">
              <CardContent>
                <Typography>
                  {item.transacao.conta.apelido} · {item.transacao.provider}{" "}
                  {item.transacao.transactionId} (v{item.transacao.versao}) ·{" "}
                  {item.transacao.moeda} {item.transacao.bruto} ·{" "}
                  {day(item.transacao.occurredAt)}
                </Typography>
                <Typography variant="body2">
                  {RECONCILIATION_LABEL[item.estado] ?? item.estado}
                  {item.motivo ? ` · ${item.motivo}` : ""}
                  {item.pagamentoId ? ` · pagamento ${item.pagamentoId}` : ""}
                </Typography>
                {open && writable && (
                  <Stack direction={{ xs: "column", md: "row" }} gap={1} mt={1}>
                    <TextField
                      size="small"
                      label="ID do pagamento"
                      value={pagamentoId}
                      onChange={(e) =>
                        setChosen({ ...chosen, [item.id]: e.target.value })
                      }
                    />
                    <Button
                      disabled={!pagamentoId || confirm.isPending}
                      onClick={() =>
                        confirm.mutate({ id: item.id, pagamentoId })
                      }
                    >
                      Confirmar conciliação
                    </Button>
                    <Button
                      color="inherit"
                      disabled={ignore.isPending}
                      onClick={() => ignore.mutate(item.id)}
                    >
                      Ignorar
                    </Button>
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </ContentCard>
    </Stack>
  );
}

function StatementCard({ statement }: { statement: Statement }) {
  const { store, headers, can } = useFinanceContext();
  const client = useQueryClient();
  const [valor, setValor] = React.useState("");
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["finance-statements", store] });
  const close = useMutation({
    mutationFn: () =>
      api.post(`/finance/statements/${statement.id}/close`, {}, { headers }),
    onSuccess: refresh
  });
  const pay = useMutation({
    mutationFn: () =>
      api.post(
        `/finance/statements/${statement.id}/payments`,
        { valor: Number(valor), pagoEm: new Date().toISOString() },
        { headers }
      ),
    onSuccess: async () => {
      setValor("");
      await refresh();
    }
  });
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography>
          {day(statement.inicio)} a {day(statement.fim)} · vence{" "}
          {day(statement.vencimento)} · {statement.estado}
        </Typography>
        <Typography variant="body2">
          Lançamentos {statement.moeda} {statement.totais.debitos} · Créditos{" "}
          {statement.totais.creditos} · Pago {statement.totais.pagos} · Saldo{" "}
          {statement.totais.saldo}
        </Typography>
        {can("FINANCEIRO_FATURAS") && statement.estado !== "QUITADA" && (
          <Stack direction={{ xs: "column", md: "row" }} gap={1} mt={1}>
            {statement.estado === "ABERTA" && (
              <Button disabled={close.isPending} onClick={() => close.mutate()}>
                Fechar fatura
              </Button>
            )}
            <TextField
              size="small"
              type="number"
              inputProps={{ step: "0.01", min: "0.01" }}
              label="Pagar valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            <Button
              disabled={!valor || pay.isPending}
              onClick={() => pay.mutate()}
            >
              Registrar pagamento da fatura
            </Button>
          </Stack>
        )}
        <MutationStatus mutation={close} successMessage="Fatura fechada." />
        <MutationStatus mutation={pay} successMessage="Pagamento registrado." />
      </CardContent>
    </Card>
  );
}

export function CardsPanel() {
  const { store, headers, can } = useFinanceContext();
  const client = useQueryClient();
  const accounts = useAccounts();
  const [form, setForm] = React.useState({
    tipo: "CARTAO",
    apelido: "",
    moedaPrincipal: "USD",
    ultimosQuatro: "",
    diaFechamento: "",
    diaVencimento: ""
  });
  const [selected, setSelected] = React.useState("");
  const now = new Date();
  const [period, setPeriod] = React.useState({
    ano: String(now.getFullYear()),
    mes: String(now.getMonth() + 1)
  });
  const statements = useQuery<Statement[]>({
    queryKey: financeQueryKeys.statements(store, selected),
    enabled: !!store && !!selected,
    queryFn: async () =>
      (await api.get(`/finance/accounts/${selected}/statements`, { headers }))
        .data
  });
  const create = useMutation({
    mutationFn: () =>
      api.post(
        "/finance/accounts",
        form.tipo === "CARTAO"
          ? {
              ...form,
              diaFechamento: Number(form.diaFechamento),
              diaVencimento: Number(form.diaVencimento)
            }
          : {
              tipo: form.tipo,
              apelido: form.apelido,
              moedaPrincipal: form.moedaPrincipal
            },
        { headers }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: financeQueryKeys.accounts(store) })
  });
  const open = useMutation({
    mutationFn: () =>
      api.post(
        `/finance/accounts/${selected}/statements`,
        { ano: Number(period.ano), mes: Number(period.mes) },
        { headers }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["finance-statements", store] })
  });
  const writable = can("FINANCEIRO_FATURAS");
  const cards = accounts.data?.filter((a) => a.tipo === "CARTAO") ?? [];
  return (
    <Stack gap={2}>
      {writable && (
        <ContentCard title="Nova conta ou cartão">
          <Typography variant="body2" color="text.secondary">
            Guarde apenas os últimos quatro dígitos. Nunca informe número
            completo, CVV ou senha.
          </Typography>
          <Stack
            component="form"
            direction={{ xs: "column", md: "row" }}
            gap={1}
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <TextField
              select
              label="Tipo"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
            >
              {["CARTAO", "PAYPAL", "BANCO", "CAIXA"].map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              label="Apelido"
              value={form.apelido}
              onChange={(e) => setForm({ ...form, apelido: e.target.value })}
            />
            <TextField
              required
              label="Moeda"
              value={form.moedaPrincipal}
              onChange={(e) =>
                setForm({
                  ...form,
                  moedaPrincipal: e.target.value.toUpperCase()
                })
              }
            />
            {form.tipo === "CARTAO" && (
              <>
                <TextField
                  required
                  label="Últimos 4 dígitos"
                  inputProps={{ maxLength: 4, pattern: "[0-9]{4}" }}
                  value={form.ultimosQuatro}
                  onChange={(e) =>
                    setForm({ ...form, ultimosQuatro: e.target.value })
                  }
                />
                <TextField
                  required
                  type="number"
                  inputProps={{ min: 1, max: 31 }}
                  label="Dia de fechamento"
                  value={form.diaFechamento}
                  onChange={(e) =>
                    setForm({ ...form, diaFechamento: e.target.value })
                  }
                />
                <TextField
                  required
                  type="number"
                  inputProps={{ min: 1, max: 31 }}
                  label="Dia de vencimento"
                  value={form.diaVencimento}
                  onChange={(e) =>
                    setForm({ ...form, diaVencimento: e.target.value })
                  }
                />
              </>
            )}
            <Button type="submit" disabled={create.isPending}>
              Cadastrar
            </Button>
          </Stack>
          <MutationStatus
            mutation={create}
            successMessage="Conta cadastrada."
          />
        </ContentCard>
      )}
      <ContentCard title="Faturas">
        {accounts.isError && (
          <Typography role="alert">Falha ao carregar contas.</Typography>
        )}
        {accounts.data && !cards.length && (
          <Typography>Nenhum cartão cadastrado.</Typography>
        )}
        {!!cards.length && (
          <Stack direction={{ xs: "column", md: "row" }} gap={1}>
            <TextField
              select
              label="Cartão"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {cards.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.apelido} · final {a.ultimosQuatro}
                </MenuItem>
              ))}
            </TextField>
            {writable && selected && (
              <>
                <TextField
                  type="number"
                  label="Ano"
                  value={period.ano}
                  onChange={(e) =>
                    setPeriod({ ...period, ano: e.target.value })
                  }
                />
                <TextField
                  type="number"
                  inputProps={{ min: 1, max: 12 }}
                  label="Mês"
                  value={period.mes}
                  onChange={(e) =>
                    setPeriod({ ...period, mes: e.target.value })
                  }
                />
                <Button disabled={open.isPending} onClick={() => open.mutate()}>
                  Abrir fatura
                </Button>
              </>
            )}
          </Stack>
        )}
        <MutationStatus mutation={open} successMessage="Fatura aberta." />
        {statements.isError && (
          <Typography role="alert">Falha ao carregar faturas.</Typography>
        )}
        {statements.data && !statements.data.length && (
          <Typography>Nenhuma fatura para este cartão.</Typography>
        )}
        {statements.data?.map((statement) => (
          <StatementCard key={statement.id} statement={statement} />
        ))}
      </ContentCard>
    </Stack>
  );
}

const IMPACT_LABEL: Record<string, string> = {
  DESPESA_RESULTADO: "Despesa de resultado",
  TRANSFERENCIA: "Transferência",
  CUSTO_AQUISICAO: "Custo de aquisição",
  APLICACAO_CAPITAL: "Aplicação de capital"
};

export function ExpensesPanel() {
  const { store, headers, can } = useFinanceContext();
  const client = useQueryClient();
  const [form, setForm] = React.useState({
    categoria: "OPERACIONAL",
    impacto: "DESPESA_RESULTADO",
    descricao: "",
    valor: "",
    moeda: "BRL",
    dataDespesa: ""
  });
  const expenses = useQuery<
    {
      id: string;
      categoria: string;
      impacto: string;
      descricao: string;
      valor: string;
      moeda: string;
      dataDespesa: string;
    }[]
  >({
    queryKey: financeQueryKeys.expenses(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/finance/expenses", { headers })).data
  });
  const create = useMutation({
    mutationFn: () =>
      api.post(
        "/finance/expenses",
        {
          ...form,
          valor: Number(form.valor),
          dataDespesa: new Date(form.dataDespesa || Date.now()).toISOString()
        },
        { headers }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: financeQueryKeys.expenses(store) })
  });
  return (
    <ContentCard title="Despesas e aplicações">
      {can("FINANCEIRO_DESPESAS") && (
        <Stack
          component="form"
          direction={{ xs: "column", md: "row" }}
          gap={1}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <TextField
            select
            label="Categoria"
            value={form.categoria}
            onChange={(e) => setForm({ ...form, categoria: e.target.value })}
          >
            {["PROLABORE", "OPERACIONAL", "REINVESTIMENTO"].map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Impacto"
            value={form.impacto}
            onChange={(e) => setForm({ ...form, impacto: e.target.value })}
          >
            {Object.entries(IMPACT_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            required
            label="Descrição"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          />
          <TextField
            required
            label="Moeda"
            value={form.moeda}
            onChange={(e) =>
              setForm({ ...form, moeda: e.target.value.toUpperCase() })
            }
          />
          <TextField
            required
            type="number"
            inputProps={{ step: "0.01", min: "0.01" }}
            label="Valor"
            value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })}
          />
          <TextField
            type="date"
            label="Competência"
            InputLabelProps={{ shrink: true }}
            value={form.dataDespesa}
            onChange={(e) => setForm({ ...form, dataDespesa: e.target.value })}
          />
          <Button type="submit" disabled={create.isPending}>
            Classificar
          </Button>
        </Stack>
      )}
      <MutationStatus mutation={create} successMessage="Despesa registrada." />
      {expenses.isError && (
        <Typography role="alert">Falha ao carregar despesas.</Typography>
      )}
      {expenses.data && !expenses.data.length && (
        <Typography>Nenhuma despesa registrada.</Typography>
      )}
      {expenses.data?.map((e) => (
        <Typography key={e.id}>
          {day(e.dataDespesa)} · {e.categoria} · {IMPACT_LABEL[e.impacto]} ·{" "}
          {e.descricao} · {e.moeda} {e.valor}
        </Typography>
      ))}
    </ContentCard>
  );
}

export function RefundAction({ paymentId }: { paymentId: string }) {
  const { store, headers, can } = useFinanceContext();
  const client = useQueryClient();
  const [valor, setValor] = React.useState("");
  const refund = useMutation({
    mutationFn: () =>
      api.post(
        `/finance/payments/${paymentId}/refund`,
        { valor: Number(valor) },
        { headers }
      ),
    onSuccess: async () => {
      setValor("");
      await client.invalidateQueries({
        queryKey: financeQueryKeys.payments(store)
      });
    }
  });
  if (!can("FINANCEIRO_REEMBOLSAR")) return null;
  return (
    <Stack direction="row" gap={1} mt={1}>
      <TextField
        size="small"
        type="number"
        inputProps={{ step: "0.01", min: "0.01" }}
        label="Reembolso"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <Button
        disabled={!valor || refund.isPending}
        onClick={() => refund.mutate()}
      >
        Registrar reembolso
      </Button>
      <MutationStatus
        mutation={refund}
        successMessage="Reembolso registrado; estoque não é alterado."
      />
    </Stack>
  );
}
