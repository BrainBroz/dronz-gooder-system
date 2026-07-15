import type { NavigationGroup } from "./types";

/**
 * Árvore-alvo declarada em UX_OPERATIONAL_FOUNDATION_V1.md §5.
 *
 * Não é consumida por app.tsx nesta etapa (UX-0). Existe para que os
 * batches UX-1 em diante tenham uma fonte única e testada da estrutura
 * aprovada, em vez de recriá-la ad hoc por página.
 *
 * Esta árvore é EXCLUSIVAMENTE DECLARATIVA:
 * - não é fonte de verdade para RBAC — não decide quem vê o quê;
 * - não calcula badges — `badgeSource` apenas indica de onde a
 *   contagem deve vir quando existir, nunca é um valor calculado aqui;
 * - não decide estados operacionais, bloqueios ou disponibilidade.
 * Toda filtragem por permissão, toda contagem e todo indicador devem
 * consumir os contratos e read models do backend (allowedActions,
 * blockedReasons e afins) no momento em que forem implementados.
 *
 * `requiredPermissions` fica vazio propositalmente: a regra definitiva
 * de RBAC por item é decisão de implementação de cada batch, derivada
 * de permissões reais do usuário — nunca hardcode de nome ou papel.
 */
export const navigationTree: readonly NavigationGroup[] = [
  {
    key: "overview",
    title: "Visão Geral",
    items: [{ key: "overview.home", label: "Visão Geral", path: "/" }]
  },
  {
    key: "purchases",
    title: "Compras",
    items: [
      { key: "purchases.queue", label: "Fila", path: "/compras/fila", badgeSource: "backend-pending-work" },
      { key: "purchases.incoming", label: "A caminho", path: "/compras/a-caminho" },
      { key: "purchases.receiving", label: "Recebimento", path: "/compras/recebimento", badgeSource: "backend-pending-work" },
      { key: "purchases.divergences", label: "Divergências", path: "/compras/divergencias", badgeSource: "backend-pending-work" }
    ]
  },
  {
    key: "logistics",
    title: "LOGÍSTICA",
    areaTitle: "ENVIOS E LOGÍSTICA",
    items: [
      { key: "logistics.overview", label: "Visão operacional", path: "/logistica" },
      { key: "logistics.positions", label: "Posições", path: "/logistica/posicoes" },
      { key: "logistics.preparation", label: "Preparação", path: "/logistica/preparacao" },
      { key: "logistics.transport", label: "Transporte", path: "/logistica/transporte" },
      { key: "logistics.history", label: "Histórico", path: "/logistica/historico" }
    ]
  },
  {
    key: "inventory",
    title: "Estoque",
    items: [{ key: "inventory.home", label: "Estoque", path: "/estoque" }]
  },
  {
    key: "products",
    title: "Produtos",
    items: [{ key: "products.home", label: "Produtos", path: "/produtos" }]
  },
  {
    key: "finance",
    title: "Financeiro",
    items: [{ key: "finance.home", label: "Financeiro", path: "/financeiro", badgeSource: "backend-pending-work" }]
  },
  {
    key: "reports",
    title: "Relatórios",
    items: [{ key: "reports.home", label: "Relatórios", path: "/relatorios" }]
  },
  {
    key: "administration",
    title: "Administração",
    items: [
      { key: "administration.users", label: "Usuários", path: "/administracao/usuarios" },
      { key: "administration.integrations", label: "Integrações", path: "/administracao/integracoes" },
      { key: "administration.settings", label: "Configurações", path: "/administracao/configuracoes" },
      { key: "administration.categories", label: "Categorias", path: "/administracao/categorias" },
      { key: "administration.suppliers", label: "Fornecedores", path: "/administracao/fornecedores" }
    ]
  }
] as const;
