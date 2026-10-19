import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { PageContainer } from "../components/ui/PageContainer";
import { MutationStatus } from "../components/ui/MutationStatus";
import { economicQueryKeys } from "../queryKeys";
import { fontMono, visualTokens } from "../theme";
import {
  brl,
  canalLabel,
  modalidadeLabel,
  percent,
  rate,
  type Canal,
  type CotacaoVigente,
  type Modalidade,
  type Moeda,
  type ProjecaoResultado,
  type TaxaMarketplace,
  type SettingsResponse
} from "../api/economic";

export type Produto = { id: string; nome: string; codigo: number; peso: string | null; precoVenda: string; categoria?: { nome: string } };
type EncargoCompraForm = { descricao: string; tipo: "PERCENTUAL_COMPRA" | "VALOR_UNIDADE" | "VALOR_TOTAL"; valor: string; moeda: Moeda };
type EncargoVendaForm = { descricao: string; tipo: "PERCENTUAL_VENDA_BRUTA" | "VALOR_UNIDADE" | "VALOR_TOTAL"; valor: string };
type NotaModo = "PERCENTUAL_VENDA_BRUTA" | "PERCENTUAL_BASE_INFORMADA" | "VALOR_INFORMADO" | "BASE_PENDENTE";
export type SimForm = {
  produto: Produto | null;
  itemLivre: boolean;
  produtoNome: string;
  quantidade: string;
  precoCompra: string;
  moedaCompra: Moeda;
  peso: string;
  cambioOrigem: "COTACAO_REGISTRADA" | "INFORMADA";
  referencia: string;
  acrescimo: string;
  freteValor: string;
  freteMoeda: Moeda | "";
  encargosCompra: EncargoCompraForm[];
  precoVenda: string;
  taxaEscolha: "nenhuma" | "manual" | "configurada";
  /**
   * Cópia da taxa configurada escolhida, com a identidade dela: uma nova versão de parâmetros
   * carregada durante a edição não troca o plano escolhido pelo operador.
   */
  taxaConfigurada: TaxaMarketplace | null;
  /** Versão de parâmetros e limite de markup fixados quando o formulário foi aberto. */
  parametro: { id: string | null; markupAlertaPercentual: string };
  taxaManual: { canal: Canal; modalidade: Modalidade; parcelas: string; percentual: string };
  notaModo: NotaModo;
  notaPercentual: string;
  notaBase: string;
  notaValor: string;
  outrosEncargos: EncargoVendaForm[];
  nome: string;
};
type SavedSimulation = {
  id: string;
  nome: string;
  produtoNome: string;
  produtoCodigo: number | null;
  createdAt: string;
  resultado: ProjecaoResultado;
  criadoPor: { name: string };
};
type SavedDetail = SavedSimulation & { entrada: SavedEntrada };
type SavedEntrada = {
  quantidade: number;
  compra: { precoUnitario: string | null; moeda: Moeda };
  pesoUnitarioKg: string | null;
  cambio: { referencia: string; acrescimo: string } | null;
  cambioOrigem: { origem: string; fonte?: string | null; cotadoEm?: string };
  frete: { valorPorKg: string; moeda: Moeda } | null;
  encargosCompra: { descricao: string; tipo: EncargoCompraForm["tipo"]; valor: string; moeda?: Moeda }[];
  venda: {
    precoUnitarioBrl: string | null;
    marketplace: { canal: Canal; modalidade: Modalidade; parcelas: number | null; percentual: string | null } | null;
    notaFiscal: { modo: NotaModo; percentual?: string; baseUnitariaBrl?: string; valorUnitarioBrl?: string };
    outrosEncargos: EncargoVendaForm[];
  };
  markupAlertaPercentual: string;
  parametroEconomicoId: string | null;
  produto: { id: string | null; nome: string; codigo: number | null };
};

const NUMBER = /^\d+([.,]\d+)?$/;
const num = (value: string) => value.trim().replace(",", ".");
const valid = (value: string) => NUMBER.test(value.trim());

export function initialForm(settings: SettingsResponse, quote: CotacaoVigente | null): SimForm {
  const v = settings.vigente;
  const notaModo: NotaModo =
    v?.notaFiscalBase === "VENDA_BRUTA" ? "PERCENTUAL_VENDA_BRUTA" : v?.notaFiscalBase === "BASE_INFORMADA" ? "PERCENTUAL_BASE_INFORMADA" : "BASE_PENDENTE";
  return {
    produto: null,
    itemLivre: false,
    produtoNome: "",
    quantidade: "1",
    precoCompra: "",
    moedaCompra: "USD",
    peso: "",
    cambioOrigem: quote ? "COTACAO_REGISTRADA" : "INFORMADA",
    referencia: "",
    acrescimo: v?.acrescimoCambialBrl ?? "",
    freteValor: v?.freteValorPorKg ?? "",
    freteMoeda: v?.freteMoeda ?? "",
    encargosCompra: v?.iofPercentual ? [{ descricao: "IOF", tipo: "PERCENTUAL_COMPRA", valor: v.iofPercentual, moeda: "BRL" }] : [],
    precoVenda: "",
    taxaEscolha: v?.taxasMarketplace.length ? "configurada" : "manual",
    taxaConfigurada: v?.taxasMarketplace[0] ?? null,
    // Sem parâmetro gravado, vale o markup mínimo do contrato (25%).
    parametro: { id: v?.id ?? null, markupAlertaPercentual: v?.markupAlertaPercentual ?? "25" },
    taxaManual: { canal: "MERCADO_LIVRE", modalidade: "A_VISTA", parcelas: "", percentual: "" },
    notaModo,
    notaPercentual: v?.notaFiscalPercentual ?? "",
    notaBase: "",
    notaValor: "",
    outrosEncargos: [],
    nome: ""
  };
}

/** Monta o corpo da requisição; null quando falta o mínimo ou há número inválido (o backend faz a validação final). */
export function buildPayload(form: SimForm, quote: CotacaoVigente | null) {
  const optional = (value: string) => (value.trim() === "" ? null : valid(value) ? num(value) : undefined);
  const required = (value: string) => (valid(value) ? num(value) : undefined);
  const hasItem = form.itemLivre ? form.produtoNome.trim() !== "" : form.produto !== null;
  const quantidade = Number(form.quantidade);
  if (!hasItem || !Number.isInteger(quantidade) || quantidade < 1) return null;

  const precoCompra = optional(form.precoCompra);
  const peso = optional(form.peso);
  const precoVenda = optional(form.precoVenda);
  const freteValor = optional(form.freteValor);
  if ([precoCompra, peso, precoVenda, freteValor].includes(undefined)) return null;

  let cambio: object = { origem: "SEM_COTACAO" };
  if (form.cambioOrigem === "COTACAO_REGISTRADA" && quote) cambio = { origem: "COTACAO_REGISTRADA", cotacaoCambioId: quote.id };
  if (form.cambioOrigem === "INFORMADA" && form.referencia.trim() !== "") {
    const referencia = required(form.referencia);
    const acrescimo = required(form.acrescimo || "0");
    if (!referencia || !acrescimo || Number(referencia) <= 0) return null;
    cambio = { origem: "INFORMADA", referencia, acrescimo, fonte: "Informada na simulação" };
  }

  let marketplace: object | null = null;
  if (form.taxaEscolha === "manual") {
    const { canal, modalidade } = form.taxaManual;
    const percentual = required(form.taxaManual.percentual);
    const parcelas = modalidade === "A_VISTA" ? null : Number(form.taxaManual.parcelas);
    const parcelasOk = parcelas === null || (Number.isInteger(parcelas) && parcelas >= 1);
    // Taxa ainda incompleta vai como pendência: o backend calcula o resto e aponta a falta.
    marketplace =
      percentual && parcelasOk ? { canal, modalidade, parcelas, percentual } : { canal, modalidade, parcelas: null, percentual: null };
  } else if (form.taxaEscolha === "configurada") {
    const taxa = form.taxaConfigurada;
    if (!taxa) return null;
    marketplace = { canal: taxa.canal, modalidade: taxa.modalidade, parcelas: taxa.parcelas, percentual: taxa.percentual };
  }

  let notaFiscal: object;
  if (form.notaModo === "VALOR_INFORMADO") {
    const valor = required(form.notaValor);
    if (!valor) return null;
    notaFiscal = { modo: form.notaModo, valorUnitarioBrl: valor };
  } else if (form.notaModo === "BASE_PENDENTE") notaFiscal = { modo: form.notaModo };
  else {
    const percentual = required(form.notaPercentual);
    if (!percentual) return null;
    if (form.notaModo === "PERCENTUAL_BASE_INFORMADA") {
      const base = required(form.notaBase);
      if (!base) return null;
      notaFiscal = { modo: form.notaModo, percentual, baseUnitariaBrl: base };
    } else notaFiscal = { modo: form.notaModo, percentual };
  }

  const encargosCompra = form.encargosCompra.map((encargo) => ({
    descricao: encargo.descricao.trim() || "Encargo",
    tipo: encargo.tipo,
    valor: required(encargo.valor),
    ...(encargo.tipo === "PERCENTUAL_COMPRA" ? {} : { moeda: encargo.moeda })
  }));
  const outrosEncargos = form.outrosEncargos.map((encargo) => ({
    descricao: encargo.descricao.trim() || "Encargo",
    tipo: encargo.tipo,
    valor: required(encargo.valor)
  }));
  if ([...encargosCompra, ...outrosEncargos].some((encargo) => !encargo.valor)) return null;

  return {
    nome: form.nome.trim() || null,
    produtoId: form.itemLivre ? null : form.produto!.id,
    produtoNome: form.itemLivre ? form.produtoNome.trim() : null,
    quantidade,
    compra: { precoUnitario: precoCompra, moeda: form.moedaCompra },
    pesoUnitarioKg: peso,
    cambio,
    frete: freteValor === null || !form.freteMoeda ? null : { valorPorKg: freteValor, moeda: form.freteMoeda },
    encargosCompra,
    venda: { precoUnitarioBrl: precoVenda, marketplace, notaFiscal, outrosEncargos },
    markupAlertaPercentual: form.parametro.markupAlertaPercentual,
    parametroEconomicoId: form.parametro.id
  };
}

const productPrice = (produto: Produto | null) => (produto && Number(produto.precoVenda) > 0 ? produto.precoVenda : "");

/**
 * Peso e preço de venda vêm do cadastro quando o campo está vazio ou ainda tem o valor trazido do
 * produto anterior; o que o operador digitou é preservado.
 */
export function withProduct(current: SimForm, produto: Produto | null): SimForm {
  const previous = current.produto;
  const fromPrevious = (value: string, previousValue: string) => value === "" || value === previousValue;
  return {
    ...current,
    produto,
    peso: fromPrevious(current.peso, previous?.peso ?? "") ? produto?.peso ?? "" : current.peso,
    precoVenda: fromPrevious(current.precoVenda, productPrice(previous)) ? productPrice(produto) : current.precoVenda
  };
}

function formFromSaved(entrada: SavedEntrada, current: SimForm): SimForm {
  const nota = entrada.venda.notaFiscal;
  const marketplace = entrada.venda.marketplace;
  return {
    ...current,
    produto: entrada.produto.id ? { id: entrada.produto.id, nome: entrada.produto.nome, codigo: entrada.produto.codigo ?? 0, peso: null, precoVenda: "0" } : null,
    itemLivre: !entrada.produto.id,
    produtoNome: entrada.produto.id ? "" : entrada.produto.nome,
    quantidade: String(entrada.quantidade),
    precoCompra: entrada.compra.precoUnitario ?? "",
    moedaCompra: entrada.compra.moeda,
    peso: entrada.pesoUnitarioKg ?? "",
    // Reabre com a cotação que a simulação usou, informada explicitamente.
    cambioOrigem: "INFORMADA",
    referencia: entrada.cambio?.referencia ?? "",
    acrescimo: entrada.cambio?.acrescimo ?? "",
    freteValor: entrada.frete?.valorPorKg ?? "",
    freteMoeda: entrada.frete?.moeda ?? "",
    encargosCompra: entrada.encargosCompra.map((encargo) => ({ ...encargo, moeda: encargo.moeda ?? "BRL" })),
    precoVenda: entrada.venda.precoUnitarioBrl ?? "",
    taxaEscolha: marketplace ? "manual" : "nenhuma",
    taxaManual: marketplace
      ? { canal: marketplace.canal, modalidade: marketplace.modalidade, parcelas: marketplace.parcelas ? String(marketplace.parcelas) : "", percentual: marketplace.percentual ?? "" }
      : current.taxaManual,
    notaModo: nota.modo,
    notaPercentual: nota.percentual ?? "",
    notaBase: nota.baseUnitariaBrl ?? "",
    notaValor: nota.valorUnitarioBrl ?? "",
    outrosEncargos: entrada.venda.outrosEncargos,
    parametro: { id: entrada.parametroEconomicoId, markupAlertaPercentual: entrada.markupAlertaPercentual },
    nome: ""
  };
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card component="section" aria-label={title}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} mb={1.5}>
          <Typography component="h2" variant="h6">{title}</Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

const grid = (columns: object) => ({ display: "grid", gap: 1.25, gridTemplateColumns: columns, alignItems: "start" });

function EstimateBadge() {
  return (
    <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: "6px", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", color: visualTokens.amber, bgcolor: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
      ESTIMATIVA
    </Box>
  );
}

/** Apresenta o resultado calculado pelo backend: nenhuma conta é refeita aqui. */
export function ResultView({ resultado }: { resultado: ProjecaoResultado }) {
  const r = resultado;
  const row = (label: string, key: keyof ProjecaoResultado["porUnidade"], options: { strong?: boolean; minus?: boolean; detail?: string } = {}) => (
    <TableRow key={key}>
      <TableCell sx={{ fontWeight: options.strong ? 700 : 400, pl: options.minus ? 3 : undefined }}>
        {options.minus ? "− " : ""}{label}
        {options.detail && <Typography component="span" sx={{ display: "block", fontSize: "0.6875rem", color: visualTokens.textMuted }}>{options.detail}</Typography>}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: fontMono, fontWeight: options.strong ? 700 : 400 }}>{brl(r.porUnidade[key])}</TableCell>
      <TableCell align="right" sx={{ fontFamily: fontMono, fontWeight: options.strong ? 700 : 400 }}>{brl(r.total[key])}</TableCell>
    </TableRow>
  );
  const nota = r.composicao.notaFiscal;
  const notaDetail =
    nota.modo === "PERCENTUAL_VENDA_BRUTA"
      ? `${percent(nota.percentual)} sobre o preço de venda bruto`
      : nota.modo === "PERCENTUAL_BASE_INFORMADA"
        ? `${percent(nota.percentual)} sobre a base informada de ${brl(nota.baseUnitaria)}`
        : nota.modo === "VALOR_INFORMADO"
          ? "valor estimado informado"
          : "base de incidência a definir";
  const ind = r.indicadores;
  return (
    <Stack gap={1.5}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <EstimateBadge />
        <Typography variant="body2" color="text.secondary">Projeção em reais. Não cria compra, venda, estoque nem pagamento.</Typography>
      </Stack>
      {r.status === "INCOMPLETO" && (
        <Box role="status" sx={{ p: 1.25, borderRadius: "8px", bgcolor: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)" }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: visualTokens.amber }}>Resultado incompleto</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {r.pendencias.map((pendencia) => <Typography component="li" variant="body2" key={pendencia.campo}>{pendencia.motivo}</Typography>)}
          </Box>
        </Box>
      )}
      {r.cambio && (
        <Typography variant="body2" sx={{ fontFamily: fontMono }}>
          Câmbio USD→BRL: {rate(r.cambio.referencia)} + {rate(r.cambio.acrescimo)} = {rate(r.cambio.operacional)}
        </Typography>
      )}
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label="Composição dos valores">
          <TableHead>
            <TableRow>
              <TableCell>Composição</TableCell>
              <TableCell align="right">Por unidade</TableCell>
              <TableCell align="right">Total ({r.quantidade} un.)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {row("Compra", "compra")}
            {row("Frete", "frete", { detail: r.pesoTotalKg ? `${Number(r.pesoTotalKg).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg no total` : undefined })}
            {row("Encargos de compra", "encargosCompra", { detail: r.composicao.encargosCompra.map((e) => `${e.descricao}: ${brl(e.porUnidade)}/un.`).join(" · ") || undefined })}
            {row("Custo total", "custo", { strong: true })}
            {row("Venda bruta projetada", "vendaBruta")}
            {row("Taxa do marketplace", "taxaMarketplace", { minus: true })}
            {row("Nota fiscal de saída", "notaFiscal", { minus: true, detail: notaDetail })}
            {row("Outros encargos de venda", "outrosEncargosVenda", { minus: true, detail: r.composicao.outrosEncargosVenda.map((e) => e.descricao).join(" · ") || undefined })}
            {row("Receita líquida projetada", "receitaLiquida", { strong: true })}
            {row("Lucro projetado", "lucro", { strong: true })}
          </TableBody>
        </Table>
      </Box>
      <Box sx={grid({ xs: "1fr 1fr", md: "repeat(4, 1fr)" })}>
        {[
          ["Markup", ind.markupPercentual, "(preço de venda − custo) ÷ custo"],
          ["Margem", ind.margemPercentual, "(preço de venda − custo) ÷ preço de venda"],
          ["Resultado sobre a venda", ind.resultadoSobreVendaPercentual, "lucro projetado ÷ venda bruta"],
          ["Resultado sobre o custo", ind.resultadoSobreCustoPercentual, "lucro projetado ÷ custo"]
        ].map(([label, value, definition]) => (
          <Box key={label} sx={{ p: 1.25, borderRadius: "8px", bgcolor: visualTokens.bg, border: `1px solid ${visualTokens.border}` }}>
            <Typography sx={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: visualTokens.textMuted }}>{label}</Typography>
            <Typography sx={{ fontFamily: fontMono, fontSize: "1.1rem", fontWeight: 600 }}>{ind.precoVendaDefinido ? percent(value) : "A definir"}</Typography>
            <Typography sx={{ fontSize: "0.6875rem", color: visualTokens.textSecondary }}>{definition}</Typography>
          </Box>
        ))}
      </Box>
      {ind.abaixoDoLimite && (
        <Typography role="alert" variant="body2" sx={{ color: visualTokens.red, fontWeight: 600 }}>
          Markup abaixo do limite de {percent(ind.limiteMarkupPercentual)} configurado.
        </Typography>
      )}
    </Stack>
  );
}

function ProductPicker({ store, value, onChange }: { store: string; value: Produto | null; onChange: (produto: Produto | null) => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);
  const search = useQuery<{ items: Produto[] }>({
    queryKey: economicQueryKeys.productSearch(store, debounced),
    enabled: debounced.length >= 2,
    queryFn: async () =>
      (await api.get("/products", { headers: { ...authHeader(), "x-store-id": store }, params: { search: debounced, ativo: "true", limit: 20 } })).data
  });
  return (
    <Autocomplete
      value={value}
      onChange={(_, produto) => onChange(produto)}
      inputValue={term}
      onInputChange={(_, text) => setTerm(text)}
      options={search.data?.items ?? []}
      filterOptions={(options) => options}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      getOptionLabel={(option) => option.nome}
      loading={search.isFetching}
      noOptionsText={debounced.length < 2 ? "Digite ao menos 2 letras" : search.isError ? "Não foi possível buscar" : "Nenhum produto encontrado"}
      loadingText="Buscando…"
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.nome}</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary }}>
              Cód. {option.codigo}
              {option.categoria ? ` · ${option.categoria.nome}` : ""}
              {option.peso ? ` · ${Number(option.peso).toLocaleString("pt-BR")} kg` : ""}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} size="small" label="Produto" placeholder="Busque pelo nome, ex.: Mac" />}
    />
  );
}

function SimulatorForm({
  store,
  settings,
  quote,
  canSave,
  canSearch,
  loaded,
  onSaved
}: {
  store: string;
  settings: SettingsResponse;
  quote: CotacaoVigente | null;
  canSave: boolean;
  canSearch: boolean;
  loaded: SavedEntrada | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SimForm>(() => {
    const base = initialForm(settings, quote);
    return loaded ? formFromSaved(loaded, base) : { ...base, itemLivre: !canSearch };
  });
  const set = <K extends keyof SimForm>(key: K, value: SimForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const payload = useMemo(() => buildPayload(form, quote), [form, quote]);
  const payloadText = payload ? JSON.stringify(payload) : "";
  const [debounced, setDebounced] = useState(payloadText);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(payloadText), 350);
    return () => clearTimeout(timer);
  }, [payloadText]);
  const headers = { ...authHeader(), "x-store-id": store };
  const calculation = useQuery<{ resultado: ProjecaoResultado }>({
    queryKey: economicQueryKeys.calculation(store, debounced),
    enabled: debounced !== "",
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.post("/purchase-simulations/calculate", JSON.parse(debounced), { headers })).data
  });
  // A chave acompanha o conteúdo: repetir o mesmo envio não duplica; mudar o cenário gera nova chave.
  const saveKey = useRef<{ payload: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (saveKey.current?.payload !== payloadText) saveKey.current = { payload: payloadText, key: crypto.randomUUID() };
      return api.post("/purchase-simulations", JSON.parse(payloadText), { headers: { ...headers, "Idempotency-Key": saveKey.current.key } });
    },
    onSuccess: onSaved
  });
  const v = settings.vigente;
  // Opções da versão vigente mais a taxa já escolhida, mesmo que tenha saído da versão nova.
  const taxaOptions = [
    ...(v?.taxasMarketplace ?? []),
    ...(form.taxaConfigurada && !v?.taxasMarketplace.some((taxa) => taxa.id === form.taxaConfigurada!.id) ? [form.taxaConfigurada] : [])
  ];
  const stale = payloadText !== debounced || calculation.isFetching;

  return (
    <Box sx={grid({ xs: "1fr", lg: "minmax(0, 1.05fr) minmax(0, 1fr)" })}>
      <Stack gap={1.5}>
        <Panel title="Produto e quantidade">
          <Stack gap={1.25}>
            {form.itemLivre ? (
              <TextField size="small" label="Nome do item" value={form.produtoNome} onChange={(event) => set("produtoNome", event.target.value)} />
            ) : (
              <ProductPicker
                store={store}
                value={form.produto}
                onChange={(produto) => setForm((current) => withProduct(current, produto))}
              />
            )}
            {canSearch ? (
              <Box>
                <Button size="small" onClick={() => setForm((current) => ({ ...current, itemLivre: !current.itemLivre, produto: null, produtoNome: "" }))}>
                  {form.itemLivre ? "Escolher produto do catálogo" : "Item ainda sem cadastro"}
                </Button>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">Sem acesso ao catálogo: informe o nome do item.</Typography>
            )}
            <Box sx={grid({ xs: "1fr 1fr", sm: "repeat(4, 1fr)" })}>
              <TextField size="small" label="Quantidade" value={form.quantidade} inputMode="numeric" onChange={(event) => set("quantidade", event.target.value)} />
              <TextField size="small" label="Preço unitário de compra" value={form.precoCompra} inputMode="decimal" error={form.precoCompra !== "" && !valid(form.precoCompra)}
                onChange={(event) => set("precoCompra", event.target.value)} />
              <TextField size="small" select label="Moeda da compra" value={form.moedaCompra} onChange={(event) => set("moedaCompra", event.target.value as Moeda)}>
                <MenuItem value="USD">US$</MenuItem>
                <MenuItem value="BRL">R$</MenuItem>
              </TextField>
              <TextField size="small" label="Peso unitário (kg)" value={form.peso} inputMode="decimal" error={form.peso !== "" && !valid(form.peso)}
                onChange={(event) => set("peso", event.target.value)} />
            </Box>
          </Stack>
        </Panel>

        <Panel title="Câmbio e frete">
          <Stack gap={1.25}>
            <TextField size="small" select label="Cotação USD→BRL" value={form.cambioOrigem} onChange={(event) => set("cambioOrigem", event.target.value as SimForm["cambioOrigem"])}>
              <MenuItem value="COTACAO_REGISTRADA" disabled={!quote}>
                {quote ? `Vigente: ${rate(quote.referencia)} + ${rate(quote.acrescimo)} = ${rate(quote.operacional)}` : "Nenhuma cotação registrada"}
              </MenuItem>
              <MenuItem value="INFORMADA">Informar cotação nesta simulação</MenuItem>
            </TextField>
            {form.cambioOrigem === "COTACAO_REGISTRADA" && quote && (
              <Typography sx={{ fontSize: "0.75rem", color: quote.condicao === "ANTIGA" ? visualTokens.amber : visualTokens.textSecondary }}>
                {quote.fonte ?? "Fonte não informada"} · {new Date(quote.cotadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                {quote.condicao === "ANTIGA" ? ` · cotação antiga (${quote.idadeDias} dias)` : ""}
              </Typography>
            )}
            {form.cambioOrigem === "INFORMADA" && (
              <Box sx={grid({ xs: "1fr 1fr" })}>
                <TextField size="small" label="Referência (R$ por US$)" value={form.referencia} inputMode="decimal" onChange={(event) => set("referencia", event.target.value)} />
                <TextField size="small" label="Acréscimo (R$)" value={form.acrescimo} inputMode="decimal" onChange={(event) => set("acrescimo", event.target.value)} />
              </Box>
            )}
            <Box sx={grid({ xs: "1fr 1fr" })}>
              <TextField size="small" label="Frete por kg" value={form.freteValor} inputMode="decimal" error={form.freteValor !== "" && !valid(form.freteValor)}
                onChange={(event) => set("freteValor", event.target.value)} />
              <TextField size="small" select label="Moeda do frete" value={form.freteMoeda} onChange={(event) => set("freteMoeda", event.target.value as Moeda)}>
                <MenuItem value="USD">US$ por kg</MenuItem>
                <MenuItem value="BRL">R$ por kg</MenuItem>
              </TextField>
            </Box>
            <EncargoList<EncargoCompraForm>
              title="Encargos de compra"
              items={form.encargosCompra}
              onChange={(items) => set("encargosCompra", items)}
              empty={{ descricao: "", tipo: "VALOR_UNIDADE", valor: "", moeda: "USD" }}
              tipos={[["PERCENTUAL_COMPRA", "% sobre a compra"], ["VALOR_UNIDADE", "Valor por unidade"], ["VALOR_TOTAL", "Valor total do lote"]]}
              withCurrency
            />
          </Stack>
        </Panel>

        <Panel title="Venda projetada">
          <Stack gap={1.25}>
            <Box sx={grid({ xs: "1fr", sm: "1fr 1.4fr" })}>
              <TextField size="small" label="Preço unitário de venda (R$)" value={form.precoVenda} inputMode="decimal" error={form.precoVenda !== "" && !valid(form.precoVenda)}
                onChange={(event) => set("precoVenda", event.target.value)} />
              <TextField
                size="small"
                select
                label="Taxa do marketplace"
                value={form.taxaEscolha === "configurada" && form.taxaConfigurada ? `cfg:${form.taxaConfigurada.id}` : form.taxaEscolha}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value.startsWith("cfg:")) return setForm((current) => ({ ...current, taxaEscolha: value as SimForm["taxaEscolha"] }));
                  const id = value.slice(4);
                  setForm((current) => ({
                    ...current,
                    taxaEscolha: "configurada",
                    taxaConfigurada: taxaOptions.find((taxa) => taxa.id === id) ?? current.taxaConfigurada
                  }));
                }}
              >
                {taxaOptions.map((taxa) => (
                  <MenuItem key={taxa.id} value={`cfg:${taxa.id}`}>
                    {canalLabel[taxa.canal]} · {modalidadeLabel(taxa.modalidade, taxa.parcelas)} · {percent(taxa.percentual)}
                    {v?.taxasMarketplace.some((current) => current.id === taxa.id) ? "" : " (versão anterior)"}
                  </MenuItem>
                ))}
                <MenuItem value="manual">Informar taxa nesta simulação</MenuItem>
                <MenuItem value="nenhuma">Sem taxa de canal</MenuItem>
              </TextField>
            </Box>
            {form.taxaEscolha === "manual" && (
              <Box sx={grid({ xs: "1fr 1fr", sm: "repeat(4, 1fr)" })}>
                <TextField size="small" select label="Canal" value={form.taxaManual.canal} onChange={(event) => set("taxaManual", { ...form.taxaManual, canal: event.target.value as Canal })}>
                  {(Object.keys(canalLabel) as Canal[]).map((canal) => <MenuItem key={canal} value={canal}>{canalLabel[canal]}</MenuItem>)}
                </TextField>
                <TextField size="small" select label="Modalidade" value={form.taxaManual.modalidade}
                  onChange={(event) => set("taxaManual", { ...form.taxaManual, modalidade: event.target.value as Modalidade, parcelas: "" })}>
                  <MenuItem value="A_VISTA">À vista</MenuItem>
                  <MenuItem value="PARCELADO">Parcelado</MenuItem>
                </TextField>
                <TextField size="small" label="Parcelas" value={form.taxaManual.parcelas} disabled={form.taxaManual.modalidade === "A_VISTA"}
                  onChange={(event) => set("taxaManual", { ...form.taxaManual, parcelas: event.target.value })} />
                <TextField size="small" label="Taxa (%)" value={form.taxaManual.percentual}
                  onChange={(event) => set("taxaManual", { ...form.taxaManual, percentual: event.target.value })} />
              </Box>
            )}
            <Box sx={grid({ xs: "1fr", sm: "1.4fr 1fr 1fr" })}>
              <TextField size="small" select label="Nota fiscal de saída" value={form.notaModo} onChange={(event) => set("notaModo", event.target.value as NotaModo)}>
                <MenuItem value="PERCENTUAL_VENDA_BRUTA">% sobre o preço de venda bruto</MenuItem>
                <MenuItem value="PERCENTUAL_BASE_INFORMADA">% sobre uma base informada</MenuItem>
                <MenuItem value="VALOR_INFORMADO">Valor estimado da nota</MenuItem>
                <MenuItem value="BASE_PENDENTE">Base ainda não definida</MenuItem>
              </TextField>
              {(form.notaModo === "PERCENTUAL_VENDA_BRUTA" || form.notaModo === "PERCENTUAL_BASE_INFORMADA") && (
                <TextField size="small" label="Nota (%)" value={form.notaPercentual} onChange={(event) => set("notaPercentual", event.target.value)} />
              )}
              {form.notaModo === "PERCENTUAL_BASE_INFORMADA" && (
                <TextField size="small" label="Base por unidade (R$)" value={form.notaBase} onChange={(event) => set("notaBase", event.target.value)} />
              )}
              {form.notaModo === "VALOR_INFORMADO" && (
                <TextField size="small" label="Valor por unidade (R$)" value={form.notaValor} onChange={(event) => set("notaValor", event.target.value)} />
              )}
            </Box>
            <EncargoList<EncargoVendaForm>
              title="Outros encargos de venda"
              items={form.outrosEncargos}
              onChange={(items) => set("outrosEncargos", items)}
              empty={{ descricao: "", tipo: "VALOR_UNIDADE", valor: "" }}
              tipos={[["PERCENTUAL_VENDA_BRUTA", "% sobre a venda bruta"], ["VALOR_UNIDADE", "R$ por unidade"], ["VALOR_TOTAL", "R$ total do lote"]]}
            />
          </Stack>
        </Panel>
      </Stack>

      <Stack gap={1.5}>
        <Panel title="Resultado projetado" action={stale && calculation.data ? <Typography variant="body2" color="text.secondary" role="status">Atualizando…</Typography> : undefined}>
          {!payload && <Typography variant="body2" color="text.secondary">Escolha o produto e a quantidade e confira os valores numéricos para ver a projeção.</Typography>}
          {payload && calculation.isLoading && <Typography variant="body2" role="status">Calculando…</Typography>}
          {payload && calculation.isError && <Typography variant="body2" role="alert">Não foi possível calcular. Revise os campos e tente novamente.</Typography>}
          {payload && calculation.data && <ResultView resultado={calculation.data.resultado} />}
        </Panel>
        {canSave && (
          <Panel title="Salvar simulação">
            <Stack direction={{ xs: "column", sm: "row" }} gap={1} alignItems={{ sm: "center" }}>
              <TextField size="small" label="Nome (opcional)" value={form.nome} onChange={(event) => set("nome", event.target.value)} sx={{ flex: 1 }} />
              <Button variant="contained" disabled={!payload || save.isPending} onClick={() => save.mutate()}>Salvar simulação</Button>
            </Stack>
            <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary, mt: 1 }}>
              Guarda os valores, a cotação e a versão dos parâmetros usados. Mudanças futuras nas configurações não alteram a simulação salva.
            </Typography>
            <MutationStatus mutation={save} successMessage="Simulação salva." />
          </Panel>
        )}
      </Stack>
    </Box>
  );
}

function EncargoList<T extends { descricao: string; tipo: string; valor: string; moeda?: Moeda }>({
  title,
  items,
  onChange,
  empty,
  tipos,
  withCurrency
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  empty: T;
  tipos: [string, string][];
  withCurrency?: boolean;
}) {
  const update = (index: number, patch: Partial<T>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <Stack gap={0.75}>
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: visualTokens.textSecondary }}>{title}</Typography>
      {items.map((item, index) => (
        <Box key={index} sx={grid({ xs: "1fr 1fr", sm: withCurrency ? "1.3fr 1.3fr 0.8fr 0.7fr auto" : "1.3fr 1.3fr 0.8fr auto" })}>
          <TextField size="small" label="Descrição" value={item.descricao} onChange={(event) => update(index, { descricao: event.target.value } as Partial<T>)} />
          <TextField size="small" select label="Tipo" value={item.tipo} onChange={(event) => update(index, { tipo: event.target.value } as Partial<T>)}>
            {tipos.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Valor" value={item.valor} inputMode="decimal" error={item.valor !== "" && !valid(item.valor)}
            onChange={(event) => update(index, { valor: event.target.value } as Partial<T>)} />
          {withCurrency && (
            <TextField size="small" select label="Moeda" value={item.moeda ?? "BRL"} disabled={item.tipo.startsWith("PERCENTUAL")}
              onChange={(event) => update(index, { moeda: event.target.value as Moeda } as Partial<T>)}>
              <MenuItem value="USD">US$</MenuItem>
              <MenuItem value="BRL">R$</MenuItem>
            </TextField>
          )}
          <IconButton aria-label={`Remover ${title.toLowerCase()} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>×</IconButton>
        </Box>
      ))}
      <Box>
        <Button size="small" onClick={() => onChange([...items, { ...empty }])}>Adicionar</Button>
      </Box>
    </Stack>
  );
}

function SavedList({ store, onOpen }: { store: string; onOpen: (id: string) => void }) {
  const saved = useQuery<SavedSimulation[]>({
    queryKey: economicQueryKeys.simulations(store),
    queryFn: async () => (await api.get("/purchase-simulations", { headers: { ...authHeader(), "x-store-id": store } })).data
  });
  return (
    <Panel title="Simulações salvas">
      {saved.isLoading && <Typography variant="body2" role="status">Carregando…</Typography>}
      {saved.isError && <Typography variant="body2" role="alert">Não foi possível carregar as simulações salvas.</Typography>}
      {saved.data?.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma simulação salva nesta loja.</Typography>}
      {!!saved.data?.length && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label="Simulações salvas">
            <TableHead>
              <TableRow>
                <TableCell>Simulação</TableCell>
                <TableCell align="right">Custo total</TableCell>
                <TableCell align="right">Lucro projetado</TableCell>
                <TableCell>Salva em</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {saved.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.nome}
                    <Typography sx={{ fontSize: "0.6875rem", color: visualTokens.textMuted }}>{item.produtoNome}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: fontMono }}>{brl(item.resultado.total.custo)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: fontMono }}>
                    {item.resultado.status === "INCOMPLETO" && item.resultado.total.lucro === null ? "Incompleto" : brl(item.resultado.total.lucro)}
                  </TableCell>
                  <TableCell>{new Date(item.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</TableCell>
                  <TableCell><Button size="small" onClick={() => onOpen(item.id)}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Panel>
  );
}

function SimulatorContent() {
  const { activeStoreId: store, stores, permissions } = useAuthStore();
  const client = useQueryClient();
  const can = (...codes: string[]) => permissions.includes("SYSTEM_ADMIN") || codes.some((code) => permissions.includes(code));
  const headers = { ...authHeader(), "x-store-id": store };
  const settings = useQuery<SettingsResponse>({
    queryKey: economicQueryKeys.settings(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/economic-settings", { headers })).data
  });
  const quote = useQuery<{ cotacao: CotacaoVigente | null }>({
    queryKey: economicQueryKeys.exchangeRate(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/economic-settings/exchange-rate", { headers })).data
  });
  const [opened, setOpened] = useState<SavedDetail | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const open = useMutation({
    mutationFn: async (id: string) => (await api.get(`/purchase-simulations/${id}`, { headers })).data as SavedDetail,
    onSuccess: (detail) => setOpened(detail)
  });
  const activeStore = stores.find((s) => s.id === store);
  const ready = settings.data && quote.data && store;
  return (
    <Stack gap={2}>
      <Box>
        <Stack direction="row" gap={1} alignItems="center">
          <Typography variant="h4" component="h1">Simulador de compra</Typography>
          <EstimateBadge />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Loja {activeStore?.nome ?? "—"}. Quanto custa trazer, por quanto vender e qual resultado esperar. Simular não cria compra, estoque, venda nem pagamento.
        </Typography>
      </Box>
      {(settings.isLoading || quote.isLoading) && <Typography variant="body2" role="status">Carregando parâmetros e cotação…</Typography>}
      {(settings.isError || quote.isError) && <Typography variant="body2" role="alert">Não foi possível carregar os parâmetros ou a cotação.</Typography>}
      {settings.data && !settings.data.vigente && (
        <Typography variant="body2" sx={{ color: visualTokens.amber }}>
          Nenhum parâmetro econômico gravado nesta loja: informe frete, taxas e nota nos campos ou grave-os em Configurações econômicas.
        </Typography>
      )}
      {ready && (
        <SimulatorForm
          key={formVersion}
          store={store}
          settings={settings.data!}
          quote={quote.data!.cotacao}
          canSave={can("SIMULACAO_GERENCIAR")}
          canSearch={can("CATALOGO_VISUALIZAR")}
          loaded={formVersion > 0 && opened ? opened.entrada : null}
          onSaved={() => client.invalidateQueries({ queryKey: economicQueryKeys.simulations(store) })}
        />
      )}
      {opened && (
        <Panel
          title={`Simulação salva: ${opened.nome}`}
          action={
            <Stack direction="row" gap={1}>
              <Button size="small" onClick={() => setFormVersion((value) => value + 1)}>Usar como base</Button>
              <Button size="small" onClick={() => setOpened(null)}>Fechar</Button>
            </Stack>
          }
        >
          <Typography variant="body2" color="text.secondary" mb={1}>
            {opened.produtoNome} · salva em {new Date(opened.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} por {opened.criadoPor.name}.
            Resultado e parâmetros preservados da data em que foi salva.
            {opened.entrada.cambioOrigem.fonte ? ` Câmbio: ${opened.entrada.cambioOrigem.fonte}.` : ""}
          </Typography>
          <ResultView resultado={opened.resultado} />
        </Panel>
      )}
      <MutationStatus mutation={open} successMessage="" loadingMessage="Abrindo simulação…" />
      {store && <SavedList store={store} onOpen={(id) => open.mutate(id)} />}
    </Stack>
  );
}

export function PurchaseSimulatorPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  return (
    <PageContainer>
      <SimulatorContent key={store} />
    </PageContainer>
  );
}
