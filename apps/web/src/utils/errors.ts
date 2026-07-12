import axios from "axios";

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  bad_request: "Dados inválidos. Verifique os campos e tente novamente.",
  conflict: "Já existe um registro com esses dados.",
  not_found: "Registro não encontrado.",
  forbidden: "Você não tem permissão para esta ação."
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
