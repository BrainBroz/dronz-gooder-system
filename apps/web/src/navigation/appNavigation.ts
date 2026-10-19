import type { IconName } from "../components/layout/icons";

/**
 * Navegação principal no formato da referência Bolt: grupos com submenus.
 *
 * Só aponta para rotas que existem em app.tsx. `permissions` apenas esconde atalhos (qualquer uma das
 * listadas basta; vazio = qualquer usuário autenticado). A autorização continua no backend.
 */
export type AppNavLink = {
  label: string;
  path: string;
  permissions?: readonly string[];
};

export type AppNavGroup = {
  key: string;
  label: string;
  icon: IconName;
  /** Item direto, sem submenu. */
  path?: string;
  permissions?: readonly string[];
  children?: readonly AppNavLink[];
};

export const appNavigation: readonly AppNavGroup[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", path: "/" },
  {
    key: "purchases",
    label: "Compras",
    icon: "cart",
    children: [
      { label: "Fila de compras", path: "/compras", permissions: ["COMPRAS_IMPORTADAS_VISUALIZAR"] },
      { label: "Revisão de compras", path: "/compras/revisao", permissions: ["BUYER_INGESTION_VISUALIZAR"] },
      { label: "Pedidos operacionais", path: "/pedidos", permissions: ["PEDIDOS_COMPRA_VISUALIZAR"] },
      { label: "Painel mensal", path: "/compras/painel-mensal", permissions: ["COMPRAS_IMPORTADAS_VISUALIZAR"] },
      { label: "Simulador de compra", path: "/compras/simulador", permissions: ["SIMULACAO_VISUALIZAR", "SIMULACAO_GERENCIAR"] }
    ]
  },
  {
    key: "logistics",
    label: "Logística",
    icon: "plane",
    children: [
      { label: "Viagens e malas", path: "/logistica" },
      { label: "Posições", path: "/posicoes" },
      { label: "Checkpoints", path: "/checkpoints" }
    ]
  },
  {
    key: "inventory",
    label: "Estoque",
    icon: "warehouse",
    path: "/estoque",
    permissions: ["ESTOQUE_VISUALIZAR", "RECEBIMENTO_VISUALIZAR"]
  },
  {
    key: "products",
    label: "Produtos",
    icon: "package",
    path: "/produtos",
    permissions: ["CATALOGO_VISUALIZAR"]
  },
  {
    key: "finance",
    label: "Vendas e Financeiro",
    icon: "dollar",
    children: [
      { label: "Vendas", path: "/vendas", permissions: ["VENDA_VISUALIZAR"] },
      { label: "Financeiro", path: "/financeiro", permissions: ["FINANCEIRO_VISUALIZAR"] }
    ]
  },
  {
    key: "reports",
    label: "Relatórios",
    icon: "chart",
    children: [
      { label: "Relatórios", path: "/relatorios", permissions: ["ANALYTICS_VISUALIZAR"] },
      { label: "Resumo analítico", path: "/operacao", permissions: ["ANALYTICS_VISUALIZAR"] }
    ]
  },
  {
    key: "administration",
    label: "Administração",
    icon: "settings",
    children: [
      { label: "Categorias", path: "/categorias", permissions: ["CATALOGO_VISUALIZAR"] },
      { label: "Fornecedores", path: "/fornecedores", permissions: ["CATALOGO_VISUALIZAR"] },
      { label: "Configurações econômicas", path: "/configuracoes", permissions: ["FINANCEIRO_VISUALIZAR", "SIMULACAO_VISUALIZAR"] }
    ]
  }
];

const allowed = (required: readonly string[] | undefined, granted: readonly string[]) =>
  !required?.length ||
  granted.includes("SYSTEM_ADMIN") ||
  required.some((code) => granted.includes(code));

/** Grupos e links visíveis para as permissões dadas; grupo sem nenhum link visível some. */
export function visibleNavigation(granted: readonly string[]) {
  return appNavigation.flatMap((group) => {
    if (!group.children) return allowed(group.permissions, granted) ? [group] : [];
    const children = group.children.filter((child) => allowed(child.permissions, granted));
    return children.length ? [{ ...group, children }] : [];
  });
}

/** Rótulo da página atual (para o cabeçalho), pela rota mais específica conhecida. */
export function currentPageLabel(pathname: string) {
  const links = appNavigation.flatMap((group) =>
    group.children
      ? group.children.map((child) => ({ ...child, group: group.label }))
      : group.path
        ? [{ label: group.label, path: group.path, group: group.label }]
        : []
  );
  const match = links
    .filter((link) =>
      link.path === "/" ? pathname === "/" : pathname === link.path || pathname.startsWith(`${link.path}/`)
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match ? { group: match.group, label: match.label } : null;
}
