export const unifiedPurchaseActions = [
  "ASSIGN_TO_STORE",
  "REMOVE_ASSIGNMENT",
  "SET_PRODUCT_MAPPING",
  "REMOVE_PRODUCT_MAPPING",
  "SET_SUPPLIER_MAPPING",
  "MATERIALIZE_STORE_ALLOCATION",
  "RESOLVE_CONFLICT",
  "CREATE_MANUAL_PURCHASE"
] as const;

export type UnifiedPurchaseAction = (typeof unifiedPurchaseActions)[number];

export type BlockedReason = { code: string; message: string };
export type PurchaseProgress = {
  total: number;
  assigned: number;
  materialized: number;
  pending: number;
};

export type UnifiedPurchaseOverview = {
  totalOrders: number;
  totalItems: number;
  unassigned: number;
  partiallyAssigned: number;
  fullyAssigned: number;
  materialized: number;
  pending: number;
  conflicts: number;
  mappingsPending: number;
  byProvider: Partial<Record<PurchaseProvider, number>>;
  allowedActions: UnifiedPurchaseAction[];
};

export type UnifiedPurchaseListItem = {
  id: string;
  provider: string;
  account: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
  reference: string;
  orderedAt: string | null;
  currency: string;
  state: string;
  itemCount: number;
  progress: PurchaseProgress;
  conflictCount: number;
  allowedActions: UnifiedPurchaseAction[];
  blockedReasons: BlockedReason[];
};

export type UnifiedPurchasePage = {
  items: UnifiedPurchaseListItem[];
  page: number;
  limit: number;
  total: number;
};

export type StoreAssignment = {
  id: string;
  lojaId: string;
  quantidade: number;
  quantidadeMaterializada: number;
  version: number;
  loja: { id: string; nome: string; slug: string };
};

export type ProductMapping = {
  id: string;
  lojaId: string;
  produtoId: string;
  version: number;
  status: string;
  produto: { id: string; codigo: number; nome: string };
  loja: { id: string; nome: string };
};

export type UnifiedPurchaseItemDetail = {
  id: string;
  titulo: string;
  variacao: string | null;
  skuExterno: string | null;
  asin: string | null;
  externalLineIdOriginal: string | null;
  quantidade: number;
  quantidadeCancelada: number;
  quantidadeReembolsada: number;
  precoUnitario: string;
  moeda: string;
  status: string;
  version: number;
  atribuicoes: StoreAssignment[];
  mapeamentos: ProductMapping[];
  itensMaterializados: Array<{
    id: string;
    lojaId: string;
    quantidade: number;
  }>;
};

export type PurchaseConflict = {
  id: string;
  tipo: string;
  status: string;
  referencia: string;
  motivoResolucao: string | null;
  createdAt: string;
};

export type PurchaseMaterialization = {
  id: string;
  lojaId: string;
  status: string;
  pedidoCompraId: string;
  createdAt: string;
  pedidoCompra: { id: string; numeroPedido: string; status: string };
};

export type PurchaseHistoryEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  usuarioId: string | null;
  lojaId: string | null;
  reason: string | null;
  createdAt: string;
};

export type UnifiedPurchaseDetail = {
  id: string;
  plataforma: string;
  numeroPedido: string;
  referenciaPesquisavel: string | null;
  externalOrderIdOriginal: string | null;
  dataPedido: string | null;
  moeda: string;
  estado: string;
  version: number;
  contaExterna: { id: string; nomeExibicao: string } | null;
  merchantExterno: { id: string; nomeOriginal: string } | null;
  merchantExternoId: string | null;
  itens: UnifiedPurchaseItemDetail[];
  materializacoes: PurchaseMaterialization[];
  conflitos: PurchaseConflict[];
  history: PurchaseHistoryEntry[];
  allowedActions: UnifiedPurchaseAction[];
  blockedReasons: BlockedReason[];
};

export type PurchaseProvider =
  "AMAZON" | "EBAY" | "WALMART" | "BEST_BUY" | "APPLE" | "OUTRA" | "MANUAL";

export type UnifiedPurchaseFilters = {
  page: number;
  limit: number;
  estado?: "IMPORTADA" | "EM_REVISAO" | "CANCELADA" | "COM_DIVERGENCIA";
  plataforma?: PurchaseProvider;
  contaExternaId?: string;
  merchantExternoId?: string;
  referencia?: string;
  from?: string;
  to?: string;
  lojaId?: string;
};
