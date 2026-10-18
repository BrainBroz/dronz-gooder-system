import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";

type HomeResponse = {
  referenciaEm: string;
  secoes: {
    codigo: string;
    titulo: string;
    rota: string;
    itens: {
      codigo: string;
      titulo: string;
      quantidade: number;
      definicao: string;
    }[];
  }[];
};
type CompensationRequest = {
  id: string;
  createdAt: string;
  payload: { reason: string; adjustments?: { quantityDelta: number }[] };
  propostoPor: { name: string };
};

const homeKey = (store: string | null) => ["home", store] as const;

function CompensationQueue({ store }: { store: string }) {
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const requests = useQuery<CompensationRequest[]>({
    queryKey: ["compensation-requests", store],
    queryFn: async () =>
      (await api.get("/operations/corrections/requests", { headers })).data
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["compensation-requests", store] }),
      client.invalidateQueries({ queryKey: homeKey(store) })
    ]);
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(
        `/operations/corrections/requests/${id}/${approve ? "approve" : "reject"}`,
        approve ? {} : { motivo: reasons[id] ?? "" },
        { headers }
      ),
    onSettled: refresh
  });
  if (!requests.data?.length) return null;
  return (
    <ContentCard title="Compensações aguardando seu aval">
      <Stack gap={1}>
        {requests.data.map((request) => (
          <Stack
            key={request.id}
            direction={{ xs: "column", md: "row" }}
            gap={1}
            alignItems={{ md: "center" }}
          >
            <Typography sx={{ flex: 1 }}>
              {request.propostoPor.name}: {request.payload.reason} (
              {request.payload.adjustments
                ?.map((adjustment) => adjustment.quantityDelta)
                .join(", ")}{" "}
              un.)
            </Typography>
            <Button
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: request.id, approve: true })}
            >
              Aprovar
            </Button>
            <TextField
              size="small"
              label="Motivo da rejeição"
              value={reasons[request.id] ?? ""}
              onChange={(event) =>
                setReasons((current) => ({
                  ...current,
                  [request.id]: event.target.value
                }))
              }
            />
            <Button
              disabled={decide.isPending || !(reasons[request.id] ?? "").trim()}
              onClick={() => decide.mutate({ id: request.id, approve: false })}
            >
              Rejeitar
            </Button>
          </Stack>
        ))}
        <MutationStatus
          mutation={decide}
          successMessage="Decisão registrada."
        />
      </Stack>
    </ContentCard>
  );
}

function HomeContent() {
  const store = useAuthStore((s) => s.activeStoreId);
  const navigate = useNavigate();
  const home = useQuery<HomeResponse>({
    queryKey: homeKey(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/operations/home", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data
  });
  const pending =
    home.data?.secoes
      .flatMap((section) => section.itens)
      .filter((item) => item.quantidade > 0).length ?? 0;
  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      <PageHeader
        title="Início"
        description={
          home.data
            ? `Pendências calculadas em ${new Date(home.data.referenciaEm).toLocaleString("pt-BR")}.`
            : "Pendências e próximos passos da loja ativa."
        }
      />
      {home.isLoading && <Typography>Carregando…</Typography>}
      {home.isError && (
        <Typography role="alert">
          Não foi possível carregar. Tente novamente.
        </Typography>
      )}
      {home.data && pending === 0 && (
        <Typography>Nenhuma ação pendente neste contexto.</Typography>
      )}
      {home.data?.secoes.some((section) => section.codigo === "CORRECOES") &&
        store && <CompensationQueue store={store} />}
      {home.data?.secoes.map((section) => (
        <ContentCard key={section.codigo} title={section.titulo}>
          <Stack gap={1}>
            {section.itens.map((item) => (
              <Card key={item.codigo} variant="outlined">
                <CardContent>
                  <Stack direction="row" gap={2} alignItems="center">
                    <Typography
                      variant="h5"
                      component="span"
                      color={
                        item.quantidade > 0 ? "warning.main" : "text.secondary"
                      }
                    >
                      {item.quantidade}
                    </Typography>
                    <Stack sx={{ flex: 1 }}>
                      <Typography>{item.titulo}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.definicao}
                      </Typography>
                    </Stack>
                    {item.quantidade > 0 && section.rota !== "/" && (
                      <Button onClick={() => navigate(section.rota)}>
                        Abrir
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </ContentCard>
      ))}
    </Stack>
  );
}

export function HomePage() {
  const store = useAuthStore((s) => s.activeStoreId);
  return (
    <PageContainer>
      <HomeContent key={store} />
    </PageContainer>
  );
}
