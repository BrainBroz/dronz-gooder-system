import type { OperationalAction } from "../../types/operations";

export type OperationForm = "miami" | "checkpoint-paraguay" | "checkpoint-brazil" | "open-receiving" | "confirm-receiving-item" | "definitive-entry";

export type OperationActionPresentation = {
  label: string;
  form: OperationForm;
  url: string;
  successMessage: string;
};

export const operationActionPresentation: Record<OperationalAction, OperationActionPresentation> = {
  CONFIRM_MIAMI: {
    label: "Confirmar em Miami",
    form: "miami",
    url: "/logistics/miami-confirmations",
    successMessage: "Recebimento em Miami confirmado."
  },
  CONFIRM_PARAGUAY: {
    label: "Confirmar Paraguai",
    form: "checkpoint-paraguay",
    url: "/logistics/checkpoint-paraguai",
    successMessage: "Checkpoint Paraguai confirmado."
  },
  CONFIRM_BRAZIL: {
    label: "Confirmar Brasil",
    form: "checkpoint-brazil",
    url: "/logistics/checkpoint-brasil",
    successMessage: "Checkpoint Brasil confirmado."
  },
  OPEN_RECEIVING: {
    label: "Abrir recebimento",
    form: "open-receiving",
    url: "/receiving",
    successMessage: "Recebimento aberto."
  },
  CONFIRM_RECEIVING_ITEM: {
    label: "Conferir",
    form: "confirm-receiving-item",
    url: "/receiving/:receivingId/items/:itemId/confirm",
    successMessage: "Item conferido."
  },
  POST_DEFINITIVE_ENTRY: {
    label: "Fazer entrada definitiva",
    form: "definitive-entry",
    url: "/receiving/entrada-definitiva",
    successMessage: "Entrada definitiva concluída."
  }
};
