export type MutationState = "idle" | "loading" | "success" | "error";
export type ErrorType = "validation" | "network" | "auth" | "conflict" | "unknown";

export type MutationError = {
  type: ErrorType;
  message: string;
  code?: string;
  statusCode?: number;
};

/** Formato mínimo de erro HTTP usado nos catch das mutações (axios-like). */
export type MutationHttpError = {
  response?: { status?: number; data?: { message?: string } };
  message?: string;
};

export function readMutationError(err: unknown): { status?: number; message?: string } {
  const e = err as MutationHttpError;
  return {
    status: e?.response?.status,
    message: e?.response?.data?.message ?? e?.message
  };
}

/** Resumo agregado de materialização por loja (compra+loja, nunca por item). */
export type MaterializationSummary = {
  storeId: string;
  storeName: string;
  itemCount: number;
  totalUnits: number;
};
