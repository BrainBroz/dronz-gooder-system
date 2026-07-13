import type { UnifiedPurchaseAction } from "../../types/unified-purchases";

export type UnifiedPurchaseActionPresentation = {
  label: string;
  intent:
    | "assign"
    | "remove-assignment"
    | "product-mapping"
    | "supplier-mapping"
    | "materialize"
    | "resolve"
    | "manual";
  method: "POST" | "PUT" | "DELETE";
  successMessage: string;
};

export const unifiedPurchaseActionPresentation: Record<
  UnifiedPurchaseAction,
  UnifiedPurchaseActionPresentation
> = {
  ASSIGN_TO_STORE: {
    label: "Atribuir à loja",
    intent: "assign",
    method: "PUT",
    successMessage: "Atribuição atualizada."
  },
  REMOVE_ASSIGNMENT: {
    label: "Remover atribuição",
    intent: "remove-assignment",
    method: "DELETE",
    successMessage: "Atribuição removida."
  },
  SET_PRODUCT_MAPPING: {
    label: "Mapear produto",
    intent: "product-mapping",
    method: "PUT",
    successMessage: "Produto mapeado."
  },
  REMOVE_PRODUCT_MAPPING: {
    label: "Remover mapping de produto",
    intent: "product-mapping",
    method: "DELETE",
    successMessage: "Mapping removido."
  },
  SET_SUPPLIER_MAPPING: {
    label: "Mapear fornecedor",
    intent: "supplier-mapping",
    method: "PUT",
    successMessage: "Fornecedor mapeado."
  },
  MATERIALIZE_STORE_ALLOCATION: {
    label: "Materializar pedido operacional",
    intent: "materialize",
    method: "POST",
    successMessage: "Pedido operacional materializado."
  },
  RESOLVE_CONFLICT: {
    label: "Resolver conflito",
    intent: "resolve",
    method: "POST",
    successMessage: "Conflito resolvido."
  },
  CREATE_MANUAL_PURCHASE: {
    label: "Criar compra manual",
    intent: "manual",
    method: "POST",
    successMessage: "Compra manual criada."
  }
};
