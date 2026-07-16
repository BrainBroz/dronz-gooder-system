export type MutationState = "idle" | "loading" | "success" | "error";
export type ErrorType = "validation" | "network" | "auth" | "conflict" | "unknown";

export type MutationError = {
  type: ErrorType;
  message: string;
  code?: string;
  statusCode?: number;
};
