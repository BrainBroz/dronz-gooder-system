import axios from "axios";

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  bad_request: "Dados inválidos. Verifique os campos e tente novamente.",
  conflict: "Já existe um registro com esses dados.",
  not_found: "Registro não encontrado.",
  forbidden: "Você não tem permissão para esta ação.",
  insufficient_permission: "Você não tem permissão para esta ação.",
  concurrent_modification:
    "Este registro foi alterado ao mesmo tempo. Atualize e tente novamente.",
  idempotency_conflict: "Esta solicitação já foi registrada com outros dados.",
  currency_mismatch: "A moeda do pagamento é diferente da moeda do pedido.",
  overpayment: "O pagamento ultrapassa o total do pedido.",
  refund_exceeds_payment: "O estorno ultrapassa o valor pago.",
  insufficient_stock: "Saldo insuficiente para este movimento.",
  weight_limit: "A mala ultrapassaria o limite de peso.",
  position_not_authorized: "Você não está designado para operar nesta posição.",
  position_closed:
    "A posição está encerrada. Redirecione o pedido ou reabra a posição.",
  position_inactive: "A posição ainda não está ativa.",
  destination_mismatch: "Este pedido está destinado a outra posição.",
  already_received:
    "O pedido já teve recebimento; o destino não pode mais ser alterado.",
  reason_required: "Informe o motivo.",
  trip_departed: "A viagem já saiu; a composição não pode ser reaberta.",
  principal_overlap: "Já existe um responsável principal nesse período.",
  invalid_timezone:
    "Fuso horário inválido (use o padrão IANA, ex.: America/New_York).",
  invalid_period: "Período inválido.",
  duplicate_code: "Já existe uma posição com esse código.",
  items_not_received: "Ainda há itens destinados não recebidos.",
  volumes_not_dispatched: "Ainda há malas não despachadas nesta posição.",
  reservations_open: "Ainda há reservas em aberto nesta posição.",
  permanent_position: "Posição permanente não é encerrada."
};
const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: "Dados inválidos. Verifique os campos e tente novamente.",
  403: "Você não tem permissão para esta ação.",
  404: "Registro não encontrado.",
  409: "Já existe um registro com esses dados."
};

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.error;
    if (typeof code === "string" && KNOWN_ERROR_MESSAGES[code]) {
      return KNOWN_ERROR_MESSAGES[code];
    }
    const status = error.response?.status;
    if (status && STATUS_FALLBACK_MESSAGES[status]) {
      return STATUS_FALLBACK_MESSAGES[status];
    }
  }
  return "Falha na operação. Tente novamente.";
}
