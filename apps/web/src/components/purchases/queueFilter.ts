import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";

export type QuickFilterKey =
  | "all"
  | "mappingsPending"
  | "unassigned"
  | "conflicts"
  | "readyToMaterialize";

/**
 * Filtro rápido aplicado sobre os itens já carregados na página atual.
 *
 * O endpoint de listagem (`/imported-purchases`) não suporta filtrar por
 * estas categorias no servidor — só por estado/plataforma/conta/merchant/
 * período/loja. Alterar isso é mudança de contrato, fora do escopo deste
 * batch (estrutural, somente leitura). Por isso o filtro aqui atua apenas
 * sobre a página já carregada; os números dos cards de urgência vêm do
 * `overview` (contagem global do backend) e podem não bater 1:1 com a
 * quantidade de linhas visíveis após o filtro rápido — isso é esperado
 * até existir suporte a filtro server-side por categoria.
 */
export function matchesQuickFilter(
  item: UnifiedPurchaseListItem,
  key: QuickFilterKey
): boolean {
  switch (key) {
    case "all":
      return true;
    case "mappingsPending":
      return item.allowedActions.includes("SET_PRODUCT_MAPPING");
    case "unassigned":
      return item.allowedActions.includes("ASSIGN_TO_STORE");
    case "conflicts":
      return item.conflictCount > 0;
    case "readyToMaterialize":
      return item.allowedActions.includes("MATERIALIZE_STORE_ALLOCATION");
    default:
      return true;
  }
}
