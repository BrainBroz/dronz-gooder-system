import type { PurchaseProvider, UnifiedPurchaseListItem } from "../../types/unified-purchases";

export type EntitySuggestion = {
  id: string;
  name: string;
  plataforma: string;
};

const MULTIPLE_PLATFORMS_LABEL = "Múltiplas plataformas";
const MULTIPLE_NAMES_LABEL = "Múltiplos nomes";

type Accumulator = { id: string; names: Set<string>; plataformas: Set<string> };

/**
 * Deriva sugestões de conta/merchant exclusivamente dos itens já carregados
 * na página atual da fila. Não é um cadastro completo — só reflete o que já
 * apareceu em alguma compra listada. Nunca busca páginas adicionais e nunca
 * bloqueia um ID que não esteja nesta lista (o formulário sempre aceita ID
 * manual como alternativa).
 *
 * Se o mesmo ID aparecer associado a mais de uma plataforma ou mais de um
 * nome nos itens carregados, o resultado nunca escolhe um valor
 * silenciosamente pela ordem de chegada — vira "Múltiplas plataformas" ou
 * "Múltiplos nomes". Os conjuntos são acumulados em `Set`, então o resultado
 * lógico independe da ordem de entrada dos itens.
 *
 * `platform`, quando informado, restringe a agregação a itens da mesma
 * plataforma — o backend rejeita `contaExternaId`/`merchantExternoId` cuja
 * plataforma real não bate com a da compra (`invalid_external_account`/
 * `invalid_external_merchant`), então sugestões de compra externa nunca
 * devem misturar plataformas diferentes da selecionada.
 */
function collectSuggestions(
  items: UnifiedPurchaseListItem[],
  pick: (item: UnifiedPurchaseListItem) => { id: string; name: string } | null,
  platform?: PurchaseProvider
): EntitySuggestion[] {
  const byId = new Map<string, Accumulator>();
  for (const item of items) {
    if (platform && item.provider !== platform) continue;
    const entity = pick(item);
    if (!entity) continue;
    const existing = byId.get(entity.id);
    if (existing) {
      existing.names.add(entity.name);
      existing.plataformas.add(item.provider);
    } else {
      byId.set(entity.id, {
        id: entity.id,
        names: new Set([entity.name]),
        plataformas: new Set([item.provider])
      });
    }
  }
  return Array.from(byId.values()).map((acc) => ({
    id: acc.id,
    name: acc.names.size > 1 ? MULTIPLE_NAMES_LABEL : [...acc.names][0],
    plataforma: acc.plataformas.size > 1 ? MULTIPLE_PLATFORMS_LABEL : [...acc.plataformas][0]
  }));
}

export function accountSuggestions(
  items: UnifiedPurchaseListItem[],
  platform?: PurchaseProvider
): EntitySuggestion[] {
  return collectSuggestions(items, (item) => item.account, platform);
}

export function merchantSuggestions(
  items: UnifiedPurchaseListItem[],
  platform?: PurchaseProvider
): EntitySuggestion[] {
  return collectSuggestions(items, (item) => item.merchant, platform);
}
