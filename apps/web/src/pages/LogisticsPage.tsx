import { useState } from "react";
import { Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { SuitcaseWeightPanel } from "../components/SuitcaseWeightPanel";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { operationsKeys } from "../hooks/useOperations";
import { logisticsQueryKeys, purchasingQueryKeys } from "../queryKeys";

type LogisticsTrip = {
  id: string;
  origem: string;
  destino: string;
  status: string;
  allowedStatusTransitions: string[];
};

type LogisticsBag = {
  id: string;
  codigo: string;
  status: string;
  limitePesoKg: string;
  volumes: { id: string; codigo: string }[];
  alocacoes: { id: string }[];
  allowedStatusTransitions: string[];
};

const statusLabels: Record<string, string> = {
  OPEN_FOR_ALLOCATION: "Abrir para alocação",
  CLOSED_FOR_ALLOCATION: "Encerrar alocação da viagem",
  IN_TRANSIT: "Registrar viagem em trânsito",
  ARRIVED_BRAZIL: "Registrar chegada ao Brasil",
  CLOSED: "Fechar mala",
  CHECKED_IN: "Registrar embarque da mala",
  RECEIVED: "Registrar mala recebida"
};

type SearchOrder = {
  id: string;
  numeroPedido: string;
  itens: {
    id: string;
    quantidadeRecebidaMiami: number;
    produto: { nome: string };
  }[];
};

function LogisticsContent() {
  const store = useAuthStore((s) => s.activeStoreId),
    headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const [selectedMalaId, setSelectedMalaId] = useState<string | null>(null);
  const [draftOrderNumber, setDraftOrderNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [allocationResetKey, setAllocationResetKey] = useState(0);
  const [statusRequest, setStatusRequest] = useState<{
    kind: "trips" | "suitcases";
    id: string;
    status: string;
    name: string;
    version: number;
  } | null>(null);
  const travelerForm = useForm<{ nome: string; email: string }>({
    defaultValues: { nome: "", email: "" }
  });
  const tripForm = useForm<{
    viajanteId: string;
    origem: string;
    destino: string;
    partidaEm: string;
    chegadaPrevistaEm: string;
  }>({
    defaultValues: {
      viajanteId: "",
      origem: "",
      destino: "",
      partidaEm: "",
      chegadaPrevistaEm: ""
    }
  });
  const bagForm = useForm<{ viagemId: string; codigo: string }>({
    defaultValues: { viagemId: "", codigo: "" }
  });
  const volumeForm = useForm<{ malaId: string; codigo: string; taraKg: number }>({
    defaultValues: { malaId: "", codigo: "", taraKg: 0.5 }
  });
  const allocationForm = useForm<{
    pedidoCompraItemId: string;
    malaId: string;
    volumeLogisticoId: string;
    quantidade: number;
  }>({
    defaultValues: {
      pedidoCompraItemId: "",
      malaId: "",
      volumeLogisticoId: "",
      quantidade: 1
    }
  });
  const allocationBagId = useWatch({ control: allocationForm.control, name: "malaId" });
  const travelers = useQuery({
    queryKey: logisticsQueryKeys.travelers(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/travelers", { headers })).data
  });
  const trips = useQuery<LogisticsTrip[]>({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const bags = useQuery<LogisticsBag[]>({
    queryKey: logisticsQueryKeys.suitcases(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/suitcases", { headers })).data
  });
  const orders = useQuery<SearchOrder[]>({
    queryKey: [...purchasingQueryKeys.orders(store), "number-search", orderNumber],
    enabled: !!store && !!orderNumber,
    queryFn: async () =>
      (await api.get("/purchase-orders/search/numero", {
        headers,
        params: { numero: orderNumber }
      })).data
  });
  const createTraveler = useMutation({
    mutationFn: (data: { nome: string; email: string }) =>
      api.post(
        "/logistics/travelers",
        { nome: data.nome, email: data.email || undefined },
        { headers }
      ),
    onSuccess: async () => {
      travelerForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.travelers(store)
      });
    }
  });
  const createTrip = useMutation({
    mutationFn: (data: {
      viajanteId: string;
      origem: string;
      destino: string;
      partidaEm: string;
      chegadaPrevistaEm: string;
    }) => api.post("/logistics/trips", data, { headers }),
    onSuccess: async () => {
      tripForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.trips(store)
      });
    }
  });
  const createBag = useMutation({
    mutationFn: (data: { viagemId: string; codigo: string }) =>
      api.post("/logistics/suitcases", data, { headers }),
    onSuccess: async () => {
      bagForm.reset();
      await client.invalidateQueries({
        queryKey: logisticsQueryKeys.suitcases(store)
      });
    }
  });
  const createVolume = useMutation({
    mutationFn: (data: { malaId: string; codigo: string; taraKg: number }) =>
      api.post(`/logistics/suitcases/${data.malaId}/volumes`, {
        codigo: data.codigo,
        taraKg: Number(data.taraKg)
      }, { headers }),
    onSuccess: async (_, data) => {
      volumeForm.reset({ malaId: data.malaId, codigo: "", taraKg: 0.5 });
      await client.invalidateQueries({ queryKey: logisticsQueryKeys.suitcases(store) });
      await client.invalidateQueries({ queryKey: logisticsQueryKeys.suitcaseWeight(store, data.malaId) });
    }
  });
  const allocate = useMutation({
    mutationFn: (data: {
      pedidoCompraItemId: string;
      malaId: string;
      volumeLogisticoId: string;
      quantidade: number;
    }) => api.post("/logistics/allocations", {
      ...data,
      quantidade: Number(data.quantidade)
    }, { headers }),
    onSuccess: async (_, data) => {
      allocationForm.reset();
      setAllocationResetKey((key) => key + 1);
      await client.invalidateQueries({ queryKey: logisticsQueryKeys.suitcases(store) });
      await client.invalidateQueries({ queryKey: logisticsQueryKeys.suitcaseWeight(store, data.malaId) });
    }
  });
  const changeStatus = useMutation({
    mutationFn: (request: NonNullable<typeof statusRequest>) =>
      api.patch(`/logistics/${request.kind}/${request.id}/status`, { status: request.status }, { headers }),
    onSuccess: () => setStatusRequest(null),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: logisticsQueryKeys.trips(store) }),
        client.invalidateQueries({ queryKey: logisticsQueryKeys.suitcases(store) }),
        client.invalidateQueries({ queryKey: operationsKeys.all(store) })
      ]);
    }
  });
  const allocationBag = bags.data?.find((bag) => bag.id === allocationBagId);
  const searchedOrders = draftOrderNumber.trim() === orderNumber ? orders.data : undefined;
  const activeStatusRequest = statusRequest && (
    statusRequest.kind === "trips"
      ? statusRequest.version === trips.dataUpdatedAt && trips.data?.find((trip) => trip.id === statusRequest.id)?.allowedStatusTransitions.includes(statusRequest.status)
      : statusRequest.version === bags.dataUpdatedAt && bags.data?.find((bag) => bag.id === statusRequest.id)?.allowedStatusTransitions.includes(statusRequest.status)
  ) ? statusRequest : null;

  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      <PageHeader title="Logística Internacional" />
      <MutationStatus mutation={changeStatus} successMessage="Status atualizado." />
      {travelers.isLoading && <Typography>Carregando...</Typography>}
      {travelers.isError && <Typography>Falha ao carregar dados</Typography>}
      <ContentCard title="Viajantes">
        <Stack
          component="form"
          direction={{ xs: "column", md: "row" }}
          gap={1}
          onSubmit={travelerForm.handleSubmit((v) => createTraveler.mutate(v))}
        >
          <TextField
            label="Nome"
            {...travelerForm.register("nome", { required: true })}
          />
          <TextField
            label="E-mail"
            type="email"
            {...travelerForm.register("email")}
          />
          <Button type="submit" disabled={createTraveler.isPending}>
            Adicionar viajante
          </Button>
        </Stack>
        <MutationStatus
          mutation={createTraveler}
          successMessage="Viajante adicionado."
        />
        {travelers.data?.map(
          (v: { id: string; nome: string; ativo: boolean }) => (
            <Card key={v.id}>
              <CardContent>
                <Typography>{v.nome}</Typography>
                <Typography>{v.ativo ? "Ativo" : "Inativo"}</Typography>
              </CardContent>
            </Card>
          )
        )}
      </ContentCard>
      <ContentCard title="Viagens">
        <Stack
          component="form"
          direction={{ xs: "column", md: "row" }}
          gap={1}
          onSubmit={tripForm.handleSubmit((v) => createTrip.mutate(v))}
        >
          <TextField
            select
            label="Viajante"
            defaultValue=""
            {...tripForm.register("viajanteId", { required: true })}
          >
            <MenuItem value="" disabled>
              Selecione
            </MenuItem>
            {travelers.data?.map((v: { id: string; nome: string }) => (
              <MenuItem key={v.id} value={v.id}>
                {v.nome}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Origem"
            {...tripForm.register("origem", { required: true })}
          />
          <TextField
            label="Destino"
            {...tripForm.register("destino", { required: true })}
          />
          <TextField
            type="datetime-local"
            label="Partida"
            InputLabelProps={{ shrink: true }}
            {...tripForm.register("partidaEm", { required: true })}
          />
          <TextField
            type="datetime-local"
            label="Chegada prevista"
            InputLabelProps={{ shrink: true }}
            {...tripForm.register("chegadaPrevistaEm", { required: true })}
          />
          <Button type="submit" disabled={createTrip.isPending}>
            Criar viagem
          </Button>
        </Stack>
        <MutationStatus mutation={createTrip} successMessage="Viagem criada." />
        {trips.data?.map(
          (t) => (
            <Card key={t.id}>
              <CardContent>
                <Typography>
                  {t.origem} → {t.destino}
                </Typography>
                <Typography>{t.status}</Typography>
                {t.allowedStatusTransitions.filter((status) => status !== "CANCELLED").map((status) => (
                  <Button key={status} disabled={changeStatus.isPending}
                    onClick={() => setStatusRequest({ kind: "trips", id: t.id, status, name: `${t.origem} → ${t.destino}`, version: trips.dataUpdatedAt })}>
                    {statusLabels[status] ?? status}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )
        )}
      </ContentCard>
      <ContentCard title="Malas e volumes">
        <Stack
          component="form"
          direction={{ xs: "column", md: "row" }}
          gap={1}
          onSubmit={bagForm.handleSubmit((v) => createBag.mutate(v))}
        >
          <TextField
            select
            label="Viagem"
            defaultValue=""
            {...bagForm.register("viagemId", { required: true })}
          >
            <MenuItem value="" disabled>
              Selecione
            </MenuItem>
            {trips.data?.map(
              (t: { id: string; origem: string; destino: string }) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.origem} → {t.destino}
                </MenuItem>
              )
            )}
          </TextField>
          <TextField
            label="Código"
            {...bagForm.register("codigo", { required: true })}
          />
          <Button type="submit" disabled={createBag.isPending}>
            Criar mala
          </Button>
        </Stack>
        <MutationStatus mutation={createBag} successMessage="Mala criada." />
        {bags.isError && <Typography>Falha ao carregar malas.</Typography>}
        {bags.data?.map(
          (b) => (
            <Card key={b.id}>
              <CardContent>
                <Typography>
                  {b.codigo} — {b.status}
                </Typography>
                <Typography>
                  Limite {b.limitePesoKg} kg · {b.volumes.length} volume(s) ·{" "}
                  {b.alocacoes.length} alocação(ões)
                </Typography>
                <Button onClick={() => setSelectedMalaId(b.id)}>
                  Ver peso
                </Button>
                {b.allowedStatusTransitions.filter((status) => status !== "CANCELLED").map((status) => (
                  <Button key={status} disabled={changeStatus.isPending}
                    onClick={() => setStatusRequest({ kind: "suitcases", id: b.id, status, name: b.codigo, version: bags.dataUpdatedAt })}>
                    {statusLabels[status] ?? status}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )
        )}
      </ContentCard>
      <ContentCard title="Adicionar volume à mala">
        <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1}
          onSubmit={volumeForm.handleSubmit((data) => createVolume.mutate(data))}>
          <TextField select label="Mala para volume" defaultValue=""
            {...volumeForm.register("malaId", { required: true })}>
            <MenuItem value="" disabled>Selecione</MenuItem>
            {bags.data?.map((bag) => (
              <MenuItem key={bag.id} value={bag.id}>{bag.codigo} — {bag.status}</MenuItem>
            ))}
          </TextField>
          <TextField label="Código do volume"
            {...volumeForm.register("codigo", { required: true })} />
          <TextField label="Tara (kg)" type="number" inputProps={{ min: 0, step: 0.001 }}
            {...volumeForm.register("taraKg", { valueAsNumber: true, min: 0 })} />
          <Button type="submit" disabled={createVolume.isPending}>Adicionar volume</Button>
        </Stack>
        <MutationStatus mutation={createVolume} successMessage="Volume adicionado." />
      </ContentCard>
      <ContentCard title="Alocar item recebido em Miami">
        <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1}
          onSubmit={(event) => {
            event.preventDefault();
            const nextNumber = draftOrderNumber.trim();
            if (!nextNumber) return;
            allocationForm.setValue("pedidoCompraItemId", "");
            setAllocationResetKey((key) => key + 1);
            if (nextNumber === orderNumber) void orders.refetch();
            else setOrderNumber(nextNumber);
          }}>
          <TextField label="Número do pedido para alocação" value={draftOrderNumber}
            onChange={(event) => {
              if (draftOrderNumber.trim() === orderNumber) {
                allocationForm.setValue("pedidoCompraItemId", "");
                setAllocationResetKey((key) => key + 1);
              }
              setDraftOrderNumber(event.target.value);
            }} />
          <Button type="submit">Buscar pedido</Button>
        </Stack>
        {orders.isFetching && <Typography>Buscando pedidos...</Typography>}
        {orders.isError && <Typography>Falha ao buscar pedidos.</Typography>}
        {searchedOrders?.length === 0 && <Typography>Nenhum pedido encontrado.</Typography>}
        <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1}
          onSubmit={allocationForm.handleSubmit((data) => allocate.mutate(data))}>
          <TextField key={`item-${allocationResetKey}`} select label="Item recebido" defaultValue=""
            {...allocationForm.register("pedidoCompraItemId", { required: true })}>
            <MenuItem value="" disabled>Selecione</MenuItem>
            {searchedOrders?.flatMap((order) => order.itens.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {order.numeroPedido} · {item.produto.nome} · Miami: {item.quantidadeRecebidaMiami}
              </MenuItem>
            )))}
          </TextField>
          <TextField key={`bag-${allocationResetKey}`} select label="Mala para alocação" defaultValue=""
            {...allocationForm.register("malaId", {
              required: true,
              onChange: () => allocationForm.setValue("volumeLogisticoId", "")
            })}>
            <MenuItem value="" disabled>Selecione</MenuItem>
            {bags.data?.map((bag) => (
              <MenuItem key={bag.id} value={bag.id}>{bag.codigo} — {bag.status}</MenuItem>
            ))}
          </TextField>
          <TextField key={`volume-${allocationBagId}:${allocationResetKey}`} select label="Volume" defaultValue=""
            {...allocationForm.register("volumeLogisticoId", { required: true })}>
            <MenuItem value="" disabled>Selecione</MenuItem>
            {allocationBag?.volumes.map((volume) => (
              <MenuItem key={volume.id} value={volume.id}>{volume.codigo}</MenuItem>
            ))}
          </TextField>
          <TextField label="Quantidade para alocar" type="number" inputProps={{ min: 1, step: 1 }}
            {...allocationForm.register("quantidade", { valueAsNumber: true, min: 1 })} />
          <Button type="submit" disabled={allocate.isPending}>Alocar na mala</Button>
        </Stack>
        <MutationStatus mutation={allocate} successMessage="Item alocado na mala." />
      </ContentCard>
      <SuitcaseWeightPanel malaId={selectedMalaId} />
      <Dialog open={Boolean(activeStatusRequest)} onClose={() => {
        if (!changeStatus.isPending) setStatusRequest(null);
      }}>
        <DialogTitle>Confirmar etapa física</DialogTitle>
        <DialogContent>
          <Typography>
            {activeStatusRequest ? `${statusLabels[activeStatusRequest.status] ?? activeStatusRequest.status}: ${activeStatusRequest.name}?` : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={changeStatus.isPending} onClick={() => setStatusRequest(null)}>Voltar</Button>
          <Button disabled={changeStatus.isPending || !activeStatusRequest} onClick={() => {
            if (activeStatusRequest) changeStatus.mutate(activeStatusRequest);
          }}>Confirmar</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export function LogisticsPage() {
  const store = useAuthStore((s) => s.activeStoreId);

  return (
    <PageContainer>
      <LogisticsContent key={store} />
    </PageContainer>
  );
}
