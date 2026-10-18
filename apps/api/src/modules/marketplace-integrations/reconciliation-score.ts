import type {
  FonteEvidenciaCompra,
  TipoConflitoEvidenciaCompra
} from "@prisma/client";
import type { NormalizedMarketplaceOrder } from "./marketplace-integrations.types";

// X-03: score = 25I + 25Q + 15M + 15V + 10E + 10T. Cada sinal vale 1 quando confirmado por fontes
// independentes, 0,5 com dado estruturado de uma única fonte e 0 quando ausente ou em conflito.
// Só prioriza e explica a revisão: nunca aprova, rejeita, atribui nem altera allowedActions.
export const RECONCILIATION_SCORE_VERSION = "X-03-v1";

type Signal = {
  codigo: "I" | "Q" | "M" | "V" | "E" | "T";
  peso: number;
  valor: 0 | 0.5 | 1;
  motivo: string;
};

export function reconciliationScore(input: {
  order: NormalizedMarketplaceOrder;
  hasStrongIdentity: boolean;
  sources: FonteEvidenciaCompra[];
  openConflicts: TipoConflitoEvidenciaCompra[];
}) {
  const independent = new Set(input.sources).size >= 2;
  const conflicted = (...types: TipoConflitoEvidenciaCompra[]) =>
    types.some((type) => input.openConflicts.includes(type));
  const level = (
    hasData: boolean,
    ...conflictTypes: TipoConflitoEvidenciaCompra[]
  ): 0 | 0.5 | 1 =>
    !hasData || conflicted(...conflictTypes) ? 0 : independent ? 1 : 0.5;
  const explain = (value: 0 | 0.5 | 1, what: string) =>
    value === 1
      ? `${what} confirmado por fontes independentes`
      : value === 0.5
        ? `${what} informado por uma única fonte`
        : `${what} ausente ou em conflito`;
  const sameCurrency = input.order.items.every(
    (item) => item.currency.toUpperCase() === input.order.currency.toUpperCase()
  );
  const signals: Signal[] = [
    {
      codigo: "I",
      peso: 25,
      valor: level(input.hasStrongIdentity),
      motivo: ""
    },
    {
      codigo: "Q",
      peso: 25,
      valor: level(input.order.items.length > 0, "ITEMS", "QUANTITY"),
      motivo: ""
    },
    {
      codigo: "M",
      peso: 15,
      valor: level(sameCurrency, "CURRENCY"),
      motivo: ""
    },
    {
      codigo: "V",
      peso: 15,
      valor: level(
        input.order.items.every((item) => Number.isFinite(item.unitPrice)),
        "TOTAL"
      ),
      motivo: ""
    },
    // Uma fonte só nunca é concordância independente (cópias da mesma mensagem não contam).
    {
      codigo: "E",
      peso: 10,
      valor: independent && !input.openConflicts.length ? 1 : 0,
      motivo: ""
    },
    {
      codigo: "T",
      peso: 10,
      valor: level(
        Date.parse(input.order.orderedAt) <= Date.parse(input.order.updatedAt),
        "ORDER_DATE"
      ),
      motivo: ""
    }
  ];
  const labels = {
    I: "Identidade",
    Q: "Itens e quantidades",
    M: "Moeda",
    V: "Valores",
    E: "Concordância entre fontes",
    T: "Consistência temporal"
  };
  for (const signal of signals)
    signal.motivo =
      signal.codigo === "E"
        ? signal.valor
          ? "Fontes independentes concordam sem conflito aberto"
          : independent
            ? "Fontes independentes com conflito aberto"
            : "Apenas uma fonte"
        : explain(signal.valor, labels[signal.codigo]);
  // HALF_UP para inteiro.
  const score = Math.floor(
    signals.reduce((sum, signal) => sum + signal.peso * signal.valor, 0) + 0.5
  );
  return {
    versao: RECONCILIATION_SCORE_VERSION,
    score,
    faixa: score >= 85 ? "ALTA" : score >= 60 ? "MEDIA" : "BAIXA",
    sinais: signals
  } as const;
}
