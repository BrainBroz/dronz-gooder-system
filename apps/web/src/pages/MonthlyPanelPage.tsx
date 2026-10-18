import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader } from "../stores/auth";
import { ContentCard } from "../components/ui/ContentCard";
import { MutationStatus } from "../components/ui/MutationStatus";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";

type Panel = {
  competencia: { ano: number; mes: number; timezone: string };
  referenciaEm: string;
  moedas: {
    moeda: string;
    pedidos: number;
    linhas: number;
    unidades: number;
    bruto: string;
    cancelado: string;
    reembolsado: string;
    liquido: string;
    pendenteAtribuicao: string;
    materializado: string;
    naoRateado: string;
    lojas: {
      lojaId: string;
      nome: string;
      valor: string;
      unidades: number;
      pedidos: number;
    }[];
  }[];
  pendentesAprovacao: { moeda: string; candidatos: number; valor: string }[];
  semDataPedido: number;
  conflitosAbertos: number;
  mappingsPendentes: number;
  definicoes: Record<string, string>;
};

const today = new Date();
const formatMoney = (value: string, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    Number(value)
  );

export function MonthlyPanelPage() {
  const [filters, setFilters] = useState({
    ano: String(today.getFullYear()),
    mes: String(today.getMonth() + 1),
    moeda: ""
  });
  const params = {
    ano: filters.ano,
    mes: filters.mes,
    ...(filters.moeda ? { moeda: filters.moeda } : {})
  };
  const panel = useQuery<Panel>({
    queryKey: ["monthly-panel", params],
    queryFn: async () =>
      (
        await api.get("/imported-purchases/monthly", {
          headers: authHeader(),
          params
        })
      ).data
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const response = await api.get("/imported-purchases/monthly.csv", {
        headers: authHeader(),
        params,
        responseType: "blob"
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `compras-${filters.ano}-${filters.mes.padStart(2, "0")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
  });
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader
          title="Painel mensal de compras"
          description="Competência pela data do pedido no fuso de São Paulo. Moedas nunca são somadas entre si."
        />
        <Stack direction={{ xs: "column", md: "row" }} gap={1}>
          <TextField
            label="Ano"
            type="number"
            value={filters.ano}
            onChange={(event) =>
              setFilters((current) => ({ ...current, ano: event.target.value }))
            }
          />
          <TextField
            select
            label="Mês"
            value={filters.mes}
            onChange={(event) =>
              setFilters((current) => ({ ...current, mes: event.target.value }))
            }
          >
            {Array.from({ length: 12 }, (_, index) => (
              <MenuItem key={index + 1} value={String(index + 1)}>
                {new Date(2000, index, 1).toLocaleDateString("pt-BR", {
                  month: "long"
                })}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Moeda (opcional)"
            value={filters.moeda}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                moeda: event.target.value.toUpperCase()
              }))
            }
          />
          <Button
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            Exportar CSV
          </Button>
        </Stack>
        <MutationStatus
          mutation={exportCsv}
          successMessage="CSV gerado."
          loadingMessage="Gerando CSV…"
        />
        {panel.isLoading && <Typography>Carregando…</Typography>}
        {panel.isError && (
          <Typography role="alert">
            Não foi possível carregar. Tente novamente.
          </Typography>
        )}
        {panel.data && (
          <>
            <Typography variant="body2" color="text.secondary">
              Calculado em{" "}
              {new Date(panel.data.referenciaEm).toLocaleString("pt-BR")} ·{" "}
              {panel.data.conflitosAbertos} conflito(s) aberto(s) ·{" "}
              {panel.data.mappingsPendentes} linha(s) sem mapping ·{" "}
              {panel.data.semDataPedido} compra(s) sem data do pedido (fora do
              painel)
            </Typography>
            {!panel.data.moedas.length && (
              <Typography>Nenhuma compra nesta competência.</Typography>
            )}
            {panel.data.moedas.map((currency) => (
              <ContentCard
                key={currency.moeda}
                title={`${currency.moeda} · ${currency.pedidos} pedido(s), ${currency.linhas} linha(s), ${currency.unidades} unidade(s)`}
              >
                <Stack gap={1}>
                  <Typography>
                    Bruto {formatMoney(currency.bruto, currency.moeda)} ·
                    Cancelado {formatMoney(currency.cancelado, currency.moeda)}{" "}
                    · Reembolsado{" "}
                    {formatMoney(currency.reembolsado, currency.moeda)} ·
                    Líquido {formatMoney(currency.liquido, currency.moeda)}
                  </Typography>
                  <Stack direction={{ xs: "column", md: "row" }} gap={1}>
                    {currency.lojas.map((store) => (
                      <Card
                        key={store.lojaId}
                        variant="outlined"
                        sx={{ flex: 1 }}
                      >
                        <CardContent>
                          <Typography variant="h6">{store.nome}</Typography>
                          <Typography>
                            {formatMoney(store.valor, currency.moeda)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {store.unidades} unidade(s) · {store.pedidos}{" "}
                            pedido(s)
                          </Typography>
                        </CardContent>
                      </Card>
                    ))}
                    <Card variant="outlined" sx={{ flex: 1 }}>
                      <CardContent>
                        <Typography variant="h6">Pendente de loja</Typography>
                        <Typography>
                          {formatMoney(
                            currency.pendenteAtribuicao,
                            currency.moeda
                          )}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Stack>
                  <Typography variant="body2">
                    Materializado{" "}
                    {formatMoney(currency.materializado, currency.moeda)} · Não
                    rateado (frete/imposto/desconto do pedido){" "}
                    {formatMoney(currency.naoRateado, currency.moeda)}
                  </Typography>
                </Stack>
              </ContentCard>
            ))}
            {!!panel.data.pendentesAprovacao.length && (
              <ContentCard title="Aguardando aprovação (fora dos totais)">
                {panel.data.pendentesAprovacao.map((entry) => (
                  <Typography key={entry.moeda}>
                    {entry.candidatos} candidato(s) ·{" "}
                    {formatMoney(entry.valor, entry.moeda)}
                  </Typography>
                ))}
              </ContentCard>
            )}
            <ContentCard title="Como ler">
              {Object.values(panel.data.definicoes).map((text) => (
                <Typography key={text} variant="body2" color="text.secondary">
                  {text}
                </Typography>
              ))}
            </ContentCard>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
