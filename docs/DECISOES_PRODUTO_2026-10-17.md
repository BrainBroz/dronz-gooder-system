# Decisões de produto aprovadas — 2026-10-17

**Aprovação:** Product Owner, em sessão de 2026-10-17. As propostas concretas da "Especificação de Desenvolvimento Dronz e Gooder" v1.0 (§19) foram aprovadas como recomendadas, com as exceções abaixo. A ordem de entrega aprovada (X-09) é **logística primeiro** (UX-4 a UX-7), seguida das frentes de compras/integrações e financeiro/vendas.

**Precedência:** estas decisões complementam F-1…F-12 (`UX_OPERATIONAL_FOUNDATION_V1.md`) e não as substituem.
- X-02 (rateio por maiores resíduos) **não foi adotada**: vale F-2.
- DEC-DOM-001 (reembolso sem efeito no elegível) **não foi adotada**: vale F-1.
- D-3 já estava encerrada por F-7: o bloqueio acima de 23 kg continua.

Cada decisão autoriza a implementação do batch indicado; ela não declara a funcionalidade implementada.

## Operação física (D-1 a D-17)

| ID | Decisão aprovada | Batch |
|---|---|---|
| D-1 | Manter mapping merchant → fornecedor por loja. Fornecedor pode ser criado sob demanda na revisão autorizada; sincronização nunca duplica merchant automaticamente. | Compras/BE-E |
| D-2 | Adotar Local, PosicaoOperacional, ResponsabilidadeContextual, EnvioOperacional e VolumeEnvio, reaproveitando as entidades existentes (Viagem, Mala, VolumeLogistico, AlocacaoMala) por migração compatível. | UX-4/UX-5 |
| D-3 | Encerrada por F-7: fechamento acima de 23 kg bloqueado. | — |
| D-4 | Condição em dimensões separadas: comercial (NAO_DEFINIDA, NOVO, CAIXA_ABERTA, USADO), funcionamento (NAO_TESTADO, FUNCIONAL, DEFEITO_PARCIAL, INOPERANTE), acessórios ausentes (lista + observação) e registro em nome de terceiro (atributo restrito). Valores antigos são mapeados explicitamente, preservando a descrição original. | UX-4 (BE-C) |
| D-5 | Usar os ícones e dependências existentes; pacote novo só com aprovação. | UX |
| D-6 | Anexos em armazenamento privado: JPEG, PNG e PDF até 10 MiB, acesso por escopo e URL temporária. Provider e retenção são definidos antes da ativação. | BE-D |
| D-7 | Visões amplas mostram cidade e alias; endereço completo só para quem recebe ou transporta naquela posição, dentro da vigência. | UX-4 |
| D-8 | Viajante pode existir sem usuário. Acesso do viajante exige vínculo explícito com usuário ativo e contexto válido. | UX-4/UX-5 |
| D-9 | Um responsável principal por contexto e período, com delegações explícitas; sem sobreposição de principais. | UX-4 |
| D-10 | Posição temporária é encerrada por ato manual, depois de zerar pendências. O sistema sugere o encerramento, mas não o executa por data. | UX-4 |
| D-11 | Caixa e mala podem levar linhas das duas lojas somente com acesso operacional autorizado a todas as linhas; cada linha mantém loja e custos próprios. | UX-5 |
| D-12 | Autorização por usuário ativo + capacidade + loja (quando aplicável) + posição/viagem/envio + vigência. Negar por padrão. | UX-4/UX-5 |
| D-13 | Handoff registra sempre quem entregou, quem recebeu, instante e volumes. Evidência obrigatória para caixa e opcional para mala, salvo política da viagem. Exigência de anexo só após D-6 ativo. | UX-5 |
| D-14 | Depois do fechamento e antes do trânsito, mudar a composição exige reabertura auditada com motivo. Após a saída, só evento próprio de desvio/correção. | UX-5 |
| D-15 | Destino por pacote, herdando o padrão da compra. Alteração autorizada e auditada antes do recebimento; depois, transferência operacional. | UX-4 |
| D-16 | Pacote tardio em posição encerrada gera pendência e bloqueia o recebimento normal. Resolve-se por redirecionamento ou reabertura auditada, nunca automaticamente. | UX-4 |
| D-17 | Correção operacional pela capacidade da etapa. Impacto patrimonial ou multiloja exige aval adicional, com proponente e aprovador separados quando a política estiver ativa. | UX-6/UX-7 |

## Complementares (X-01 a X-15)

| ID | Decisão aprovada | Batch |
|---|---|---|
| X-01 | Tolerância zero na comparação de valores na mesma moeda: toda diferença é exibida e o revisor registra aceitação ou correção. Tolerância nunca resolve divergência de moeda ou quantidade. | Batch 10/12 |
| X-02 | **Não adotada.** Vale F-2. | — |
| X-03 | Score 0–100 = 25I + 25Q + 15M + 15V + 10E + 10T (1 comprovado / 0,5 fonte única estruturada / 0 ausente ou conflitante). Faixas: ALTA ≥ 85, MÉDIA 60–84, BAIXA < 60, HALF_UP. Sem efeito autorizativo; recalibrar com amostras antes de produção. | Batch 10 |
| X-04 | Novos campos: Money Decimal(18,2); preço/câmbio Decimal(18,6); kg Decimal(18,3); quantidade inteira. Campos existentes mantêm a escala atual. | Todos |
| X-05 | Um pedido por compra e loja; complemento por parcela rastreável após a primeira materialização. Antes do downstream, complemento explícito no mesmo pedido; depois, nova parcela com confirmação adicional. Sem materialização negativa. | Compras |
| X-06 | Correção por diferença vinculada ao original, limitada ao movimento original e sem saldo negativo. Consumo incompatível abre caso próprio; venda nunca é desfeita automaticamente. | UX-7 |
| X-07 | Entrada das unidades aptas é permitida; as demais ficam pendentes ou bloqueadas. O recebimento só encerra quando toda quantidade esperada tem destino final. | UX-6/UX-7 |
| X-08 | Parâmetros de taxa/câmbio com valor, vigência e snapshot por operação; referência e acréscimo guardados separadamente e aplicados uma vez. Nenhum default histórico é ativado. A margem fixa atual (0,20) passa a ser parâmetro informado. | Financeiro |
| X-09 | Logística primeiro (UX-4 a UX-7); depois compras/integrações (B10–B13), respeitando os gates externos; depois B14–B18. | Roadmap |
| X-10 | Custo específico por lote/parcela incorporada, com sugestão FIFO confirmada no comando; snapshot do custo na venda. | B17 |
| X-11 | Preservar os TTLs de sessão atuais; RNF-01 a RNF-07 são alvos de homologação a medir. | Operação |
| X-12 | E-mail: caixa dedicada; provider, mailboxes, responsável OAuth, anexos e retenção definidos antes de ativar. | B12 |
| X-13 | Mês operacional em America/Sao_Paulo para timestamp; data sem hora conserva o dia declarado. Deadline Miami inclusivo até 14h00; "quinta de manhã" continua só texto. | B13/alertas |
| X-14 | V1 online; rascunho local só durante a sessão; nada é confirmado offline. | UX |
| X-15 | Preservar IDs e aliases; dados reais só por lote reconciliado; fixtures sintéticas nunca viram cadastro produtivo. | Migração |

## Dependências externas que continuam bloqueando a ativação (não o código)

- eBay Buyer: credenciais de produção em SecretProvider seguro.
- E-mail: caixa autorizada e OAuth (X-12).
- Painel mensal: planilha histórica real.
- Amazon Business: onboarding e papel Business Analytics.
- Anexos: provider de armazenamento e política de retenção (D-6).
- Produção: infraestrutura, backup/restauração e domínio (G6).
