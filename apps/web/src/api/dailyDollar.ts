import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { authHeader } from "../stores/auth";
import { economicQueryKeys } from "../queryKeys";
import type { CotacaoVigente } from "./economic";

const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Registra o dólar comercial do dia ao abrir a tela quando a cotação vigente não é de hoje.
 * Uma tentativa por loja e por abertura; falha em silêncio (a cotação antiga segue marcada como tal e o botão manual continua).
 */
export function useDailyDollar(store: string | null, canWrite: boolean, data: { cotacao: CotacaoVigente | null } | undefined) {
  const client = useQueryClient();
  const tried = useRef<string | null>(null);
  const { mutate } = useMutation({
    mutationFn: (storeId: string) =>
      api.post("/economic-settings/exchange-rate/dolar", {}, { headers: { ...authHeader(), "x-store-id": storeId, "Idempotency-Key": crypto.randomUUID() } }),
    onSuccess: (_result, storeId) => client.invalidateQueries({ queryKey: economicQueryKeys.exchangeRate(storeId) })
  });
  const stale = !!data && (!data.cotacao || day(new Date(data.cotacao.cotadoEm)) !== day(new Date()));
  useEffect(() => {
    if (!canWrite || !store || !stale || tried.current === store) return;
    tried.current = store;
    mutate(store);
  }, [canWrite, store, stale, mutate]);
}
