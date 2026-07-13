export const operationalActions = [
  "CONFIRM_MIAMI",
  "CONFIRM_PARAGUAY",
  "CONFIRM_BRAZIL",
  "OPEN_RECEIVING",
  "CONFIRM_RECEIVING_ITEM",
  "POST_DEFINITIVE_ENTRY",
  "CORRECT_CHECKPOINT"
] as const;

export type OperationalAction = (typeof operationalActions)[number];

export type BlockedReason = {
  code: string;
  message: string;
};

export const routeCheckpoints = [
  "MIAMI",
  "PARAGUAI",
  "BRASIL",
  "RECEBIMENTO",
  "ENTRADA_DEFINITIVA"
] as const;

export type RouteCheckpoint = (typeof routeCheckpoints)[number];

export const hasPermission = (permissions: string[], code: string) =>
  permissions.includes("SYSTEM_ADMIN") || permissions.includes(code);
