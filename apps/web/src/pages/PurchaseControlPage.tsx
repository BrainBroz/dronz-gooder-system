import { useState } from "react";
import { Autocomplete, Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { brl, percent, rate, type CotacaoVigente } from "../api/economic";
import { useDailyDollar } from "../api/dailyDollar";
import { economicQueryKeys } from "../queryKeys";

type Pendencia = { campo: string; motivo: string };
type Valores = Record<string, string | null>;
type Linha = {
  itemId: string;
  numeroPedido: string;
  dataPedido: string | null;
  titulo: string;
  moeda: string;
  precoUnitario: string;
  quantidade: number;
  produtoBase: { id: string; nome: string; pesoKg: string | null } | null;
  entrada: { vendaUnitariaBrl: string | null; pesoKg: string | null; freteRealUsd: string | null };
  pesoKgUsado: string | null;
  freteReal: boolean;
  calculo: {
    status: "COMPLETO" | "INCOMPLETO";
    pendencias: Pendencia[];
    porUnidade: Valores;
    total: Valores;
    indicadores: { resultadoSobreVendaPercentual: string | null; resultadoSobreCustoPercentual: string | null };
  };
};
type Controle = {
  cotacao: CotacaoVigente | null;
  parametros: { parametrosGravados: boolean; envioMarketplaceBrl: string };
  linhas: Linha[];
  totais: { linhas: number; linhasIncompletas: number; custo: string; vendaBruta: string; lucro: string; margemPercentual: string | null; markupPercentual: string | null };
};
type ProdutoBase = { id: string; nome: string; pesoKg: string | null };

const today = new Date();
const key = (store: string | null, month: string) => ["purchase-control", store, month] as const;
const pct = (value: string | null) => (value === null ? "—" : percent(value));

/** Campo numérico que grava ao sair do campo (ou Enter) quando o valor mudou. */
function NumberCell({ value, label, onSave, width = 90 }: { value: string | null; label: string; onSave: (value: number | null) => void; width?: number }) {
  const shown = value === null ? "" : String(Number(value));
  const [text, setText] = useState(shown);
  const commit = () => {
    const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (parsed === (value === null ? null : Number(value)) || (parsed !== null && !(parsed >= 0))) return;
    onSave(parsed);
  };
  return (
    <TextField
      size="small" value={text} inputMode="decimal" sx={{ width }} inputProps={{ "aria-label": label }}
      onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

function BaseLink({ linha, onPick }: { linha: Linha; onPick: (id: string | null) => void }) {
  const [term, setTerm] = useState("");
  const options = useQuery<{ items: ProdutoBase[] }>({
    queryKey: ["product-bases-search", term],
    queryFn: async () => (await api.get("/product-bases", { headers: authHeader(), params: { search: term || undefined, limit: 20 } })).data
  });
  return (
    <Autocomplete
      size="small" sx={{ width: 240 }} options={options.data?.items ?? []} value={linha.produtoBase} filterOptions={(all) => all}
      getOptionLabel={(option) => option.nome} isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_event, text, reason) => reason === "input" && setTerm(text)}
      onChange={(_event, option) => onPick(option?.id ?? null)}
      renderInput={(params) => <TextField {...params} placeholder="Ligar à base" inputProps={{ ...params.inputProps, "aria-label": `Base de ${linha.titulo}` }} />}
    />
  );
}

export function PurchaseControlPage() {
  const store = useAuthStore((s) => s.activeStoreId);
  const canEdit = useAuthStore((s) => s.permissions.some((code) => code === "SYSTEM_ADMIN" || code === "SIMULACAO_GERENCIAR"));
  const client = useQueryClient();
  const [month, setMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [view, setView] = useState<"resumido" | "detalhado">("resumido");
  const headers = { ...authHeader(), "x-store-id": store };
  const [ano, mes] = month.split("-").map(Number);
  const permissions = useAuthStore((s) => s.permissions);
  const can = (...codes: string[]) => permissions.includes("SYSTEM_ADMIN") || codes.some((code) => permissions.includes(code));
  // O dólar do dia é registrado ao abrir a tela; a projeção é refeita quando a cotação vigente muda.
  const quote = useQuery<{ cotacao: CotacaoVigente | null }>({
    queryKey: economicQueryKeys.exchangeRate(store),
    enabled: !!store && can("FINANCEIRO_VISUALIZAR", "SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR"),
    queryFn: async () => (await api.get("/economic-settings/exchange-rate", { headers })).data
  });
  useDailyDollar(store, can("FINANCEIRO_REGISTRAR"), quote.data);
  const data = useQuery<Controle>({
    queryKey: [...key(store, month), quote.data?.cotacao?.id ?? null],
    enabled: !!store && !!ano && !!mes,
    queryFn: async () => (await api.get("/purchase-control", { headers, params: { ano, mes } })).data
  });
  const save = useMutation({
    mutationFn: async ({ itemId, body }: { itemId: string; body: object }) => (await api.put(`/purchase-control/items/${itemId}`, body, { headers })).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ["purchase-control", store] })
  });
  const edit = (itemId: string, body: object) => save.mutate({ itemId, body });
  const d = data.data;
  const detailed = view === "detalhado";
  const head = detailed
    ? ["Data", "Produto", "Base", "Qtd", "Custo unid.", "Custo total", "Unid. em R$", "Total em R$", "Peso (kg)", "Frete pago (US$)", "Frete (R$)", "Venda unid.", "Venda total", "Taxa ML", "Nota", "Envio ML", "Sobra", "Margem", "Markup"]
    : ["Produto", "Qtd", "Custo pago (unid.)", "Dólar", "Custo total", "Venda (unid.)", "Sobra", "Margem", "Markup"];
  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title="Controle de compras"
          description="Cada compra do mês com o custo, as taxas e quanto sobra. É uma projeção para decidir se vale a pena: o realizado vem das vendas registradas."
        />
        <Stack direction={{ xs: "column", sm: "row" }} gap={2} alignItems={{ sm: "center" }}>
          <TextField size="small" type="month" label="Mês do pedido" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} InputLabelProps={{ shrink: true }} />
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_event, next) => next && setView(next)} aria-label="Visão">
            <ToggleButton value="resumido">Resumido</ToggleButton>
            <ToggleButton value="detalhado">Detalhado</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {data.isLoading && <Typography role="status">Carregando…</Typography>}
        {data.isError && <Typography color="error" role="alert">Não foi possível carregar as compras.</Typography>}
        {d && (
          <>
            <ContentCard>
              <Stack gap={0.5}>
                <Typography variant="body2">
                  {d.cotacao
                    ? <>Dólar usado: <strong>{rate(d.cotacao.operacional)}</strong> (referência {rate(d.cotacao.referencia)} + {rate(d.cotacao.acrescimo)}){d.cotacao.condicao === "ANTIGA" ? ` · cotação antiga (${d.cotacao.idadeDias} dias)` : ""}</>
                    : "Sem cotação do dólar: abra as Configurações econômicas para registrar."}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Envio do Mercado Livre estimado em {brl(d.parametros.envioMarketplaceBrl)} por unidade. Frete pelo peso (kg × valor por kg das configurações) até informar o frete pago.
                </Typography>
                {!d.parametros.parametrosGravados && (
                  <Typography variant="body2" color="warning.main">Nenhuma configuração econômica gravada nesta loja: frete, nota e taxa ficam pendentes.</Typography>
                )}
              </Stack>
            </ContentCard>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" aria-label="Controle de compras">
                <TableHead><TableRow>{head.map((name) => <TableCell key={name} sx={{ whiteSpace: "nowrap" }}>{name}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {d.linhas.map((l) => {
                    const c = l.calculo;
                    const sobra = <Typography component="span" color={c.total.lucro && Number(c.total.lucro) < 0 ? "error" : undefined}>{brl(c.total.lucro)}</Typography>;
                    const venda = canEdit
                      ? <NumberCell value={l.entrada.vendaUnitariaBrl} label={`Venda de ${l.titulo}`} onSave={(v) => edit(l.itemId, { vendaUnitariaBrl: v })} />
                      : brl(l.entrada.vendaUnitariaBrl);
                    const status = c.status === "INCOMPLETO"
                      ? <Tooltip title={c.pendencias.map((p) => p.motivo).join(" ")}><Chip size="small" color="warning" label="Incompleta" /></Tooltip>
                      : null;
                    const markupCell = pct(c.indicadores.resultadoSobreCustoPercentual);
                    const title = <><Typography variant="body2">{l.titulo}</Typography><Typography variant="caption" color="text.secondary">{l.numeroPedido}</Typography></>;
                    const usd = (value: number) => `${l.moeda} ${value.toFixed(2)}`;
                    return (
                      <TableRow key={l.itemId} hover>
                        {detailed ? (
                          <>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>{l.dataPedido ? new Date(l.dataPedido).toLocaleDateString("pt-BR") : "—"}</TableCell>
                            <TableCell sx={{ minWidth: 220 }}>{title}{status}</TableCell>
                            <TableCell>{canEdit ? <BaseLink linha={l} onPick={(id) => edit(l.itemId, { produtoBaseId: id })} /> : l.produtoBase?.nome ?? "—"}</TableCell>
                            <TableCell>{l.quantidade}</TableCell>
                            <TableCell>{usd(Number(l.precoUnitario))}</TableCell>
                            <TableCell>{usd(Number(l.precoUnitario) * l.quantidade)}</TableCell>
                            <TableCell>{brl(c.porUnidade.compra)}</TableCell>
                            <TableCell>{brl(c.total.compra)}</TableCell>
                            <TableCell>{canEdit ? <NumberCell value={l.entrada.pesoKg ?? l.pesoKgUsado} label={`Peso de ${l.titulo}`} onSave={(v) => edit(l.itemId, { pesoKg: v })} width={80} /> : l.pesoKgUsado ?? "—"}</TableCell>
                            <TableCell>{canEdit ? <NumberCell value={l.entrada.freteRealUsd} label={`Frete pago de ${l.titulo}`} onSave={(v) => edit(l.itemId, { freteRealUsd: v })} /> : l.entrada.freteRealUsd ?? "—"}</TableCell>
                            <TableCell>{brl(l.freteReal ? c.total.encargosCompra : c.total.frete)}</TableCell>
                            <TableCell>{venda}</TableCell>
                            <TableCell>{brl(c.total.vendaBruta)}</TableCell>
                            <TableCell>{brl(c.total.taxaMarketplace)}</TableCell>
                            <TableCell>{brl(c.total.notaFiscal)}</TableCell>
                            <TableCell>{brl(c.total.outrosEncargosVenda)}</TableCell>
                            <TableCell>{sobra}</TableCell>
                            <TableCell>{pct(c.indicadores.resultadoSobreVendaPercentual)}</TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>{markupCell}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell sx={{ minWidth: 220 }}>{title}{status}</TableCell>
                            <TableCell>{l.quantidade}</TableCell>
                            <TableCell>{usd(Number(l.precoUnitario))}</TableCell>
                            <TableCell>{d.cotacao ? rate(d.cotacao.operacional) : "—"}</TableCell>
                            <TableCell>{brl(c.total.custo)}</TableCell>
                            <TableCell>{venda}</TableCell>
                            <TableCell>{sobra}</TableCell>
                            <TableCell>{pct(c.indicadores.resultadoSobreVendaPercentual)}</TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>{markupCell}</TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                  {d.linhas.length === 0 && <TableRow><TableCell colSpan={head.length}>Nenhuma compra atribuída a esta loja neste mês.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
            {d.linhas.length > 0 && (
              <ContentCard>
                <Typography variant="subtitle2">Total do mês ({d.totais.linhas - d.totais.linhasIncompletas} linhas completas)</Typography>
                <Typography variant="body2">
                  Custo {brl(d.totais.custo)} · Venda {brl(d.totais.vendaBruta)} · Sobra {brl(d.totais.lucro)} · Margem {pct(d.totais.margemPercentual)} · Markup {pct(d.totais.markupPercentual)}
                </Typography>
                {d.totais.linhasIncompletas > 0 && (
                  <Typography variant="body2" color="warning.main">{d.totais.linhasIncompletas} linhas incompletas ficam fora dos totais: falta preço de venda, peso ou configuração.</Typography>
                )}
              </ContentCard>
            )}
          </>
        )}
        {save.isError && <Typography color="error" role="alert">Não foi possível gravar a alteração.</Typography>}
      </Stack>
    </PageContainer>
  );
}
