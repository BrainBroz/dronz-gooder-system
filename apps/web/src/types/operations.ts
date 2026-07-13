export type OperationalAction =
  | "CONFIRM_MIAMI"
  | "CONFIRM_PARAGUAY"
  | "CONFIRM_BRAZIL"
  | "OPEN_RECEIVING"
  | "CONFIRM_RECEIVING_ITEM"
  | "POST_DEFINITIVE_ENTRY";

export type BlockedReason = { code: string; message: string };
export type Actor = { id: string; name: string };
export type HistoryItem = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string | null;
  beforeData: JsonValue | null;
  afterData: JsonValue | null;
  createdAt: string;
  usuarioId: string | null;
};
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type History = { items: HistoryItem[]; nextCursor: string | null };

export type MiamiCandidate = {
  id: string;
  quantidade: number;
  quantidadeRecebidaMiami: number;
  quantidadePendente: number;
  alerta24h: boolean;
  produto: { id: string; codigo: number; nome: string; peso: string };
  pedido: { id: string; numeroPedido: string; status: string };
  recebimentosMiami: Array<{ id: string; quantidadeRecebida: number; recebidoEm: string; tipoDivergencia: string; confirmadoPor: Actor }>;
  allowedActions: OperationalAction[];
  blockedReasons: BlockedReason[];
  history?: History;
};

export type CheckpointCandidate = {
  id: string;
  codigo: string;
  viagemId: string;
  rotaCodigo: string;
  applicability?: "REQUIRED" | "NOT_APPLICABLE";
  requiredCheckpoints?: string[];
  status: string;
  checkpoint: { id: string; tipoDivergencia: string; confirmadoEm: string; confirmadoPor?: Actor } | null;
  allowedActions: OperationalAction[];
  blockedReasons: BlockedReason[];
  history?: History;
};

export type ReceivingCandidate = {
  id: string;
  codigo: string;
  viagemId: string;
  expectedItems: number;
  receiving: { id: string; status: string } | null;
  allowedActions: OperationalAction[];
  blockedReasons: BlockedReason[];
};

export type ReceivingItem = {
  id: string;
  quantidadeEsperada: number;
  quantidadeRecebida: number;
  quantidadeRejeitada: number;
  quantidadeJaIncorporada: number;
  tipoDivergencia: "CORRETO" | "FALTA" | "EXCESSO" | "AVARIA" | "ITEM_INCORRETO" | "OUTRO";
  divergenciaResolvida: boolean;
  observacoes: string | null;
  produto: { id: string; codigo: number; nome: string };
};
export type ReceivingDetail = {
  id: string;
  viagemId: string;
  malaId: string;
  status: string;
  itens: ReceivingItem[];
  progress: { total: number; completed: number; pending: number; divergent: number };
  allowedActions: OperationalAction[];
  blockedReasons: BlockedReason[];
  history: History;
};

export type DefinitiveCandidate = {
  id: string;
  viagemId: string;
  malaId: string;
  status: string;
  entryId: string | null;
  impactQuantity: number;
  items: Array<Omit<ReceivingItem, "produto" | "observacoes"> & { produtoId: string }>;
  allowedActions: OperationalAction[];
  blockedReasons: BlockedReason[];
  history?: History;
};

export type OperationsOverview = {
  lojaId: string;
  totals: {
    miamiPending?: number;
    miamiDivergent?: number;
    paraguayPending?: number;
    brazilPending?: number;
    receivingPending?: number;
    definitivePending?: number;
  };
  allowedActions: OperationalAction[];
};
