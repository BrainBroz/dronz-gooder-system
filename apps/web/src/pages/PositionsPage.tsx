import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
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
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";

const auth = () => ({ headers: authHeader() });
import { logisticsQueryKeys } from "../queryKeys";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";

type Position = {
  id: string;
  codigo: string;
  nome: string;
  tipo: "PERMANENTE" | "TEMPORARIA";
  status: string;
  inicioEm: string | null;
  fimEm: string | null;
  local: {
    cidade: string;
    estado: string | null;
    pais: string;
    timezone: string;
    alias: string;
    endereco?: string | null;
  };
  responsabilidades: {
    id: string;
    papel: string;
    validoDe: string;
    validoAte: string | null;
    usuario: { id: string; name: string };
  }[];
  sugestaoEncerramento: boolean;
  allowedActions: string[];
  blockedReasons: { code: string; message: string }[];
};

type AvailabilityRow = {
  pedidoCompraItemId: string;
  pedido: { numeroPedido: string };
  produto: { codigo: number; nome: string };
  recebido: number;
  reservado: number;
  alocado: number;
  disponivel: number;
  aCaminho: number;
};

const statusLabels: Record<string, string> = {
  CRIADA: "Criada",
  ATIVA: "Ativa",
  ENCERRADA: "Encerrada",
  CANCELADA: "Cancelada"
};
const actionLabels: Record<string, string> = {
  ATIVAR: "Ativar",
  ENCERRAR: "Encerrar",
  CANCELAR: "Cancelar",
  REABRIR: "Reabrir"
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : "—";

function PositionCard({
  position,
  canManage,
  selected,
  onSelect
}: {
  position: Position;
  canManage: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const responsibilityForm = useForm<{
    usuarioId: string;
    papel: string;
    validoDe: string;
  }>({
    defaultValues: { usuarioId: "", papel: "DELEGADO", validoDe: "" }
  });
  const users = useQuery<{ id: string; name: string; email: string }[]>({
    queryKey: ["positions", "assignable-users"],
    enabled:
      canManage && position.allowedActions.includes("GERENCIAR_RESPONSAVEIS"),
    queryFn: async () =>
      (await api.get("/positions/assignable-users", auth())).data
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: logisticsQueryKeys.positions() });
  const transition = useMutation({
    mutationFn: (action: string) =>
      api.patch(
        `/positions/${position.id}/status`,
        action === "REABRIR" ? { action, motivo: reason } : { action },
        auth()
      ),
    onSuccess: () => setReason(""),
    onSettled: refresh
  });
  const addResponsibility = useMutation({
    mutationFn: (data: {
      usuarioId: string;
      papel: string;
      validoDe: string;
    }) =>
      api.post(
        `/positions/${position.id}/responsibilities`,
        {
          usuarioId: data.usuarioId,
          papel: data.papel,
          validoDe: data.validoDe
            ? new Date(data.validoDe).toISOString()
            : new Date().toISOString()
        },
        auth()
      ),
    onSuccess: () => responsibilityForm.reset(),
    onSettled: refresh
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/positions/${position.id}/responsibilities/${id}`, auth()),
    onSettled: refresh
  });

  return (
    <Card variant={selected ? "outlined" : undefined}>
      <CardContent>
        <Stack gap={1}>
          <Typography variant="h6">
            {position.nome} ({position.codigo}) —{" "}
            {statusLabels[position.status] ?? position.status}
          </Typography>
          <Typography variant="body2">
            {position.tipo === "PERMANENTE"
              ? "Base permanente"
              : `Temporária: ${date(position.inicioEm)} a ${date(position.fimEm)}`}{" "}
            · {position.local.cidade}
            {position.local.estado ? `/${position.local.estado}` : ""} ·{" "}
            {position.local.pais} · {position.local.timezone}
          </Typography>
          {position.local.endereco && (
            <Typography variant="body2">
              Endereço: {position.local.endereco}
            </Typography>
          )}
          <Typography variant="body2">
            Responsáveis:{" "}
            {position.responsabilidades.length
              ? position.responsabilidades
                  .map(
                    (entry) =>
                      `${entry.usuario.name} (${entry.papel === "PRINCIPAL" ? "principal" : "delegado"})`
                  )
                  .join(", ")
              : "nenhum vínculo ativo"}
          </Typography>
          {position.sugestaoEncerramento && (
            <Typography variant="body2" color="success.main">
              Sem pendências: a posição pode ser encerrada.
            </Typography>
          )}
          {position.blockedReasons.map((reason) => (
            <Typography key={reason.code} variant="body2" color="warning.main">
              {reason.message}
            </Typography>
          ))}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            gap={1}
            alignItems={{ sm: "center" }}
          >
            <Button onClick={onSelect}>Ver disponibilidade</Button>
            {position.allowedActions
              .filter((action) => actionLabels[action])
              .map((action) => (
                <Button
                  key={action}
                  disabled={
                    transition.isPending ||
                    (action === "REABRIR" && !reason.trim())
                  }
                  onClick={() => transition.mutate(action)}
                >
                  {actionLabels[action]}
                </Button>
              ))}
            {position.allowedActions.includes("REABRIR") && (
              <TextField
                size="small"
                label="Motivo da reabertura"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Stack>
          <MutationStatus
            mutation={transition}
            successMessage="Posição atualizada."
          />
          {position.allowedActions.includes("GERENCIAR_RESPONSAVEIS") && (
            <>
              {position.responsabilidades.map((entry) => (
                <Stack
                  key={entry.id}
                  direction="row"
                  gap={1}
                  alignItems="center"
                >
                  <Typography variant="body2">
                    {entry.usuario.name} · desde {date(entry.validoDe)} · até{" "}
                    {date(entry.validoAte)}
                  </Typography>
                  <Button
                    size="small"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(entry.id)}
                  >
                    Revogar
                  </Button>
                </Stack>
              ))}
              <Stack
                component="form"
                direction={{ xs: "column", md: "row" }}
                gap={1}
                onSubmit={responsibilityForm.handleSubmit((data) =>
                  addResponsibility.mutate(data)
                )}
              >
                <TextField
                  select
                  label="Usuário"
                  defaultValue=""
                  {...responsibilityForm.register("usuarioId", {
                    required: true
                  })}
                >
                  <MenuItem value="" disabled>
                    Selecione
                  </MenuItem>
                  {users.data?.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.name} · {user.email}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Papel"
                  defaultValue="DELEGADO"
                  {...responsibilityForm.register("papel")}
                >
                  <MenuItem value="PRINCIPAL">Principal</MenuItem>
                  <MenuItem value="DELEGADO">Delegado</MenuItem>
                </TextField>
                <TextField
                  type="datetime-local"
                  label="Válido desde"
                  InputLabelProps={{ shrink: true }}
                  {...responsibilityForm.register("validoDe")}
                />
                <Button type="submit" disabled={addResponsibility.isPending}>
                  Adicionar responsável
                </Button>
              </Stack>
              <MutationStatus
                mutation={addResponsibility}
                successMessage="Responsável adicionado."
              />
              <MutationStatus
                mutation={revoke}
                successMessage="Vínculo revogado."
              />
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Availability({ positionId }: { positionId: string }) {
  const store = useAuthStore((s) => s.activeStoreId);
  const rows = useQuery<AvailabilityRow[]>({
    queryKey: logisticsQueryKeys.availability(store, positionId),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get(`/positions/${positionId}/availability`, {
          headers: { ...authHeader(), "x-store-id": store! }
        })
      ).data
  });
  if (rows.isLoading) return <Typography>Carregando…</Typography>;
  if (rows.isError)
    return (
      <Typography role="alert">
        Não foi possível carregar. Tente novamente.
      </Typography>
    );
  if (!rows.data?.length)
    return (
      <Typography>
        Ainda não há unidades destinadas ou recebidas nesta posição.
      </Typography>
    );
  return (
    <Table size="small" aria-label="Disponibilidade operacional">
      <TableHead>
        <TableRow>
          <TableCell>Pedido</TableCell>
          <TableCell>Produto</TableCell>
          <TableCell align="right">A caminho</TableCell>
          <TableCell align="right">Recebido</TableCell>
          <TableCell align="right">Reservado</TableCell>
          <TableCell align="right">Alocado</TableCell>
          <TableCell align="right">Disponível</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.data.map((row) => (
          <TableRow key={row.pedidoCompraItemId}>
            <TableCell>{row.pedido.numeroPedido}</TableCell>
            <TableCell>
              {row.produto.codigo} · {row.produto.nome}
            </TableCell>
            <TableCell align="right">{row.aCaminho}</TableCell>
            <TableCell align="right">{row.recebido}</TableCell>
            <TableCell align="right">{row.reservado}</TableCell>
            <TableCell align="right">{row.alocado}</TableCell>
            <TableCell align="right">{row.disponivel}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type PositionForm = {
  codigo: string;
  nome: string;
  tipo: string;
  inicioEm: string;
  fimEm: string;
  alias: string;
  cidade: string;
  estado: string;
  pais: string;
  timezone: string;
  endereco: string;
};

function CreatePosition() {
  const client = useQueryClient();
  const form = useForm<PositionForm>({
    defaultValues: {
      codigo: "",
      nome: "",
      tipo: "TEMPORARIA",
      inicioEm: "",
      fimEm: "",
      alias: "",
      cidade: "",
      estado: "",
      pais: "US",
      timezone: "America/New_York",
      endereco: ""
    }
  });
  const create = useMutation({
    mutationFn: (v: PositionForm) =>
      api.post(
        "/positions",
        {
          codigo: v.codigo.trim().toUpperCase(),
          nome: v.nome,
          tipo: v.tipo,
          ...(v.tipo === "TEMPORARIA"
            ? {
                inicioEm: new Date(v.inicioEm).toISOString(),
                fimEm: new Date(v.fimEm).toISOString()
              }
            : {}),
          local: {
            alias: v.alias,
            cidade: v.cidade,
            pais: v.pais.trim().toUpperCase(),
            timezone: v.timezone,
            ...(v.estado ? { estado: v.estado } : {}),
            ...(v.endereco ? { endereco: v.endereco } : {})
          }
        },
        auth()
      ),
    onSuccess: () => form.reset(),
    onSettled: () =>
      client.invalidateQueries({ queryKey: logisticsQueryKeys.positions() })
  });
  return (
    <ContentCard title="Nova posição">
      <Stack
        component="form"
        gap={1}
        onSubmit={form.handleSubmit((v) => create.mutate(v))}
      >
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            label="Código"
            {...form.register("codigo", { required: true })}
          />
          <TextField
            label="Nome"
            {...form.register("nome", { required: true })}
          />
          <TextField
            select
            label="Tipo"
            defaultValue="TEMPORARIA"
            {...form.register("tipo")}
          >
            <MenuItem value="TEMPORARIA">Temporária</MenuItem>
            <MenuItem value="PERMANENTE">Permanente</MenuItem>
          </TextField>
          <TextField
            type="datetime-local"
            label="Início"
            InputLabelProps={{ shrink: true }}
            {...form.register("inicioEm")}
          />
          <TextField
            type="datetime-local"
            label="Fim"
            InputLabelProps={{ shrink: true }}
            {...form.register("fimEm")}
          />
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            label="Apelido do local"
            {...form.register("alias", { required: true })}
          />
          <TextField
            label="Cidade"
            {...form.register("cidade", { required: true })}
          />
          <TextField label="Estado" {...form.register("estado")} />
          <TextField
            label="País (ISO)"
            {...form.register("pais", {
              required: true,
              minLength: 2,
              maxLength: 2
            })}
          />
          <TextField
            label="Fuso (IANA)"
            {...form.register("timezone", { required: true })}
          />
        </Stack>
        <TextField
          label="Endereço completo (restrito)"
          {...form.register("endereco")}
        />
        <Button type="submit" disabled={create.isPending}>
          Criar posição
        </Button>
        <MutationStatus
          mutation={create}
          successMessage="Posição criada. Ative-a para receber."
        />
      </Stack>
    </ContentCard>
  );
}

export function PositionsPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canManage =
    permissions.includes("SYSTEM_ADMIN") ||
    permissions.includes("LOGISTICA_POSICOES_GERENCIAR");
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useQuery<Position[]>({
    queryKey: logisticsQueryKeys.positions(),
    queryFn: async () => (await api.get("/positions", auth())).data
  });
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Posições operacionais"
          description="Base Miami permanente e posições temporárias. Disponibilidade operacional não é estoque patrimonial."
        />
        {positions.isLoading && <Typography>Carregando…</Typography>}
        {positions.isError && (
          <Typography role="alert">
            Não foi possível carregar. Tente novamente.
          </Typography>
        )}
        {positions.data && !positions.data.length && (
          <Typography>Nenhuma posição em que você esteja designado.</Typography>
        )}
        {positions.data?.map((position) => (
          <PositionCard
            key={position.id}
            position={position}
            canManage={canManage}
            selected={selected === position.id}
            onSelect={() => setSelected(position.id)}
          />
        ))}
        {selected && (
          <ContentCard title="Disponibilidade na posição (loja ativa)">
            <Availability positionId={selected} />
          </ContentCard>
        )}
        {canManage && <CreatePosition />}
      </Stack>
    </PageContainer>
  );
}
