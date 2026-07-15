/**
 * Tipos da navegação-alvo (UX_OPERATIONAL_FOUNDATION_V1.md §5).
 * Declarativos apenas: não são consumidos pelo shell atual nesta etapa.
 */

export type NavigationBadgeSource =
  | "backend-pending-work" // contagem de trabalho pendente, nunca contagem local
  | "none";

export type NavigationItem = {
  key: string;
  label: string;
  path: string;
  /** Permissão(ões) que autorizam a exibição do item. Vazio = sempre visível a autenticados. */
  requiredPermissions?: readonly string[];
  badgeSource?: NavigationBadgeSource;
  children?: readonly NavigationItem[];
};

export type NavigationGroup = {
  key: string;
  title: string;
  /** Título de exibição da área, quando diferente do menu (ex.: "ENVIOS E LOGÍSTICA"). */
  areaTitle?: string;
  items: readonly NavigationItem[];
};
