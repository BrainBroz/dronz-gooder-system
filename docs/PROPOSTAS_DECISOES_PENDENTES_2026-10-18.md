# Propostas para decisões pendentes — 2026-10-18

Estado: **PROPOSTA, aguardando aprovação do Product Owner.** Nada aqui está implementado. Cada item só vira código depois de aprovado, em batch próprio. Itens que dependem de terceiros (e-mail, eBay, Amazon, transportadoras, planilha histórica, provider de anexos) ficam fora desta lista.

Para cada item: o problema, a recomendação e a alternativa considerada.

| ID | Tema | Recomendação | Alternativa |
| --- | --- | --- | --- |
| PD-01 | Correção de venda confirmada | **Cancelamento por estorno vinculado.** Comando `VENDA_CORRIGIR` gera uma reversão ligada à venda original. O estoque volta por RETURN_ENTRY no mesmo lote, só se o item comprovadamente não saiu (motivo obrigatório e auditoria). Custo e receita do original ficam intactos; o estorno aparece separado nos relatórios. | Editar a venda confirmada (rejeitada: apaga o histórico). |
| PD-02 | Devolução física de cliente | **Fluxo em duas etapas.** (1) Registrar a devolução esperada (`DEVOLUCAO_PENDENTE`) sem mexer em estoque nem financeiro. (2) `DEVOLUCAO_CONFERIR` confere a unidade (condição D-4); se apta, cria RETURN_ENTRY como lote novo, com o custo do lote original. O reembolso ao cliente é lançamento financeiro separado e não repõe estoque. | Repor estoque ao registrar o reembolso (rejeitada pela §15). |
| PD-03 | Lotes legados | **Lote sem custo continua vendável, com alerta.** ENTRY anterior ao B17 sem `pedidoCompraItemId` aparece como "sem custo de compra"; a venda sai sem lucro calculado. Uma tela de reconciliação permite ligar o lote ao item de compra com motivo e auditoria. Saídas antigas sem lote (perda/ajuste) consomem os lotes mais antigos só na reconciliação, nunca de forma automática. | Bloquear a venda de lotes sem custo até reconciliar. |
| PD-04 | Quantidade por pacote | **Vínculo pacote → item opcional, com quantidade.** O recebimento pode informar de qual pacote veio cada unidade; com isso, "a caminho" por posição passa a ser calculado por pacote. Sem o vínculo, mantém-se o cálculo pelo pedido (comportamento atual). | Identidade unitária (número de série por unidade): adiar até haver leitura por código. |
| PD-05 | RBAC das rotas legadas de status de viagem e mala | **Exigir `LOGISTICA_POSICOES_GERENCIAR`** nas rotas `PATCH` de status de viagem e de mala (hoje só autenticação e escopo de loja). | Criar uma capacidade nova `LOGISTICA_STATUS_ALTERAR`. |
| PD-06 | Mala fechada com itens e viagem a cancelar | **Reabrir com motivo (D-14) antes de desalocar.** Reutiliza o fluxo atual de reabertura; o cancelamento da viagem continua bloqueado enquanto houver itens. | Cancelar a viagem desalocando tudo automaticamente (rejeitada: perde a rastreabilidade). |
| PD-07 | Replay histórico e sincronização incremental | **Bloquear a incremental enquanto houver replay histórico incompleto na mesma conexão**, mostrando o motivo na tela de integrações. | Permitir as duas em paralelo, com risco de cursor inconsistente. |
| PD-08 | Janela "quinta-feira de manhã" (P-08) | **Das 08h00 às 12h00 no fuso da posição de origem**, gerando só alerta (sem bloqueio). | Fixar em America/New_York para todas as posições. |
| PD-09 | Vigência da cotação (E-2) | **A cotação vale até a próxima registrada para o mesmo par.** Ao usar uma cotação com mais de 7 dias, a tela avisa, sem bloquear. O custo guarda o ID da cotação usada (snapshot). | Validade fixa e bloqueio quando expirar. |
| PD-10 | Cancelados e reembolsados na visão ativa (E-3) | **Ocultos por padrão, com filtro "incluir cancelados/reembolsados"**, e os totais sempre mostram bruto, cancelado, reembolsado e líquido separadamente. | Sempre visíveis. |
| PD-11 | Competência de encargos tardios (E-4) | **Competência do pedido original**, com marca "lançado após o fechamento" e data de lançamento visível. | Competência da data de lançamento. |
| PD-12 | Aprovador de perda e ajuste valorado (E-5) | **Reutilizar `CORRECAO_PATRIMONIAL_APROVAR` (D-17)** com o mesmo fluxo de proposta e aprovação para perda e ajuste negativo acima de um limite; abaixo do limite, `ESTOQUE_AJUSTAR` basta. O limite inicial é o PO quem define. | Toda perda exige aprovação. |
| PD-13 | Permissões novas para operadores (E1/F1) | **`GESTOR_LOJA` recebe Financeiro, Vendas e Analytics (já feito no seed) e as capacidades Buyer de revisão e aprovação.** O perfil Miami continua sem financeiro e sem vendas. | Manter as capacidades Buyer só no SUPER_ADMIN. |

## Como aprovar

Responder "aprovar todas" ou listar os IDs com ajuste. Depois da aprovação, os itens viram batches na ordem: PD-05 e PD-07 (sem schema novo), PD-01, PD-02 e PD-03 (vendas e estoque), PD-04, depois PD-08 a PD-12. PD-13 é só configuração de perfis.
