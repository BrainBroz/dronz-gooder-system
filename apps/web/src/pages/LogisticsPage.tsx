import { useState } from "react";
import { Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { SuitcaseWeightPanel } from "../components/SuitcaseWeightPanel";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { logisticsQueryKeys } from "../queryKeys";

export function LogisticsPage() {
  const store = useAuthStore((s) => s.activeStoreId),
    headers = { ...authHeader(), "x-store-id": store };
  const client = useQueryClient();
  const [selectedMalaId, setSelectedMalaId] = useState<string | null>(null);
  const [resetForStoreId, setResetForStoreId] = useState(store);
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
  const travelers = useQuery({
    queryKey: logisticsQueryKeys.travelers(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/travelers", { headers })).data
  });
  const trips = useQuery({
    queryKey: logisticsQueryKeys.trips(store),
    enabled: !!store,
    queryFn: async () => (await api.get("/logistics/trips", { headers })).data
  });
  const bags = useQuery({
    queryKey: logisticsQueryKeys.suitcases(store),
    enabled: !!store,
    queryFn: async () =>
      (await api.get("/logistics/suitcases", { headers })).data
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
  // Descarta a mala selecionada ao trocar de loja (evita exibir peso de
  // uma mala de outra loja).
  if (store !== resetForStoreId) {
    setResetForStoreId(store);
    setSelectedMalaId(null);
  }
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Logística Internacional" />
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
            (t: {
              id: string;
              origem: string;
              destino: string;
              status: string;
            }) => (
              <Card key={t.id}>
                <CardContent>
                  <Typography>
                    {t.origem} → {t.destino}
                  </Typography>
                  <Typography>{t.status}</Typography>
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
          {bags.data?.map(
            (b: {
              id: string;
              codigo: string;
              status: string;
              limitePesoKg: string;
              volumes: unknown[];
              alocacoes: unknown[];
            }) => (
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
                </CardContent>
              </Card>
            )
          )}
        </ContentCard>
        <SuitcaseWeightPanel malaId={selectedMalaId} />
      </Stack>
    </PageContainer>
  );
}
