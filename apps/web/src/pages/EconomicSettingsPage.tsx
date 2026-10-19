import { useRef, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { PageContainer } from "../components/ui/PageContainer";
import { MutationStatus } from "../components/ui/MutationStatus";
import { economicQueryKeys } from "../queryKeys";
import { fontMono, visualTokens } from "../theme";
import {
  canalLabel,
  rate,
  type Canal,
  type CotacaoVigente,
  type Modalidade,
  type Moeda,
  type NotaFiscalBase,
  type SettingsResponse
} from "../api/economic";

type TaxaForm = { canal: Canal | ""; modalidade: Modalidade; parcelas: string; percentual: string; descricao: string; nota?: string };
type FormState = {
  acrescimoCambialBrl: string;
  freteValorPorKg: string;
  freteMoeda: Moeda | "";
  markupAlertaPercentual: string;
  notaFiscalPercentual: string;
  notaFiscalBase: NotaFiscalBase | "";
  iofPercentual: string;
  observacoes: string;
  taxas: TaxaForm[];
};

// Vigente quando existir; senão, as referências informadas pelo PO como ponto de partida (ainda não gravadas).
function initialForm(data: SettingsResponse): FormState {
  const v = data.vigente;
  if (v)
    return {
      acrescimoCambialBrl: v.acrescimoCambialBrl,
      freteValorPorKg: v.freteValorPorKg ?? "",
      freteMoeda: v.freteMoeda ?? "",
      markupAlertaPercentual: v.markupAlertaPercentual,
      notaFiscalPercentual: v.notaFiscalPercentual ?? "",
      notaFiscalBase: v.notaFiscalBase ?? "",
      iofPercentual: v.iofPercentual ?? "",
      observacoes: v.observacoes ?? "",
      taxas: v.taxasMarketplace.map((taxa) => ({
        canal: taxa.canal,
        modalidade: taxa.modalidade,
        parcelas: taxa.parcelas === null ? "" : String(taxa.parcelas),
        percentual: taxa.percentual,
        descricao: taxa.descricao ?? ""
      }))
    };
  const ref = data.referenciasPO;
  return {
    acrescimoCambialBrl: ref.acrescimoCambialBrl,
    freteValorPorKg: "",
    freteMoeda: "",
    markupAlertaPercentual: ref.markupAlertaPercentual,
    notaFiscalPercentual: ref.notaFiscalPercentual,
    notaFiscalBase: "",
    iofPercentual: "",
    observacoes: "",
    taxas: ref.taxas.map((taxa) => ({
      canal: "",
      modalidade: taxa.modalidade,
      parcelas: taxa.parcelas === null ? "" : String(taxa.parcelas),
      percentual: taxa.percentual,
      descricao: "",
      nota: taxa.observacao
    }))
  };
}

/**
 * Chave de idempotência ligada ao conteúdo: repetir o mesmo envio (resposta perdida) recupera o
 * resultado gravado; editar e reenviar usa chave nova em vez de cair em conflito.
 */
function useContentKey() {
  const ref = useRef<{ content: string; key: string } | null>(null);
  return (content: unknown) => {
    const text = JSON.stringify(content);
    if (ref.current?.content !== text) ref.current = { content: text, key: crypto.randomUUID() };
    return ref.current.key;
  };
}

const textOrNull = (value: string) => (value.trim() === "" ? null : value.trim());
// Vírgula decimal só em números; texto livre é gravado como digitado.
const orNull = (value: string) => textOrNull(value)?.replace(",", ".") ?? null;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card component="section" aria-label={title}>
      <CardContent sx={{ p: 2.25, "&:last-child": { pb: 2.25 } }}>
        <Typography component="h2" variant="h6">{title}</Typography>
        {description && <Typography variant="body2" color="text.secondary" mt={0.25} mb={1.5}>{description}</Typography>}
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: visualTokens.textMuted }}>{label}</Typography>
      <Typography sx={{ fontFamily: fontMono, fontSize: "0.95rem", fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

function ExchangeSection({ store, canWrite, acrescimoPadrao }: { store: string; canWrite: boolean; acrescimoPadrao: string | null }) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const quote = useQuery<{ cotacao: CotacaoVigente | null }>({
    queryKey: economicQueryKeys.exchangeRate(store),
    queryFn: async () => (await api.get("/economic-settings/exchange-rate", { headers })).data
  });
  const ptaxKey = useRef<string | null>(null);
  const ptax = useMutation({
    mutationFn: async () => {
      ptaxKey.current ??= crypto.randomUUID();
      return (await api.post("/economic-settings/exchange-rate/ptax", {}, { headers: { ...headers, "Idempotency-Key": ptaxKey.current } })).data as {
        jaRegistrada: boolean;
      };
    },
    onSuccess: () => {
      ptaxKey.current = null;
      return client.invalidateQueries({ queryKey: economicQueryKeys.exchangeRate(store) });
    }
  });
  const [manual, setManual] = useState({ referencia: "", acrescimo: acrescimoPadrao ?? "", fonte: "", cotadoEm: "" });
  const manualKey = useContentKey();
  const register = useMutation({
    mutationFn: async () => {
      const body = {
        moedaOrigem: "USD",
        moedaDestino: "BRL",
        valorMercado: Number(manual.referencia.replace(",", ".")),
        margem: Number(manual.acrescimo.replace(",", ".")),
        fonte: manual.fonte,
        cotadoEm: new Date(manual.cotadoEm).toISOString()
      };
      return api.post("/finance/exchange-rates", body, { headers: { ...headers, "Idempotency-Key": manualKey(body) } });
    },
    onSuccess: () => {
      setManual((current) => ({ ...current, referencia: "", fonte: "", cotadoEm: "" }));
      return client.invalidateQueries({ queryKey: economicQueryKeys.exchangeRate(store) });
    }
  });
  const c = quote.data?.cotacao;
  return (
    <Section
      title="Câmbio USD → BRL"
      description="Cotação operacional = referência + acréscimo, somado uma única vez. Estimativa: não comprova a taxa efetivamente paga numa compra."
    >
      {quote.isLoading && <Typography variant="body2" role="status">Carregando cotação…</Typography>}
      {quote.isError && <Typography variant="body2" role="alert">Não foi possível carregar a cotação.</Typography>}
      {quote.data && !c && (
        <Typography variant="body2" sx={{ color: visualTokens.amber }}>Indisponível: nenhuma cotação USD→BRL registrada nesta loja.</Typography>
      )}
      {c && (
        <Stack gap={1.5}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
            <Field label="Referência" value={rate(c.referencia)} />
            <Field label="Acréscimo operacional" value={`+ ${rate(c.acrescimo)}`} />
            <Field label="Cotação operacional" value={rate(c.operacional)} />
            <Field
              label="Condição"
              value={
                <Box component="span" sx={{ color: c.condicao === "VIGENTE" ? visualTokens.green : visualTokens.amber }}>
                  {c.condicao === "VIGENTE" ? "Vigente" : `Antiga (${c.idadeDias} dias)`}
                </Box>
              }
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Fonte: {c.fonte ?? "não informada"} · cotada em {new Date(c.cotadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </Typography>
        </Stack>
      )}
      {canWrite && (
        <Stack gap={1.5} mt={2}>
          <Stack direction={{ xs: "column", sm: "row" }} gap={1} alignItems={{ sm: "center" }}>
            <Button variant="contained" onClick={() => ptax.mutate()} disabled={ptax.isPending}>
              Buscar PTAX de fechamento (Banco Central)
            </Button>
            <Typography variant="body2" color="text.secondary">
              PTAX de venda do boletim de fechamento, publicada em dias úteis por volta das 13h. É a taxa de referência do Banco Central — não é o dólar
              comercial nem a taxa cobrada pelo cartão ou pela remessa.
            </Typography>
          </Stack>
          <MutationStatus
            mutation={ptax}
            loadingMessage="Consultando o Banco Central…"
            successMessage={ptax.data?.jaRegistrada ? "Esse boletim já estava registrado." : "Cotação PTAX registrada."}
          />
          <Typography component="h3" sx={{ fontSize: "0.8125rem", fontWeight: 600, mt: 1 }}>Registrar cotação manualmente</Typography>
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              register.mutate();
            }}
            sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "1fr 1fr 2fr 1.4fr auto" }, alignItems: "start" }}
          >
            <TextField size="small" label="Referência (R$ por US$)" value={manual.referencia} required inputMode="decimal"
              onChange={(event) => setManual({ ...manual, referencia: event.target.value })} />
            <TextField size="small" label="Acréscimo (R$)" value={manual.acrescimo} required inputMode="decimal"
              onChange={(event) => setManual({ ...manual, acrescimo: event.target.value })} />
            <TextField size="small" label="Fonte" value={manual.fonte} required placeholder="Ex.: cotação do banco X"
              onChange={(event) => setManual({ ...manual, fonte: event.target.value })} />
            <TextField size="small" label="Cotada em" type="datetime-local" value={manual.cotadoEm} required
              slotProps={{ inputLabel: { shrink: true } }} onChange={(event) => setManual({ ...manual, cotadoEm: event.target.value })} />
            <Button type="submit" variant="outlined" disabled={register.isPending}>Registrar</Button>
          </Box>
          <MutationStatus mutation={register} successMessage="Cotação registrada." />
        </Stack>
      )}
    </Section>
  );
}

function SettingsForm({ data, store, canWrite }: { data: SettingsResponse; store: string; canWrite: boolean }) {
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialForm(data));
  const [dirty, setDirty] = useState(false);
  const edit = (update: (current: FormState) => FormState) => {
    setDirty(true);
    setForm(update);
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => edit((current) => ({ ...current, [key]: value }));
  const setTaxa = (index: number, patch: Partial<TaxaForm>) =>
    edit((current) => ({ ...current, taxas: current.taxas.map((taxa, i) => (i === index ? { ...taxa, ...patch } : taxa)) }));
  // Nova versão gravada por outra pessoa: sem edição local, o formulário passa a mostrá-la; com rascunho,
  // o rascunho é mantido e o aviso informa a versão nova (ajuste durante o render, sem efeito).
  const [baseId, setBaseId] = useState(data.vigente?.id ?? null);
  const [outdated, setOutdated] = useState<number | null>(null);
  const incomingId = data.vigente?.id ?? null;
  if (incomingId !== baseId) {
    setBaseId(incomingId);
    if (dirty) setOutdated(data.vigente?.versao ?? null);
    else setForm(initialForm(data));
  }
  const discardDraft = () => {
    setForm(initialForm(data));
    setDirty(false);
    setOutdated(null);
  };
  // Cliques repetidos com o mesmo conteúdo não criam versões duplicadas.
  const saveKey = useContentKey();
  const save = useMutation({
    mutationFn: async () => {
      const frete = orNull(form.freteValorPorKg);
      const body = {
          acrescimoCambialBrl: orNull(form.acrescimoCambialBrl) ?? "",
          frete: frete === null ? null : { valorPorKg: frete, moeda: form.freteMoeda },
          markupAlertaPercentual: orNull(form.markupAlertaPercentual) ?? "",
          notaFiscalPercentual: orNull(form.notaFiscalPercentual),
          notaFiscalBase: form.notaFiscalBase || null,
          iofPercentual: orNull(form.iofPercentual),
          observacoes: textOrNull(form.observacoes),
          taxasMarketplace: form.taxas.map((taxa) => ({
            canal: taxa.canal,
            modalidade: taxa.modalidade,
            parcelas: taxa.modalidade === "A_VISTA" ? null : Number(taxa.parcelas),
            percentual: orNull(taxa.percentual) ?? "",
            descricao: textOrNull(taxa.descricao)
          }))
      };
      return api.post("/economic-settings", body, { headers: { ...authHeader(), "x-store-id": store, "Idempotency-Key": saveKey(body) } });
    },
    onSuccess: () => {
      // Gravado: a versão que voltar do servidor substitui o formulário.
      setDirty(false);
      setOutdated(null);
      return client.invalidateQueries({ queryKey: economicQueryKeys.settings(store) });
    }
  });
  const disabled = !canWrite;
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap={2}>
        {outdated !== null && (
          <Box role="status" sx={{ p: 1.25, borderRadius: "8px", bgcolor: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)" }}>
            <Typography variant="body2" sx={{ color: visualTokens.amber }}>
              A versão {outdated} foi gravada enquanto você editava. Seu rascunho foi mantido; ao gravar, ele vira uma nova versão.
            </Typography>
            <Button size="small" onClick={discardDraft}>Descartar rascunho e carregar a versão vigente</Button>
          </Box>
        )}
        <Section
          title="Parâmetros de estimativa"
          description="Usados para pré-preencher o simulador. Gravar cria uma nova versão; simulações salvas guardam os valores que usaram e não são recalculadas."
        >
          {!data.vigente && (
            <Typography variant="body2" sx={{ color: visualTokens.amber, mb: 1.5 }}>
              Ainda não há parâmetros gravados. Os valores abaixo são as referências informadas pelo PO; revise e grave para ativá-los.
            </Typography>
          )}
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
            <TextField size="small" label="Acréscimo cambial (R$ por US$)" value={form.acrescimoCambialBrl} disabled={disabled} required
              onChange={(event) => set("acrescimoCambialBrl", event.target.value)} />
            <TextField size="small" label="Frete por kg" value={form.freteValorPorKg} disabled={disabled}
              helperText="Valor cobrado por kg transportado"
              onChange={(event) => set("freteValorPorKg", event.target.value)} />
            <TextField size="small" select label="Moeda do frete" value={form.freteMoeda} disabled={disabled} required={form.freteValorPorKg.trim() !== ""}
              onChange={(event) => set("freteMoeda", event.target.value as Moeda)}>
              <MenuItem value="USD">US$ por kg</MenuItem>
              <MenuItem value="BRL">R$ por kg</MenuItem>
            </TextField>
            <TextField size="small" label="Alerta de markup abaixo de (%)" value={form.markupAlertaPercentual} disabled={disabled} required
              helperText="Mínimo do contrato: 25%"
              onChange={(event) => set("markupAlertaPercentual", event.target.value)} />
            <TextField size="small" label="Nota fiscal de saída (%)" value={form.notaFiscalPercentual} disabled={disabled}
              onChange={(event) => set("notaFiscalPercentual", event.target.value)} />
            <TextField size="small" select label="Base da nota fiscal" value={form.notaFiscalBase} disabled={disabled}
              helperText={form.notaFiscalBase ? undefined : "A definir: o simulador pedirá a base"}
              onChange={(event) => set("notaFiscalBase", event.target.value as NotaFiscalBase | "")}>
              <MenuItem value="">A definir</MenuItem>
              <MenuItem value="VENDA_BRUTA">Preço de venda bruto</MenuItem>
              <MenuItem value="BASE_INFORMADA">Base informada em cada simulação</MenuItem>
            </TextField>
            <TextField size="small" label="IOF na compra (%)" value={form.iofPercentual} disabled={disabled}
              helperText="Opcional; entra como encargo de compra"
              onChange={(event) => set("iofPercentual", event.target.value)} />
            <TextField size="small" label="Observações" value={form.observacoes} disabled={disabled}
              onChange={(event) => set("observacoes", event.target.value)} />
          </Box>
        </Section>

        <Section
          title="Taxas de marketplace"
          description="Percentuais estimados por canal, modalidade e quantidade de parcelas. Não são tarifas oficiais: confirme o plano de cada canal."
        >
          <Stack gap={1}>
            {form.taxas.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma taxa cadastrada.</Typography>}
            {form.taxas.map((taxa, index) => (
              <Box key={index}>
                <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", md: "1.3fr 1fr 0.7fr 0.7fr 1.5fr auto" }, alignItems: "start" }}>
                  <TextField size="small" select label="Canal" value={taxa.canal} required disabled={disabled}
                    onChange={(event) => setTaxa(index, { canal: event.target.value as Canal })}>
                    {(Object.keys(canalLabel) as Canal[]).map((canal) => <MenuItem key={canal} value={canal}>{canalLabel[canal]}</MenuItem>)}
                  </TextField>
                  <TextField size="small" select label="Modalidade" value={taxa.modalidade} disabled={disabled}
                    onChange={(event) => setTaxa(index, { modalidade: event.target.value as Modalidade, parcelas: "" })}>
                    <MenuItem value="A_VISTA">À vista</MenuItem>
                    <MenuItem value="PARCELADO">Parcelado</MenuItem>
                  </TextField>
                  <TextField size="small" label="Parcelas" value={taxa.parcelas} disabled={disabled || taxa.modalidade === "A_VISTA"}
                    required={taxa.modalidade === "PARCELADO"} inputMode="numeric"
                    onChange={(event) => setTaxa(index, { parcelas: event.target.value })} />
                  <TextField size="small" label="Taxa (%)" value={taxa.percentual} required disabled={disabled}
                    onChange={(event) => setTaxa(index, { percentual: event.target.value })} />
                  <TextField size="small" label="Descrição" value={taxa.descricao} disabled={disabled}
                    onChange={(event) => setTaxa(index, { descricao: event.target.value })} />
                  {canWrite && (
                    <IconButton aria-label={`Remover taxa ${index + 1}`} onClick={() => set("taxas", form.taxas.filter((_, i) => i !== index))}>
                      ×
                    </IconButton>
                  )}
                </Box>
                {taxa.nota && <Typography sx={{ fontSize: "0.75rem", color: visualTokens.amber, mt: 0.5 }}>{taxa.nota}</Typography>}
              </Box>
            ))}
            {canWrite && (
              <Box>
                <Button
                  size="small"
                  onClick={() => set("taxas", [...form.taxas, { canal: "", modalidade: "A_VISTA", parcelas: "", percentual: "", descricao: "" }])}
                >
                  Adicionar taxa
                </Button>
              </Box>
            )}
          </Stack>
        </Section>

        {canWrite ? (
          <Stack direction="row" gap={1.5} alignItems="center">
            <Button type="submit" variant="contained" disabled={save.isPending}>Gravar nova versão</Button>
            <MutationStatus mutation={save} successMessage="Nova versão gravada." />
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Somente leitura: gravar parâmetros exige permissão financeira de registro.</Typography>
        )}

        {data.versoes.length > 0 && (
          <Section title="Histórico de versões">
            <Stack component="ul" gap={0.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
              {data.versoes.map((versao) => (
                <Typography component="li" key={versao.id} variant="body2" color="text.secondary">
                  Versão {versao.versao} · {new Date(versao.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {versao.criadoPor.name}
                  {versao.id === data.vigente?.id && <Box component="span" sx={{ color: visualTokens.green, ml: 1 }}>vigente</Box>}
                </Typography>
              ))}
            </Stack>
          </Section>
        )}
      </Stack>
    </Box>
  );
}

function SettingsContent() {
  const { activeStoreId: store, stores, permissions } = useAuthStore();
  const can = (code: string) => permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const canWrite = can("FINANCEIRO_REGISTRAR");
  const settings = useQuery<SettingsResponse>({
    queryKey: economicQueryKeys.settings(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/economic-settings", { headers: { ...authHeader(), "x-store-id": store } })).data
  });
  const activeStore = stores.find((s) => s.id === store);
  return (
    <Stack gap={2}>
      <Box>
        <Typography variant="h4" component="h1">Configurações econômicas</Typography>
        <Typography variant="body2" color="text.secondary">
          Parâmetros de estimativa da loja {activeStore?.nome ?? "—"}. Não alteram compras, vendas ou custos já registrados.
        </Typography>
      </Box>
      {store && settings.data && (
        // Montada após os parâmetros: o acréscimo vigente pré-preenche o registro manual. Sem key por versão,
        // para uma atualização em segundo plano não apagar um registro manual em digitação.
        <ExchangeSection
          store={store}
          canWrite={canWrite}
          acrescimoPadrao={settings.data.vigente?.acrescimoCambialBrl ?? null}
        />
      )}
      {settings.isLoading && <Typography variant="body2" role="status">Carregando parâmetros…</Typography>}
      {settings.isError && <Typography variant="body2" role="alert">Não foi possível carregar os parâmetros.</Typography>}
      {settings.data && store && (
        <SettingsForm data={settings.data} store={store} canWrite={canWrite} />
      )}
    </Stack>
  );
}

export function EconomicSettingsPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  return (
    <PageContainer>
      <SettingsContent key={store} />
    </PageContainer>
  );
}

