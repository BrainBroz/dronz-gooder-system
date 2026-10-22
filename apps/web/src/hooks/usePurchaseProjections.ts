import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader } from "../stores/auth";

/** Custo, venda projetada e markup de uma linha de compra, vindos do Controle de compras (por loja e mês do pedido). */
export type Projection = {
  vendaUnitariaBrl: string | null;
  vendaTotalBrl: string | null;
  custoTotalBrl: string | null;
  markup: string | null;
};
type ControlLine = {
  numeroPedido: string;
  titulo: string;
  entrada: { vendaUnitariaBrl: string | null };
  calculo: {
    total: { custo: string | null; vendaBruta: string | null };
    indicadores: { resultadoSobreCustoPercentual: string | null };
  };
};

/** Mês do pedido no fuso de São Paulo, como o servidor agrupa os lotes (AAAA-MM). */
export const monthOf = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" })
    .format(new Date(iso))
    .slice(0, 7);

export const projectionKey = (orderId: string, title: string) =>
  `${orderId}|${title}`;

/**
 * Junta pelo número do pedido e título (iguais nas duas telas); uma consulta ao controle por loja e mês.
 * shortcut: vira um campo da própria listagem se aparecer linha repetida dentro do mesmo pedido.
 */
export function usePurchaseProjections({
  months,
  stores,
  enabled
}: {
  months: string[];
  stores: { id: string }[];
  enabled: boolean;
}) {
  const results = useQueries({
    queries: stores.flatMap((store) =>
      months.map((mes) => {
        const [ano, mesNumero] = mes.split("-").map(Number);
        return {
          queryKey: ["purchase-control", store.id, mes],
          enabled: enabled && Boolean(mes),
          queryFn: async () =>
            (
              (
                await api.get("/purchase-control", {
                  headers: { ...authHeader(), "x-store-id": store.id },
                  params: { ano, mes: mesNumero }
                })
              ).data as { linhas: ControlLine[] }
            ).linhas
        };
      })
    )
  });
  const projections = new Map<string, Projection>();
  results.forEach((query) =>
    query.data?.forEach((line) =>
      projections.set(projectionKey(line.numeroPedido, line.titulo), {
        vendaUnitariaBrl: line.entrada.vendaUnitariaBrl,
        vendaTotalBrl: line.calculo.total.vendaBruta,
        custoTotalBrl: line.calculo.total.custo,
        markup: line.calculo.indicadores.resultadoSobreCustoPercentual
      })
    )
  );
  return projections;
}
