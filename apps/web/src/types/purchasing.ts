export type Supplier = { id: string; nome: string; ativo: boolean };
export type PurchaseOrder = {
  id: string;
  numeroPedido: string;
  status: string;
  allowedStatusTransitions: string[];
  subtotal: string;
  total: string;
  destinoPosicaoId: string;
  fornecedor: Supplier;
};
