import axios from "axios";

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  sales_session_storage_unavailable:
    "Não foi possível preservar a tentativa. Habilite o armazenamento da sessão. Nenhum envio foi realizado.",
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
  permanent_position: "Posição permanente não é encerrada.",
  resolution_requires_evidence_choice: "Escolha qual evidência deve valer.",
  approved_purchase_requires_acknowledgement:
    "Compra já aprovada: registre ciência da evidência nova.",
  conflict_not_found: "Divergência já resolvida ou inexistente.",
  account_not_found: "Conta externa não encontrada para este marketplace.",
  buyer_currency_mismatch:
    "Itens em moeda diferente da compra: resolva antes de aprovar.",
  buyer_candidate_not_reviewable: "Esta compra não está aguardando aprovação.",
  legacy_purchase_requires_review:
    "Já existe compra importada com esta identidade.",
  buyer_candidate_cancelled: "Compra cancelada na origem.",
  approver_must_differ: "Quem propôs a correção não pode aprová-la.",
  request_already_decided: "Esta solicitação já foi decidida.",
  historical_replay_incomplete:
    "Há um replay histórico incompleto nesta conexão. Conclua o replay antes da sincronização incremental.",
  package_not_found: "Pacote não encontrado nesta compra.",
  sale_requires_sales_module: "Saída por venda só pelo módulo Vendas.",
  sale_not_draft: "A venda não está mais em rascunho.",
  lots_must_cover_item: "Os lotes escolhidos precisam cobrir a quantidade do item.",
  lot_insufficient: "O lote escolhido não tem saldo suficiente.",
  lot_not_eligible: "Lote inválido para este produto.",
  receipt_exceeds_receivable: "O recebimento ultrapassa o valor previsto.",
  statement_overpayment: "O pagamento ultrapassa o saldo da fatura.",
  statement_not_open: "A fatura não está aberta.",
  statement_already_paid: "A fatura já está quitada.",
  entry_exceeds_payment: "As parcelas ultrapassam o pagamento de origem.",
  installment_already_posted: "Esta parcela já foi lançada.",
  payment_not_card: "Só pagamentos com cartão entram em fatura.",
  payment_already_reconciled: "Este pagamento já está conciliado com outra fonte.",
  amount_mismatch: "O valor da fonte é diferente do pagamento.",
  reconciliation_already_reviewed: "Esta conciliação já foi revisada.",
  source_superseded: "A fonte tem versão mais nova; revise a versão atual.",
  expense_double_counting:
    "Essa origem já é custo ou transferência; não pode virar despesa de resultado.",
  expense_origin_already_classified: "Essa origem já foi classificada.",
  order_cancelled: "O pedido está cancelado.",
  sale_not_confirmed: "A venda não está confirmada.",
  sale_has_returns: "A venda tem devolução registrada; use a conferência da devolução.",
  receivable_has_receipts:
    "A venda já teve recebimento; registre o reembolso no financeiro antes do estorno.",
  return_exceeds_sold: "A devolução ultrapassa a quantidade vendida.",
  return_already_checked: "Esta devolução já foi conferida.",
  stock_lots_require_reconciliation:
    "Os lotes deste produto precisam de reconciliação no Estoque antes da venda.",
  lots_already_reconciled: "Não há saídas sem lote para reconciliar.",
  outflow_without_prior_lot: "Há saída anterior a qualquer entrada; investigue antes de reconciliar.",
  lots_still_unbalanced: "Mesmo reconciliados, os lotes não batem com o físico; investigue os ajustes.",
  lot_already_linked: "Este lote já está ligado a um item de compra.",
  lot_exceeds_purchase_item: "O item de compra não tem unidades suficientes para este lote.",
  product_mismatch: "O item de compra é de outro produto.",
  package_exceeds_item: "Os pacotes somam mais unidades do que o item comprado.",
  purchase_item_not_found: "Item de compra não encontrado neste pedido.",
  loss_requires_approval:
    "Perda acima do limite: registre uma proposta para aprovação por outro usuário.",
  loss_within_limit: "A perda está dentro do limite; registre o movimento direto.",
  package_item_not_declared: "Este pacote não tem este item declarado.",
  package_quantity_exceeded: "A quantidade passa do saldo declarado no pacote.",
  package_receipt_required:
    "As unidades restantes estão declaradas em pacote: escolha o pacote no recebimento."
};
const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: "Dados inválidos. Verifique os campos e tente novamente.",
  403: "Você não tem permissão para esta ação.",
  404: "Registro não encontrado.",
  409: "Já existe um registro com esses dados."
};

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && KNOWN_ERROR_MESSAGES[error.message])
    return KNOWN_ERROR_MESSAGES[error.message];
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
