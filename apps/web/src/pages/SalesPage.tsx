import React from "react";
import { z } from "zod";
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
import { useProducts } from "../hooks/useCatalog";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";

// Batch 17: venda só baixa estoque Brasil disponível; lotes FIFO são sugestão confirmada pelo operador.
type Sale = {
  id: string;
  canal: string;
  referenciaExterna?: string | null;
  dataVenda: string;
  moeda: string;
  estado: "RASCUNHO" | "CONFIRMADA" | "CANCELADA" | "ESTORNADA";
  motivoEstorno?: string | null;
  devolucoes?: {
    id: string;
    vendaItemId: string;
    quantidade: number;
    estado: "PENDENTE" | "CONFERIDA" | "REJEITADA";
    motivo: string;
  }[];
  receitaBruta: string;
  receitaLiquida: string;
  custo?: string | null;
  lucro?: string | null;
  margem?: string | null;
  recebivel?: {
    valorPrevisto: string;
    valorRecebido: string;
    status: string;
  } | null;
  itens: {
    id: string;
    produto: { nome: string };
    quantidade: number;
    precoUnitario: string;
  }[];
};
type Suggestion = {
  itens: {
    vendaItemId: string;
    faltante: number;
    blockedReason?: string | null;
    lotes: {
      movimentoEntradaId: string;
      quantidade: number;
      entradaEm: string;
      pedido: string | null;
      custoConhecido: boolean;
    }[];
  }[];
};
const CANAIS = ["MERCADO_LIVRE", "SHOPEE", "SITE_PROPRIO", "OUTRO"];
const ESTADO_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  CONFIRMADA: "Confirmada",
  CANCELADA: "Cancelada",
  ESTORNADA: "Estornada"
};
const DEVOLUCAO_LABEL: Record<string, string> = {
  PENDENTE: "aguardando conferência",
  CONFERIDA: "conferida (voltou ao estoque)",
  REJEITADA: "rejeitada (não voltou ao estoque)"
};

// PD-01/PD-02: estorno (item não saiu) e devolução física em duas etapas; nenhuma edita a venda.
function SaleCorrections({
  sale,
  post,
  onDone
}: {
  sale: Sale;
  post: ReturnType<typeof useSalesPost>;
  onDone: () => Promise<unknown>;
}) {
  const { can } = useSalesContext();
  const [motivo, setMotivo] = React.useState("");
  const [devolucao, setDevolucao] = React.useState({
    vendaItemId: sale.itens[0]?.id ?? "",
    quantidade: "1",
    motivo: ""
  });
  const [check, setCheck] = React.useState({
    condicaoComercial: "CAIXA_ABERTA",
    funcionamento: "FUNCIONAL"
  });
  const reverse = useMutation({
    mutationFn: () =>
      post(`/sales/${sale.id}/reverse`, { motivo, itemNaoSaiu: true }),
    onSuccess: onDone
  });
  const registerReturn = useMutation({
    mutationFn: () =>
      post(`/sales/${sale.id}/returns`, {
        ...devolucao,
        quantidade: Number(devolucao.quantidade)
      }),
    onSuccess: async () => {
      setDevolucao({ ...devolucao, motivo: "" });
      await onDone();
    }
  });
  const conferir = useMutation({
    mutationFn: (v: { id: string; apta: boolean }) =>
      post(`/sales/returns/${v.id}/check`, { apta: v.apta, ...check }),
    onSuccess: onDone
  });
  if (sale.estado !== "CONFIRMADA") return null;
  const pendentes = (sale.devolucoes ?? []).filter(
    (d) => d.estado === "PENDENTE"
  );
  return (
    <Stack gap={1} mt={1}>
      {(sale.devolucoes ?? []).map((d) => (
        <Typography key={d.id} variant="body2">
          Devolução de {d.quantidade} un. · {DEVOLUCAO_LABEL[d.estado]} ·{" "}
          {d.motivo}
        </Typography>
      ))}
      {can("VENDA_CRIAR") && (
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            select
            size="small"
            label="Item devolvido"
            value={devolucao.vendaItemId}
            onChange={(e) =>
              setDevolucao({ ...devolucao, vendaItemId: e.target.value })
            }
          >
            {sale.itens.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.produto.nome}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            inputProps={{ min: 1 }}
            label="Qtd. devolvida"
            value={devolucao.quantidade}
            onChange={(e) =>
              setDevolucao({ ...devolucao, quantidade: e.target.value })
            }
          />
          <TextField
            size="small"
            label="Motivo da devolução"
            value={devolucao.motivo}
            onChange={(e) =>
              setDevolucao({ ...devolucao, motivo: e.target.value })
            }
          />
          <Button
            disabled={
              devolucao.motivo.trim().length < 3 || registerReturn.isPending
            }
            onClick={() => registerReturn.mutate()}
          >
            Registrar devolução
          </Button>
        </Stack>
      )}
      {can("DEVOLUCAO_CONFERIR") && !!pendentes.length && (
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            select
            size="small"
            label="Condição"
            value={check.condicaoComercial}
            onChange={(e) =>
              setCheck({ ...check, condicaoComercial: e.target.value })
            }
          >
            {["NOVO", "CAIXA_ABERTA", "USADO", "NAO_DEFINIDA"].map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Funcionamento"
            value={check.funcionamento}
            onChange={(e) =>
              setCheck({ ...check, funcionamento: e.target.value })
            }
          >
            {["FUNCIONAL", "DEFEITO_PARCIAL", "INOPERANTE", "NAO_TESTADO"].map(
              (f) => (
                <MenuItem key={f} value={f}>
                  {f}
                </MenuItem>
              )
            )}
          </TextField>
          <Button
            disabled={conferir.isPending}
            onClick={() =>
              conferir.mutate({ id: pendentes[0]!.id, apta: true })
            }
          >
            Conferir: apta (volta ao estoque)
          </Button>
          <Button
            color="inherit"
            disabled={conferir.isPending}
            onClick={() =>
              conferir.mutate({ id: pendentes[0]!.id, apta: false })
            }
          >
            Conferir: não apta
          </Button>
        </Stack>
      )}
      {can("VENDA_CORRIGIR") && (
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            size="small"
            label="Motivo do estorno"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button
            color="warning"
            disabled={motivo.trim().length < 3 || reverse.isPending}
            onClick={() => reverse.mutate()}
          >
            Estornar (item não saiu)
          </Button>
        </Stack>
      )}
      <MutationStatus
        mutation={reverse}
        successMessage="Venda estornada; estoque devolvido ao lote."
      />
      <MutationStatus
        mutation={registerReturn}
        successMessage="Devolução registrada; estoque só após conferência."
      />
      <MutationStatus
        mutation={conferir}
        successMessage="Devolução conferida."
      />
    </Stack>
  );
}

function useSalesContext() {
  const store = useAuthStore((s) => s.activeStoreId);
  const permissions = useAuthStore((s) => s.permissions);
  const headers = { ...authHeader(), "x-store-id": store };
  const can = (code: string) =>
    permissions.includes(code) || permissions.includes("SYSTEM_ADMIN");
  return { store, headers, can };
}

// Só identidades de tentativas confirmadas cuja limpeza falhou; sobrevive à navegação, sem dados de venda.
const confirmedSalesAttempts = new Set<string>();

function useSalesPost() {
  const { store, headers } = useSalesContext();
  const userId = useAuthStore((state) => state.user?.id);
  type Attempt = {
    fingerprint: string;
    body: object;
    key: string;
    at: string;
    pending?: ReturnType<typeof api.post>;
  };
  const attempts = React.useRef(new Map<string, Attempt>());
  return async (
    url: string,
    body: object,
    dateField?: "dataVenda" | "recebidoEm"
  ) => {
    const fingerprint = JSON.stringify({ userId, store, url, body });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(fingerprint)
    );
    const storageKey = `sales-attempt:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (!attempts.current.has(fingerprint)) {
      let saved: string | null;
      try {
        saved = sessionStorage.getItem(storageKey);
      } catch {
        throw new Error("sales_session_storage_unavailable");
      }
      // Só chave e instante são persistidos; valores e tokens não saem da memória.
      const recovered = saved
        ? z
            .object({
              key: z.string().uuid(),
              at: z.string().datetime(),
              confirmed: z.boolean().optional()
            })
            .parse(JSON.parse(saved))
        : null;
      const metadata =
        recovered &&
        !recovered.confirmed &&
        !confirmedSalesAttempts.has(recovered.key)
          ? recovered
          : { key: crypto.randomUUID(), at: new Date().toISOString() };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(metadata));
        if (recovered) confirmedSalesAttempts.delete(recovered.key);
      } catch {
        throw new Error("sales_session_storage_unavailable");
      }
      attempts.current.set(fingerprint, {
        fingerprint,
        body: dateField ? { ...body, [dateField]: metadata.at } : body,
        key: metadata.key,
        at: metadata.at
      });
    }
    const current = attempts.current.get(fingerprint)!;
    if (current.pending) return current.pending;
    current.pending = api.post(url, current.body, {
      headers: { ...headers, "idempotency-key": current.key }
    });
    try {
      const result = await current.pending;
      confirmedSalesAttempts.add(current.key);
      try {
        sessionStorage.removeItem(storageKey);
        confirmedSalesAttempts.delete(current.key);
      } catch {
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              key: current.key,
              at: current.at,
              confirmed: true
            })
          );
          confirmedSalesAttempts.delete(current.key);
        } catch {
          // A API já confirmou; falha de limpeza local não pode transformar sucesso em erro financeiro.
        }
      }
      attempts.current.delete(fingerprint);
      return result;
    } finally {
      current.pending = undefined;
    }
  };
}

function SaleCard({
  sale,
  post
}: {
  sale: Sale;
  post: ReturnType<typeof useSalesPost>;
}) {
  const { store, headers, can } = useSalesContext();
  const client = useQueryClient();
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [valor, setValor] = React.useState("");
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["sales", store] });
  const suggest = useMutation({
    mutationFn: async () =>
      (await api.get(`/sales/${sale.id}/lot-suggestion`, { headers })).data,
    onSuccess: (data: Suggestion) => setSuggestion(data)
  });
  const confirm = useMutation({
    mutationFn: () =>
      post(`/sales/${sale.id}/confirm`, {
        lotes: suggestion!.itens.flatMap((item) =>
          item.lotes.map((lote) => ({
            vendaItemId: item.vendaItemId,
            movimentoEntradaId: lote.movimentoEntradaId,
            quantidade: lote.quantidade
          }))
        )
      }),
    onSuccess: refresh
  });
  const cancel = useMutation({
    mutationFn: () =>
      post(`/sales/${sale.id}/cancel`, {
        motivo: "Cancelado antes da confirmação"
      }),
    onSuccess: refresh
  });
  const receive = useMutation({
    mutationFn: () =>
      post(
        `/sales/${sale.id}/receipts`,
        { valor: Number(valor) },
        "recebidoEm"
      ),
    onSuccess: async () => {
      setValor("");
      await refresh();
    }
  });
  const missing = suggestion?.itens.some((item) => item.faltante > 0);
  const unreconciled = suggestion?.itens.some(
    (item) => item.blockedReason === "stock_lots_require_reconciliation"
  );
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography>
          {sale.canal} {sale.referenciaExterna ?? ""} ·{" "}
          {sale.dataVenda.slice(0, 10)} · {ESTADO_LABEL[sale.estado]}
        </Typography>
        <Typography variant="body2">
          {sale.itens
            .map((item) => `${item.quantidade}× ${item.produto.nome}`)
            .join(", ")}
        </Typography>
        <Typography variant="body2">
          Bruto {sale.moeda} {sale.receitaBruta} · Líquido {sale.receitaLiquida}
          {sale.custo !== undefined &&
            (sale.lucro
              ? ` · Custo ${sale.custo} · Lucro ${sale.lucro} (${sale.margem}%)`
              : sale.estado === "CONFIRMADA"
                ? " · Lucro indisponível (custo sem câmbio ou lote sem custo)"
                : "")}
        </Typography>
        {sale.recebivel && (
          <Typography variant="body2">
            Recebível {sale.recebivel.valorRecebido} de{" "}
            {sale.recebivel.valorPrevisto} · {sale.recebivel.status}
          </Typography>
        )}
        {sale.estado === "RASCUNHO" && (
          <Stack direction={{ xs: "column", md: "row" }} gap={1} mt={1}>
            {can("VENDA_CONFIRMAR") && (
              <Button
                disabled={suggest.isPending}
                onClick={() => suggest.mutate()}
              >
                Sugerir lotes (FIFO)
              </Button>
            )}
            {can("VENDA_CRIAR") && (
              <Button
                color="inherit"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Cancelar rascunho
              </Button>
            )}
          </Stack>
        )}
        {suggestion && sale.estado === "RASCUNHO" && (
          <Stack gap={0.5} mt={1}>
            {suggestion.itens.flatMap((item) =>
              item.lotes.map((lote) => (
                <Typography
                  key={`${item.vendaItemId}:${lote.movimentoEntradaId}`}
                  variant="body2"
                >
                  Lote de {lote.entradaEm.slice(0, 10)}
                  {lote.pedido ? ` (pedido ${lote.pedido})` : ""}:{" "}
                  {lote.quantidade} un.
                  {lote.custoConhecido ? "" : " · sem custo de compra"}
                </Typography>
              ))
            )}
            {missing ? (
              <Typography role="alert">
                {unreconciled
                  ? "Os lotes precisam de reconciliação após saídas ou ajustes de estoque."
                  : "Saldo insuficiente no estoque Brasil para confirmar."}
              </Typography>
            ) : (
              <Button
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                Confirmar venda e baixar estoque
              </Button>
            )}
          </Stack>
        )}
        {sale.estado === "ESTORNADA" && (
          <Typography variant="body2">Estorno: {sale.motivoEstorno}</Typography>
        )}
        <SaleCorrections sale={sale} post={post} onDone={refresh} />
        {sale.recebivel &&
          sale.recebivel.status !== "RECEBIDO" &&
          sale.recebivel.status !== "ESTORNADO" &&
          can("FINANCEIRO_REGISTRAR") && (
            <Stack direction="row" gap={1} mt={1}>
              <TextField
                size="small"
                type="number"
                inputProps={{ step: "0.01", min: "0.01" }}
                label="Valor recebido"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <Button
                disabled={!valor || receive.isPending}
                onClick={() => receive.mutate()}
              >
                Registrar recebimento
              </Button>
            </Stack>
          )}
        <MutationStatus mutation={suggest} successMessage="Lotes sugeridos." />
        <MutationStatus mutation={confirm} successMessage="Venda confirmada." />
        <MutationStatus
          mutation={cancel}
          successMessage="Rascunho cancelado."
        />
        <MutationStatus
          mutation={receive}
          successMessage="Recebimento registrado."
        />
      </CardContent>
    </Card>
  );
}

export function SalesPage() {
  const { store, headers, can } = useSalesContext();
  const client = useQueryClient();
  const { products } = useProducts();
  const post = useSalesPost();
  const [estado, setEstado] = React.useState("");
  const [form, setForm] = React.useState({
    canal: "MERCADO_LIVRE",
    referenciaExterna: "",
    moeda: "BRL",
    produtoId: "",
    quantidade: "1",
    precoUnitario: "",
    taxaMarketplace: "",
    notaFiscal: "",
    frete: ""
  });
  const sales = useQuery<Sale[]>({
    queryKey: ["sales", store, estado],
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/sales", { headers, params: estado ? { estado } : {} }))
        .data
  });
  const amount = (value: string) => (value ? Number(value) : undefined);
  const create = useMutation({
    mutationFn: () =>
      post(
        "/sales",
        {
          canal: form.canal,
          referenciaExterna: form.referenciaExterna || undefined,
          moeda: form.moeda,
          itens: [
            {
              produtoId: form.produtoId,
              quantidade: Number(form.quantidade),
              precoUnitario: Number(form.precoUnitario),
              taxaMarketplace: amount(form.taxaMarketplace),
              notaFiscal: amount(form.notaFiscal),
              frete: amount(form.frete)
            }
          ]
        },
        "dataVenda"
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sales", store] })
  });
  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [name]: event.target.value })
  });
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Vendas"
          description="Só estoque Brasil disponível pode ser vendido. Taxas e NF são valores informados, sem percentual presumido."
        />
        {can("VENDA_CRIAR") && (
          <ContentCard title="Nova venda (rascunho)">
            <Stack
              component="form"
              direction={{ xs: "column", md: "row" }}
              gap={1}
              flexWrap="wrap"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <TextField select label="Canal" {...field("canal")}>
                {CANAIS.map((canal) => (
                  <MenuItem key={canal} value={canal}>
                    {canal}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Referência externa"
                {...field("referenciaExterna")}
              />
              <TextField required label="Moeda" {...field("moeda")} />
              <TextField
                required
                select
                label="Produto"
                {...field("produtoId")}
              >
                {products.map((product) => (
                  <MenuItem key={product.id} value={product.id}>
                    {product.nome}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                required
                type="number"
                inputProps={{ min: 1 }}
                label="Quantidade"
                {...field("quantidade")}
              />
              <TextField
                required
                type="number"
                inputProps={{ step: "0.01", min: "0" }}
                label="Preço unitário"
                {...field("precoUnitario")}
              />
              <TextField
                type="number"
                inputProps={{ step: "0.01", min: "0" }}
                label="Taxa marketplace"
                {...field("taxaMarketplace")}
              />
              <TextField
                type="number"
                inputProps={{ step: "0.01", min: "0" }}
                label="NF de saída"
                {...field("notaFiscal")}
              />
              <TextField
                type="number"
                inputProps={{ step: "0.01", min: "0" }}
                label="Frete"
                {...field("frete")}
              />
              <Button type="submit" disabled={create.isPending}>
                Criar rascunho
              </Button>
            </Stack>
            <MutationStatus
              mutation={create}
              successMessage="Rascunho criado."
            />
          </ContentCard>
        )}
        <ContentCard title="Vendas da loja">
          <TextField
            select
            label="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            <MenuItem value="">Todos</MenuItem>
            {Object.entries(ESTADO_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          {sales.isLoading && <Typography>Carregando…</Typography>}
          {sales.isError && (
            <Typography role="alert">Falha ao carregar vendas.</Typography>
          )}
          {sales.data && !sales.data.length && (
            <Typography>Nenhuma venda neste filtro.</Typography>
          )}
          {sales.data?.map((sale) => (
            <SaleCard key={sale.id} sale={sale} post={post} />
          ))}
        </ContentCard>
      </Stack>
    </PageContainer>
  );
}
