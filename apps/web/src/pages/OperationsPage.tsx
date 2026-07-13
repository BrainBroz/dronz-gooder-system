import { useMemo, useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Snackbar, Stack, Tab, Tabs, TextField, Typography
} from "@mui/material";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { OperationCard } from "../components/operations/OperationCard";
import { BlockedReasons, OperationalEmpty, OperationalError, OperationalLoading } from "../components/operations/OperationalState";
import { OperationsTimeline } from "../components/operations/OperationsTimeline";
import { useOperationCandidates, useOperationDetail, useOperationalMutation, useOperationsOverview } from "../hooks/useOperations";
import { useAuthStore } from "../stores/auth";
import type { CheckpointCandidate, DefinitiveCandidate, MiamiCandidate, ReceivingCandidate, ReceivingDetail } from "../types/operations";

type Stage = "miami" | "paraguay" | "brazil" | "receiving" | "definitive-entry";
const stages: Array<{ value: Stage; label: string; total: "miamiPending" | "paraguayPending" | "brazilPending" | "receivingPending" | "definitivePending" }> = [
  { value: "miami", label: "Miami", total: "miamiPending" },
  { value: "paraguay", label: "Paraguai", total: "paraguayPending" },
  { value: "brazil", label: "Brasil", total: "brazilPending" },
  { value: "receiving", label: "Recebimento", total: "receivingPending" },
  { value: "definitive-entry", label: "Entrada definitiva", total: "definitivePending" }
];
const checkpointDivergences = {
  paraguay: ["CORRETO", "MALA_AUSENTE", "VOLUME_AUSENTE", "ITEM_NAO_LOCALIZADO", "QUANTIDADE_DIVERGENTE", "AVARIA", "ITEM_EXTRA", "CHECKPOINT_PARCIAL"],
  brazil: ["CORRETO", "MALA_AUSENTE", "ITEM_NAO_LOCALIZADO", "QUANTIDADE_DIVERGENTE", "AVARIA", "ITEM_EXTRA", "REGISTRO_ADUANEIRO_DIVERGENTE", "LACRE_ROMPIDO"]
} as const;
const receivingDivergences = ["CORRETO", "FALTA", "EXCESSO", "AVARIA", "ITEM_INCORRETO", "OUTRO"] as const;

const isMiami = (item: object): item is MiamiCandidate => "quantidadePendente" in item;
const isCheckpoint = (item: object): item is CheckpointCandidate => "rotaCodigo" in item;
const isReceiving = (item: object): item is ReceivingCandidate => "expectedItems" in item;
const isDefinitive = (item: object): item is DefinitiveCandidate => "impactQuantity" in item;

function actionFor(stage: Stage) {
  return ({ miami: "CONFIRM_MIAMI", paraguay: "CONFIRM_PARAGUAY", brazil: "CONFIRM_BRAZIL", receiving: "OPEN_RECEIVING", "definitive-entry": "POST_DEFINITIVE_ENTRY" } as const)[stage];
}

function OperationsContent() {
  const [stage, setStage] = useState<Stage>("miami");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<MiamiCandidate | CheckpointCandidate | ReceivingCandidate | DefinitiveCandidate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const overview = useOperationsOverview();
  const candidates = useOperationCandidates(stage);
  const detailStage = stage === "miami" ? "miami/items" : stage;
  const detail = useOperationDetail(detailStage, selectedId);
  const mutation = useOperationalMutation();

  const entries = useMemo(() => candidates.data ?? [], [candidates.data]);

  const submitAction = async (body: object, url: string) => {
    await mutation.mutateAsync({ url, body });
    setActionItem(null);
    setNotice("Operação concluída e dados atualizados.");
  };

  return <Stack gap={3}>
    <PageHeader title="Operação logística" description="Miami → Paraguai → Brasil → Recebimento → Entrada definitiva" />
    {overview.isError && <Alert severity="warning">O resumo disponível respeita as permissões concedidas pelo backend.</Alert>}
    <ContentCard>
      <Tabs value={stage} onChange={(_, value: Stage) => { setStage(value); setSelectedId(null); setActionItem(null); }} variant="scrollable" aria-label="Etapas operacionais">
        {stages.map((item) => <Tab key={item.value} value={item.value} label={`${item.label}${overview.data?.totals[item.total] === undefined ? "" : ` (${overview.data.totals[item.total]})`}`} />)}
      </Tabs>
    </ContentCard>

    <ContentCard title={stages.find((item) => item.value === stage)?.label}>
      <Button sx={{ alignSelf: "flex-start" }} onClick={() => candidates.refetch()}>Atualizar</Button>
      {candidates.isLoading && <OperationalLoading />}
      {candidates.isError && <OperationalError retry={() => void candidates.refetch()} />}
      {candidates.isSuccess && entries.length === 0 && <OperationalEmpty />}
      <Stack gap={1.5}>{entries.map((entry) => {
        const actionAllowed = entry.allowedActions.includes(actionFor(stage));
        if (isMiami(entry)) return <OperationCard key={entry.id} title={entry.produto.nome} subtitle={`Pedido ${entry.pedido.numeroPedido} · pendente ${entry.quantidadePendente}`} status={entry.pedido.status} blockedReasons={entry.blockedReasons} onDetail={() => setSelectedId(entry.id)} onAction={actionAllowed ? () => setActionItem(entry) : undefined} actionLabel="Confirmar em Miami" />;
        if (isCheckpoint(entry)) return <OperationCard key={entry.id} title={`Mala ${entry.codigo}`} subtitle={`${entry.rotaCodigo}${entry.applicability ? ` · ${entry.applicability}` : ""}`} status={entry.status} blockedReasons={entry.blockedReasons} onDetail={() => setSelectedId(entry.id)} onAction={actionAllowed ? () => setActionItem(entry) : undefined} actionLabel={`Confirmar ${stage === "paraguay" ? "Paraguai" : "Brasil"}`} />;
        if (isReceiving(entry)) return <OperationCard key={entry.id} title={`Mala ${entry.codigo}`} subtitle={`${entry.expectedItems} item(ns) esperado(s)`} status={entry.receiving?.status ?? "AGUARDANDO_ABERTURA"} blockedReasons={entry.blockedReasons} onDetail={() => entry.receiving && setSelectedId(entry.receiving.id)} onAction={actionAllowed ? () => setActionItem(entry) : undefined} actionLabel="Abrir recebimento" />;
        if (isDefinitive(entry)) return <OperationCard key={entry.id} title={`Recebimento ${entry.id}`} subtitle={`Impacto informado pela API: ${entry.impactQuantity} unidade(s)`} status={entry.status} blockedReasons={entry.blockedReasons} onDetail={() => setSelectedId(entry.id)} onAction={actionAllowed ? () => setActionItem(entry) : undefined} actionLabel="Fazer entrada definitiva" />;
        return null;
      })}</Stack>
    </ContentCard>

    <OperationDetail stage={stage} detail={detail.data} loading={detail.isLoading} error={detail.isError} retry={() => void detail.refetch()} mutate={submitAction} mutationPending={mutation.isPending} />
    {actionItem && <ActionDialog key={`${stage}-${actionItem.id}`} stage={stage} item={actionItem} pending={mutation.isPending} close={() => setActionItem(null)} submit={submitAction} />}
    <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
    {mutation.isError && <Alert severity="error">A operação foi rejeitada. Atualize os dados e tente novamente.</Alert>}
  </Stack>;
}

function OperationDetail(props: {
  stage: Stage;
  detail: MiamiCandidate | CheckpointCandidate | ReceivingDetail | DefinitiveCandidate | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
  mutate: (body: object, url: string) => Promise<void>;
  mutationPending: boolean;
}) {
  if (props.loading) return <ContentCard title="Detalhes"><OperationalLoading /></ContentCard>;
  if (props.error) return <ContentCard title="Detalhes"><OperationalError retry={props.retry} /></ContentCard>;
  if (!props.detail) return null;
  const detail = props.detail;
  return <ContentCard title="Detalhes e histórico">
    <Stack gap={2}>
      {isMiami(detail) && <><Typography>Recebido: {detail.quantidadeRecebidaMiami} de {detail.quantidade}</Typography><Typography>Progresso e alerta são fornecidos pela API: {detail.quantidadePendente} pendente(s) · {detail.alerta24h ? "alerta ativo" : "sem alerta"}</Typography></>}
      {isCheckpoint(detail) && <><Typography>Status: {detail.status}</Typography>{detail.checkpoint && <Typography>Projeção efetiva: {detail.checkpoint.tipoDivergencia}</Typography>}</>}
      {"progress" in detail && <ReceivingItems detail={detail} mutate={props.mutate} pending={props.mutationPending} />}
      {isDefinitive(detail) && <><Typography>Impacto: {detail.impactQuantity} unidade(s)</Typography>{detail.items.map((item) => <Typography key={item.id}>Produto {item.produtoId}: recebido {item.quantidadeRecebida}, rejeitado {item.quantidadeRejeitada}, incorporado {item.quantidadeJaIncorporada}</Typography>)}</>}
      <BlockedReasons reasons={detail.blockedReasons} />
      <OperationsTimeline history={detail.history} />
    </Stack>
  </ContentCard>;
}

function ReceivingItems({ detail, mutate, pending }: { detail: ReceivingDetail; mutate: (body: object, url: string) => Promise<void>; pending: boolean }) {
  const canCorrect = useAuthStore((state) => state.permissions.includes("CHECKPOINT_CORRIGIR"));
  const [itemId, setItemId] = useState<string | null>(null);
  const [correction, setCorrection] = useState(false);
  const [received, setReceived] = useState("0");
  const [rejected, setRejected] = useState("0");
  const [divergence, setDivergence] = useState<(typeof receivingDivergences)[number]>("CORRETO");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [resolved, setResolved] = useState(true);
  return <Stack gap={1}>
    <Typography>Progresso da API: {detail.progress.completed}/{detail.progress.total} · pendentes {detail.progress.pending} · divergentes {detail.progress.divergent}</Typography>
    {detail.itens.map((item) => <Stack key={item.id} direction={{ xs: "column", md: "row" }} gap={1} alignItems={{ md: "center" }}>
      <Typography sx={{ flex: 1 }}>{item.produto.nome}: esperado {item.quantidadeEsperada}, recebido {item.quantidadeRecebida}, rejeitado {item.quantidadeRejeitada}, já incorporado {item.quantidadeJaIncorporada} · {item.tipoDivergencia}</Typography>
      {detail.allowedActions.includes("CONFIRM_RECEIVING_ITEM") && <Button onClick={() => { setCorrection(false); setItemId(item.id); }}>Conferir</Button>}
      {canCorrect && <Button onClick={() => { setCorrection(true); setItemId(item.id); setReceived(String(item.quantidadeRecebida)); setRejected(String(item.quantidadeRejeitada)); setDivergence(item.tipoDivergencia); setNotes(item.observacoes ?? ""); }}>Corrigir</Button>}
    </Stack>)}
    <Dialog open={Boolean(itemId)} onClose={() => setItemId(null)}><DialogTitle>{correction ? "Corrigir item" : "Confirmar item"}</DialogTitle><DialogContent><Stack gap={2} mt={1}>
      <TextField label="Quantidade recebida" type="number" value={received} onChange={(event) => setReceived(event.target.value)} />
      <TextField label="Quantidade rejeitada" type="number" value={rejected} onChange={(event) => setRejected(event.target.value)} />
      <TextField select label="Divergência" value={divergence} onChange={(event) => setDivergence(event.target.value as (typeof receivingDivergences)[number])}>{receivingDivergences.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
      <TextField label="Observação" value={notes} onChange={(event) => setNotes(event.target.value)} required={divergence !== "CORRETO"} />
      {correction && <><TextField label="Motivo da correção" inputProps={{ "aria-label": "Motivo da correção" }} value={reason} onChange={(event) => setReason(event.target.value)} required /><TextField select label="Divergência resolvida" value={resolved ? "sim" : "nao"} onChange={(event) => setResolved(event.target.value === "sim")}><MenuItem value="sim">Sim</MenuItem><MenuItem value="nao">Não</MenuItem></TextField></>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setItemId(null)}>Cancelar</Button><Button disabled={pending || (divergence !== "CORRETO" && !notes.trim()) || (correction && reason.trim().length < 3)} onClick={() => itemId && void mutate(correction ? {
      entity: "RecebimentoItem", originalEventId: itemId, correctionType: "AJUSTE_RECEBIMENTO", reason,
      after: { quantidadeRecebida: Number(received), quantidadeRejeitada: Number(rejected), tipoDivergencia: divergence, divergenciaResolvida: resolved, observacoes: notes || null }
    } : { quantidadeRecebida: Number(received), quantidadeRejeitada: Number(rejected), tipoDivergencia: divergence, observacoes: notes || undefined }, correction ? "/operations/corrections" : `/receiving/${detail.id}/items/${itemId}/confirm`).then(() => setItemId(null))}>{correction ? "Salvar correção" : "Confirmar"}</Button></DialogActions></Dialog>
  </Stack>;
}

function ActionDialog(props: { stage: Stage; item: MiamiCandidate | CheckpointCandidate | ReceivingCandidate | DefinitiveCandidate; pending: boolean; close: () => void; submit: (body: object, url: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState("1");
  const [divergence, setDivergence] = useState("CORRETO");
  const [notes, setNotes] = useState("");
  const item = props.item;
  const submit = () => {
    const now = new Date().toISOString();
    if (props.stage === "miami" && isMiami(item)) return props.submit({ pedidoCompraItemId: item.id, quantidadeRecebida: Number(quantity), recebidoEm: now, tipoDivergencia: divergence, observacao: notes || undefined }, "/logistics/miami-confirmations");
    if ((props.stage === "paraguay" || props.stage === "brazil") && isCheckpoint(item)) return props.submit({ viagemId: item.viagemId, malaId: item.id, confirmadoEm: now, tipoDivergencia: divergence, observacao: notes || undefined }, `/logistics/checkpoint-${props.stage === "paraguay" ? "paraguai" : "brasil"}`);
    if (props.stage === "receiving" && isReceiving(item)) return props.submit({ viagemId: item.viagemId, malaId: item.id, observacoes: notes || undefined }, "/receiving");
    if (props.stage === "definitive-entry" && isDefinitive(item)) return props.submit({ viagemId: item.viagemId, malaId: item.malaId, confirmadoEm: now, observacao: notes || undefined }, "/receiving/entrada-definitiva");
    return Promise.resolve();
  };
  const options = props.stage === "paraguay" ? checkpointDivergences.paraguay : props.stage === "brazil" ? checkpointDivergences.brazil : props.stage === "miami" ? ["CORRETO", "FALTANTE", "QUANTIDADE_DIVERGENTE", "DANIFICADO", "DESCONHECIDO", "TRACKING_NAO_LOCALIZADO"] : [];
  return <Dialog open onClose={props.close} fullWidth maxWidth="sm"><DialogTitle>Confirmar operação</DialogTitle><DialogContent><Stack gap={2} mt={1}>
    {props.stage === "miami" && <TextField label="Quantidade recebida" type="number" inputProps={{ min: 1 }} value={quantity} onChange={(event) => setQuantity(event.target.value)} />}
    {options.length > 0 && <TextField select label="Divergência" value={divergence} onChange={(event) => setDivergence(event.target.value)}>{options.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>}
    <TextField label="Observação" multiline minRows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
  </Stack></DialogContent><DialogActions><Button onClick={props.close}>Cancelar</Button><Button variant="contained" disabled={props.pending} onClick={() => void submit()}>{props.pending ? "Confirmando..." : "Confirmar"}</Button></DialogActions></Dialog>;
}

export function OperationsPage() {
  const storeId = useAuthStore((state) => state.activeStoreId);
  return <PageContainer><OperationsContent key={storeId} /></PageContainer>;
}
