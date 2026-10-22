import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";

const BASE = "/integrations/marketplaces";
const keys = {
  candidates: (status: string, finalidade: string) => ["buyer-candidates", status, finalidade] as const,
  conflicts: (id: string) => ["buyer-conflicts", id] as const,
  unidentified: ["buyer-unidentified"] as const,
  accounts: ["external-accounts"] as const
};
// Uma chave por intenção: repetir o mesmo clique não duplica a decisão no backend.
const newKey = () => crypto.randomUUID();
const withKey = (key: string) => ({
  headers: { ...authHeader(), "idempotency-key": key }
});

type Candidate = {
  id: string;
  provider: string;
  account: { id: string; name: string };
  externalOrderId: string;
  status: string;
  version: number;
  purchaseId: string | null;
  order: {
    orderedAt: string;
    currency: string;
    total?: number;
    items: { title: string; quantity: number; unitPrice: number }[];
  };
  currentEvidence: { source: string };
  allowedActions: string[];
  blockedReasons: string[];
  confianca: {
    score: number;
    faixa: string;
    versao: string;
    sinais: { codigo: string; valor: number; motivo: string }[];
  };
};
type Conflict = {
  id: string;
  type: string;
  status: string;
  evidenceId: string;
  referenceEvidenceId: string | null;
};
type Account = { id: string; plataforma: string; nomeExibicao: string };

const blockedLabels: Record<string, string> = {
  MATERIAL_DIVERGENCE:
    "Fontes divergentes: resolva a divergência antes de aprovar.",
  NEW_EVIDENCE_REQUIRES_RECONCILIATION:
    "Evidência nova depois da aprovação: registre ciência.",
  LEGACY_PURCHASE_REQUIRES_REVIEW:
    "Já existe compra importada com esta identidade.",
  CANCELLED: "Compra cancelada na origem.",
  ALREADY_DECIDED: "Já decidida.",
  DUPLICATE_EXTERNAL_LINE_ID: "Linhas externas duplicadas na evidência."
};

function ConflictResolver({ candidate }: { candidate: Candidate }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const conflicts = useQuery<{ items: Conflict[] }>({
    queryKey: keys.conflicts(candidate.id),
    queryFn: async () =>
      (
        await api.get(`${BASE}/buyer-candidates/${candidate.id}/conflicts`, {
          headers: authHeader(),
          params: { page: 1, limit: 100 }
        })
      ).data
  });
  const resolve = useMutation({
    mutationFn: ({
      evidenceId,
      resolution
    }: {
      evidenceId: string;
      resolution: string;
    }) =>
      api.post(
        `${BASE}/buyer-candidates/${candidate.id}/conflicts/resolve`,
        { evidenceId, resolution, reason, expectedVersion: candidate.version },
        withKey(`${key}-${evidenceId}-${resolution}`)
      ),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["buyer-candidates"] }),
        client.invalidateQueries({ queryKey: keys.conflicts(candidate.id) })
      ])
  });
  const open = (conflicts.data?.items ?? []).filter(
    (conflict) => conflict.status === "ABERTO"
  );
  const byEvidence = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const conflict of open)
      groups.set(conflict.evidenceId, [
        ...(groups.get(conflict.evidenceId) ?? []),
        conflict.type
      ]);
    return [...groups.entries()];
  }, [open]);
  if (!byEvidence.length) return null;
  return (
    <Stack gap={1} mt={1}>
      <TextField
        size="small"
        label="Motivo da resolução"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {byEvidence.map(([evidenceId, types]) => (
        <Stack
          key={evidenceId}
          direction={{ xs: "column", md: "row" }}
          gap={1}
          alignItems={{ md: "center" }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            Divergência: {types.join(", ")}
          </Typography>
          {candidate.purchaseId ? (
            <Button
              disabled={!reason.trim() || resolve.isPending}
              onClick={() =>
                resolve.mutate({ evidenceId, resolution: "CIENTE" })
              }
            >
              Registrar ciência
            </Button>
          ) : (
            <>
              <Button
                disabled={!reason.trim() || resolve.isPending}
                onClick={() =>
                  resolve.mutate({
                    evidenceId,
                    resolution: "MANTER_REFERENCIA"
                  })
                }
              >
                Manter evidência anterior
              </Button>
              <Button
                disabled={!reason.trim() || resolve.isPending}
                onClick={() =>
                  resolve.mutate({
                    evidenceId,
                    resolution: "ACEITAR_EVIDENCIA"
                  })
                }
              >
                Aceitar evidência nova
              </Button>
            </>
          )}
        </Stack>
      ))}
      <MutationStatus
        mutation={resolve}
        successMessage="Divergência resolvida."
      />
    </Stack>
  );
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const decide = useMutation({
    mutationFn: (decision: "APROVAR" | "REJEITAR") =>
      api.post(
        `${BASE}/buyer-candidates/${candidate.id}/decision`,
        decision === "APROVAR"
          ? { decision, expectedVersion: candidate.version }
          : { decision, expectedVersion: candidate.version, reason },
        withKey(`${key}-${decision}`)
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ["buyer-candidates"] })
  });
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack gap={1}>
          <Typography variant="h6">
            {candidate.provider} · {candidate.externalOrderId} ·{" "}
            {candidate.status}
          </Typography>
          <Typography variant="body2">
            Conta {candidate.account.name} ·{" "}
            {new Date(candidate.order.orderedAt).toLocaleDateString("pt-BR")} ·{" "}
            {candidate.order.items.length} item(ns) ·{" "}
            {candidate.order.total ?? "total não informado"}{" "}
            {candidate.order.currency} · fonte atual{" "}
            {candidate.currentEvidence.source}
          </Typography>
          <Typography variant="body2">
            Confiança {candidate.confianca.score}/100 (
            {candidate.confianca.faixa}) — apenas prioriza a revisão; não
            aprova.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {candidate.confianca.sinais
              .map((signal) => `${signal.codigo}: ${signal.motivo}`)
              .join(" · ")}
          </Typography>
          {candidate.blockedReasons.map((code) => (
            <Typography key={code} variant="body2" color="warning.main">
              {blockedLabels[code] ?? code}
            </Typography>
          ))}
          <Stack direction={{ xs: "column", md: "row" }} gap={1}>
            {candidate.allowedActions.includes("APPROVE") && (
              <Button
                variant="contained"
                disabled={decide.isPending}
                onClick={() => decide.mutate("APROVAR")}
              >
                Aprovar compra
              </Button>
            )}
            {candidate.allowedActions.includes("REJECT") && (
              <>
                <TextField
                  size="small"
                  label="Motivo da rejeição"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button
                  disabled={decide.isPending || !reason.trim()}
                  onClick={() => decide.mutate("REJEITAR")}
                >
                  Rejeitar
                </Button>
              </>
            )}
          </Stack>
          <MutationStatus
            mutation={decide}
            successMessage="Decisão registrada."
          />
          {candidate.allowedActions.includes("RESOLVE_CONFLICT") && (
            <ConflictResolver candidate={candidate} />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function UnidentifiedQueue({
  accounts,
  canRegister
}: {
  accounts: Account[];
  canRegister: boolean;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState<
    Record<string, { contaExternaId: string; externalOrderId: string }>
  >({});
  const [key] = useState(newKey);
  const pending = useQuery<
    {
      id: string;
      source: string;
      externalEvidenceId: string;
      recordedAt: string;
      order: { reference?: string };
    }[]
  >({
    queryKey: keys.unidentified,
    queryFn: async () =>
      (
        await api.get(`${BASE}/buyer-evidence/unidentified`, {
          headers: authHeader()
        })
      ).data
  });
  const identify = useMutation({
    mutationFn: (id: string) =>
      api.post(
        `${BASE}/buyer-evidence/${id}/identify`,
        form[id],
        withKey(`${key}-${id}`)
      ),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.unidentified }),
        client.invalidateQueries({ queryKey: ["buyer-candidates"] })
      ])
  });
  if (!pending.data?.length) return null;
  return (
    <ContentCard title="Evidências aguardando identificação">
      <Stack gap={1}>
        {pending.data.map((evidence) => (
          <Stack
            key={evidence.id}
            direction={{ xs: "column", md: "row" }}
            gap={1}
            alignItems={{ md: "center" }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {evidence.source} · {evidence.externalEvidenceId} ·{" "}
              {evidence.order.reference ?? "sem referência"}
            </Typography>
            {canRegister && (
              <>
                <TextField
                  select
                  size="small"
                  label="Conta"
                  value={form[evidence.id]?.contaExternaId ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [evidence.id]: {
                        externalOrderId:
                          current[evidence.id]?.externalOrderId ?? "",
                        contaExternaId: event.target.value
                      }
                    }))
                  }
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.plataforma} · {account.nomeExibicao}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Order ID"
                  value={form[evidence.id]?.externalOrderId ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [evidence.id]: {
                        contaExternaId:
                          current[evidence.id]?.contaExternaId ?? "",
                        externalOrderId: event.target.value
                      }
                    }))
                  }
                />
                <Button
                  disabled={
                    identify.isPending ||
                    !form[evidence.id]?.contaExternaId ||
                    !form[evidence.id]?.externalOrderId?.trim()
                  }
                  onClick={() => identify.mutate(evidence.id)}
                >
                  Identificar
                </Button>
              </>
            )}
          </Stack>
        ))}
        <MutationStatus
          mutation={identify}
          successMessage="Evidência identificada."
        />
      </Stack>
    </ContentCard>
  );
}

function RegisterEvidence({ accounts }: { accounts: Account[] }) {
  const client = useQueryClient();
  const empty = {
    source: "EMAIL_AMAZON",
    provider: "AMAZON",
    contaExternaId: "",
    externalEvidenceId: "",
    externalOrderId: "",
    orderedAt: "",
    currency: "USD",
    title: "",
    quantity: "1",
    unitPrice: "",
    total: ""
  };
  const [form, setForm] = useState(empty);
  const [key, setKey] = useState(newKey);
  const field = (name: keyof typeof empty) => ({
    value: form[name],
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [name]: event.target.value }))
  });
  const register = useMutation({
    mutationFn: () => {
      const at = new Date(form.orderedAt).toISOString();
      return api.post(
        `${BASE}/buyer-evidence`,
        {
          source: form.source,
          provider: form.provider,
          externalEvidenceId: form.externalEvidenceId,
          ...(form.contaExternaId
            ? { contaExternaId: form.contaExternaId }
            : {}),
          order: {
            ...(form.externalOrderId.trim()
              ? { externalOrderId: form.externalOrderId.trim() }
              : {}),
            orderedAt: at,
            updatedAt: at,
            currency: form.currency.toUpperCase(),
            cancelled: false,
            shipments: [],
            ...(form.total ? { total: Number(form.total) } : {}),
            items: [
              {
                title: form.title,
                quantity: Number(form.quantity),
                cancelledQuantity: 0,
                refundedQuantity: 0,
                unitPrice: Number(form.unitPrice || 0),
                currency: form.currency.toUpperCase()
              }
            ]
          }
        },
        withKey(key)
      );
    },
    onSuccess: () => {
      setForm(empty);
      setKey(newKey());
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["buyer-candidates"] }),
        client.invalidateQueries({ queryKey: keys.unidentified })
      ])
  });
  const valid =
    form.externalEvidenceId.trim() &&
    form.orderedAt &&
    form.title.trim() &&
    Number(form.quantity) > 0;
  return (
    <ContentCard title="Registrar evidência (e-mail, documento ou manual)">
      <Typography variant="body2" color="text.secondary">
        Sem conta e Order ID a evidência vai para identificação; com eles, é
        conciliada pela identidade forte. Nunca cria compra sem aprovação.
      </Typography>
      <Stack gap={1} mt={1}>
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField select label="Fonte" {...field("source")}>
            {[
              "EMAIL_AMAZON",
              "EMAIL_EBAY",
              "EMAIL_OUTRO",
              "DOCUMENTO",
              "MANUAL"
            ].map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Marketplace" {...field("provider")}>
            <MenuItem value="AMAZON">Amazon</MenuItem>
            <MenuItem value="EBAY">eBay</MenuItem>
          </TextField>
          <TextField
            select
            label="Conta (opcional)"
            {...field("contaExternaId")}
          >
            <MenuItem value="">Não identificada</MenuItem>
            {accounts
              .filter((account) => account.plataforma === form.provider)
              .map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.nomeExibicao}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="ID da mensagem/documento"
            {...field("externalEvidenceId")}
          />
          <TextField
            label="Order ID (opcional)"
            {...field("externalOrderId")}
          />
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            type="datetime-local"
            label="Data do pedido"
            InputLabelProps={{ shrink: true }}
            {...field("orderedAt")}
          />
          <TextField label="Moeda" {...field("currency")} />
          <TextField label="Item" {...field("title")} />
          <TextField label="Quantidade" type="number" {...field("quantity")} />
          <TextField
            label="Preço unitário"
            type="number"
            {...field("unitPrice")}
          />
          <TextField
            label="Total (opcional)"
            type="number"
            {...field("total")}
          />
        </Stack>
        <Button
          disabled={!valid || register.isPending}
          onClick={() => register.mutate()}
        >
          Registrar evidência
        </Button>
        <MutationStatus
          mutation={register}
          successMessage="Evidência registrada."
        />
      </Stack>
    </ContentCard>
  );
}

export function BuyerReviewPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const can = (code: string) =>
    permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
  const [status, setStatus] = useState("AGUARDANDO_APROVACAO");
  const [finalidade, setFinalidade] = useState<"LOJA" | "PESSOAL">("LOJA");
  const candidates = useQuery<{ items: Candidate[]; total: number }>({
    queryKey: keys.candidates(status, finalidade),
    queryFn: async () =>
      (
        await api.get(`${BASE}/buyer-candidates`, {
          headers: authHeader(),
          params: { page: 1, limit: 50, finalidade, ...(status ? { status } : {}) }
        })
      ).data
  });
  const accounts = useQuery<Account[]>({
    queryKey: keys.accounts,
    queryFn: async () =>
      (await api.get("/imported-purchases/accounts", { headers: authHeader() }))
        .data
  });
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Revisão de compras detectadas"
          description="Evidências de API, e-mail e registros manuais. Toda compra exige aprovação humana antes de atribuição e materialização."
        />
        <ToggleButtonGroup size="small" exclusive value={finalidade} onChange={(_event, next) => next && setFinalidade(next)} aria-label="Origem das compras">
          <ToggleButton value="LOJA">Compras da loja</ToggleButton>
          <ToggleButton value="PESSOAL">Compras pessoais</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select
          label="Situação"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value="AGUARDANDO_APROVACAO">Aguardando aprovação</MenuItem>
          <MenuItem value="COM_DIVERGENCIA">Com divergência</MenuItem>
          <MenuItem value="APROVADA">Aprovadas</MenuItem>
          <MenuItem value="REJEITADA">Rejeitadas</MenuItem>
          <MenuItem value="CANCELADA">Canceladas</MenuItem>
          <MenuItem value="">Todas</MenuItem>
        </TextField>
        {candidates.isLoading && <Typography>Carregando…</Typography>}
        {candidates.isError && (
          <Typography role="alert">
            Não foi possível carregar. Tente novamente.
          </Typography>
        )}
        {candidates.data && !candidates.data.items.length && (
          <Typography>Nenhum registro nesta situação.</Typography>
        )}
        {candidates.data?.items.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
        <UnidentifiedQueue
          accounts={accounts.data ?? []}
          canRegister={can("BUYER_INGESTION_REGISTRAR")}
        />
        {can("BUYER_INGESTION_REGISTRAR") && (
          <RegisterEvidence accounts={accounts.data ?? []} />
        )}
      </Stack>
    </PageContainer>
  );
}
