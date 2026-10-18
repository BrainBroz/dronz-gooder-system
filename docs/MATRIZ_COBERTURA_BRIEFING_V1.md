# Matriz de Cobertura do Briefing V1

## 1. Status e uso

**Atualizada em:** 2026-10-18
**Baseline funcional:** `5b39eb8` (merge da PR #16, incluindo B17/B18). A matriz original de 2026-07-13 usava `f413791`.

Esta matriz compara o resumo disponível do briefing “Sistema de Gestão de Compras e Logística” e as decisões de produto aprovadas com a baseline integrada até B18. O briefing integral continua não localizado; portanto, não se declara cobertura integral de um documento indisponível. `NÃO LOCALIZADO` indica ausência de requisito canônico suficiente e não autoriza implementação por suposição.

Fontes de estado: `AGENTS.md`, `PROJECT_CONTEXT_MASTER.md`, contratos normativos, schema, migrations, código e testes. Os detalhes permanecem nos contratos; esta matriz registra somente cobertura e lacuna.

Classificações: `IMPLEMENTADO`, `PARCIAL`, `PLANEJADO`, `FORA DO ESCOPO ATUAL` e `NÃO LOCALIZADO`.

## 2. Cobertura consolidada

| IDs              | Área                              | Situação atual               | Evidência ou limite                                                                                         |
| ---------------- | --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| B-01             | Compra nos EUA                    | IMPLEMENTADO                 | staging global, compra manual, atribuição quantitativa e materialização por loja nos Batches 5–6            |
| B-02             | Plataformas e contas externas     | PARCIAL                      | evidências/revisão multicanal e adapter eBay Buyer implementados; ativação real depende de configuração segura; mailbox e Amazon API continuam pendentes |
| B-03, B-05, B-06 | Miami, conferência e divergências | IMPLEMENTADO                 | UI-3C possui read models, RBAC, eventos corretivos, auditoria e interface operacional                       |
| B-04             | Galpão nos EUA                    | NÃO LOCALIZADO               | localização genérica existe, mas operação específica de galpão não possui contrato canônico                 |
| B-07             | Consolidação física               | PARCIAL                      | posições, remessas, malas, volumes, handoff e checkpoints implementados; identidade física unitária e anexos continuam fora da capacidade atual |
| B-08             | Malas                             | IMPLEMENTADO                 | limite, tara, cálculo backend, alocação e interface estão cobertos                                          |
| B-09, B-10       | Remessas e viajantes              | IMPLEMENTADO NO ESCOPO ATUAL | posições, responsabilidades contextuais, vigência e remessas implementadas conforme D-2/D-7…D-14; anexos dependem de D-6 |
| B-11             | Frete integrado                   | PLANEJADO                    | rateio/provider e conciliação exigem contrato futuro                                                        |
| B-12, B-13, B-14 | Rota, Paraguai e Brasil           | IMPLEMENTADO                 | snapshot de rota, aplicabilidade, checkpoints e histórico tenant-safe concluídos                            |
| B-15, B-16       | Recebimento Brasil e estoque real | IMPLEMENTADO                 | conferência não cria saldo; somente entrada definitiva gera `ENTRY`                                         |
| B-17, B-35       | Venda e baixa patrimonial         | PARCIAL                      | B17 cria rascunho, confirma baixa por lote, preserva custo e registra recebimentos; devolução física/correção de venda confirmada e reconciliação de lotes legados exigem contrato próprio |
| B-18             | Fornecedores internos             | IMPLEMENTADO                 | CRUD tenantado e mapping merchant→fornecedor por loja                                                       |
| B-19             | Produtos internos                 | IMPLEMENTADO                 | catálogo tenantado e mapping item externo→Produto por loja                                                  |
| B-20             | Pagamentos e conciliação          | PARCIAL                      | B16 implementa contas/faturas, pagamentos, reembolsos e conciliação humana; fontes bancárias/PayPal automáticas e vínculo de recebimento de venda com fonte B16 continuam fora do contrato atual |
| B-21             | Custos em USD                     | IMPLEMENTADO                 | USD é moeda consolidada; origem externa é preservada                                                        |
| B-22, B-23, B-24 | BRL, câmbio e lucratividade       | IMPLEMENTADO NO ESCOPO ATUAL | câmbio informado, snapshot do custo por lote e margem realizada B17/B18; sem taxa presumida ou integração cambial automática |
| B-25, B-36       | Responsabilidades por pessoa      | IMPLEMENTADO NO ESCOPO ATUAL | responsabilidades contextuais e delegações por vínculo/vigência (D-8/D-9/D-12), sem nomes pessoais hardcoded |
| B-26             | Auditoria                         | IMPLEMENTADO NO ESCOPO ATUAL | `AuditLog` cobre UI-3C e Compras Unificadas sem sistema paralelo                                            |
| B-27             | Permissões                        | IMPLEMENTADO NO ESCOPO ATUAL | RBAC funcional, contexto operacional e isolamento por loja; dados financeiros são filtrados também na confirmação/replay e nos relatórios aninhados |
| B-28             | Documentos e comprovantes         | FORA DO ESCOPO ATUAL         | exige storage, retenção e contrato tenant-safe                                                              |
| B-29, B-30       | Alertas e deadlines               | PARCIAL                      | alertas operacionais/deadline Miami existem; motor automático de transportadora e janela P-08 de quinta continuam pendentes |
| B-31             | Relatórios                        | PARCIAL                      | painel mensal/CSV B13 e indicadores/CSV B18 implementados; PDF, Excel, metas e fechamento mensal oficial não estão implementados |
| B-32             | Status operacionais               | IMPLEMENTADO NO ESCOPO ATUAL | backend governa estados, `allowedActions`, bloqueios e projeções efetivas                                   |
| B-33             | Transporte por viajante           | IMPLEMENTADO NO ESCOPO ATUAL | viajante sem usuário, vínculo contextual, malas, handoff e checkpoints; homologação física real permanece necessária |
| B-34             | Transporte por frete e tracking   | PARCIAL                      | B14 mantém pacotes, múltiplos códigos e atualização manual auditada; tracking não confirma recebimento; motor de transportadora B15 ainda não existe |

## 3. Decisões de produto incorporadas

- Staging global é restrita a permissão global; operação materializada é isolada por `lojaId`.
- Uma linha externa pode ser dividida quantitativamente entre Dronz e Gooder, mantendo saldo pendente.
- Materialização ocorre independentemente por loja e é idempotente.
- Merchant externo, fornecedor interno, item externo e Produto interno são conceitos distintos.
- Estoque real só nasce na entrada definitiva após Brasil e conferência válida.
- Correções preservam o evento original e usam auditoria/projeção ou compensação.
- `allowedActions` do backend governa ações contextuais da UI.
- P-08 continua pendência exclusiva do Product Owner somente para cálculo da janela “quinta-feira de manhã”.

### 3.1 Decisões Amazon Business do complemento do Batch 9

- uma conta Amazon Business inicial, `SHARED`, Amazon.com/EUA e USD;
- arquitetura multi-conta preservada;
- Marco é responsável administrativo pela conexão;
- backfill inicial configurável de 15 dias, sempre em staging/revisão;
- sincronização manual obrigatória e automática configurável, recomendada inicialmente a cada quatro horas;
- capabilities desejadas ativadas progressivamente, com pedidos e itens como núcleo mínimo;
- aprovação humana obrigatória, divergência de quantidade sempre revisada e moeda divergente bloqueadora;
- cancelamento, reembolso, compra pessoal, duplicidade e legado possuem classificação/auditoria separadas;
- conta compartilhada permite split quantitativo e saldo pendente.

### 3.2 Matriz de bloqueios do questionário — registro histórico do Batch 9

Estado no complemento daquele batch. Decisões posteriores estão em [DECISOES_PRODUTO_2026-10-17.md](DECISOES_PRODUTO_2026-10-17.md); o estado atual está nas seções 2 e 4–6, não nas pendências históricas abaixo.

| ID | Decisão | Estado após complemento | Dependência restante |
| --- | --- | --- | --- |
| A1 | quantidade de contas Amazon | FECHADA | uma conta inicial |
| A2 | escopo da conta Amazon | FECHADA | `SHARED` |
| A5 | marketplace inicial | FECHADA | Amazon.com / EUA |
| A6 | arquitetura para novas contas | FECHADA | multi-conta |
| B1 | região | FECHADA | Estados Unidos |
| B2 | grupos/compradores internos | PARCIAL | IDs/configuração reais e `AB-USER-01` |
| B3 | onboarding e papéis | PARCIAL | aprovação e concessões externas |
| B4 | responsável administrativo | FECHADA | Marco |
| B5 | backfill | FECHADA | 15 dias configuráveis |
| B6 | frequência | FECHADA | manual + automática configurável; recomendação de 4h |
| B7 | capabilities | FECHADA EM ESCOPO | autorização real por capability |
| E1 | perfil funcional | PARCIAL | composição final de perfis/permissões |
| E2 | aprovação humana | FECHADA | obrigatória para toda detecção automática |
| E5 | divergência | FECHADA EM PARTE | quantidade exige revisão; moeda bloqueia; tolerância monetária aberta |
| E6 | cancelamento/reembolso/exceções | FECHADA | estados/eventos separados e auditáveis |
| F1 | aprovação versus atribuição | PARCIAL | definir quem também atribui |
| F2 | conta dedicada | FECHADA COMO REGRA GERAL | não aplicável à conta inicial `SHARED` |
| F3 | split e saldo pendente | FECHADA | invariante quantitativa confirmada |

## 4. Roadmap e estado de execução

1. Gate eBay Buyer — concluído; OAuth Production, `GetOrders` buyer, resposta, tracking, paginação do recorte e quota comprovados;
2. Batch 10 — pipeline comum de evidências, conciliação e aprovação: implementado;
3. Batch 11 — adapter eBay Buyer: implementado, desabilitado até configuração e homologação seguras;
4. Batch 12 — ingestão autorizada por e-mail: bloqueada pela definição/autorizações da mailbox (X-12); entrada controlada de evidência já existe no B10;
5. Batch 13 — painel mensal/CSV: implementado; migração histórica aguarda a planilha real;
6. Batch 14 — pacotes, códigos e tracking manual: implementado;
7. Batch 15 — motor de tracking e alertas: bloqueado pela integração oficial de transportadora;
8. Batches 16–18 — Financeiro/conciliação, Vendas/baixa patrimonial e Analytics: integrados; limitações constam nas linhas de cobertura;
9. Amazon Business API — retomar após onboarding externo, sem substituir evidência de e-mail.

O tracking automático depende de dados ingeridos por fontes autorizadas, mas seu domínio não depende de marketplace, e-mail ou documento. Ordem sem tracking é válida; tracking pode surgir ou mudar depois; pedidos podem possuir múltiplos envios, pacotes e códigos; e o fallback manual deve permanecer auditável.

## 5. Lacunas documentais reais

- briefing integral não localizado;
- definição horária P-08 ainda pendente;
- operações adicionais de galpão/frete não descritas por contrato canônico;
- X-01 (tolerância zero), X-03 (score explicável), X-13 (competência mensal) e D-1…D-17 já foram decididos: não reabri-los como bloqueios. X-02 não foi adotada; vale F-2. A matriz de perguntas da seção 3.2 é o registro histórico do complemento do Batch 9, não o estado atual desses parâmetros;
- a API Amazon permanece `PENDENTE_DE_ONBOARDING_EXTERNO`; configuração segura e homologação real eBay, mailbox/OAuth/retenção, planilha histórica e APIs de transportadoras continuam dependências próprias;
- identidade física unitária, quantidade por pacote, anexos privados, reconciliação de lotes legados e correção/devolução de venda confirmada não devem ser inferidos das telas existentes;
- Financeiro, Vendas e Analytics estão implementados nos limites descritos acima; integração financeira externa, fechamento mensal oficial, metas e novas exportações exigem escopo próprio.

## 6. Sequência de encerramento

1. Concluir provas automatizadas entre módulos sem alterar regras: pedido → checkpoints → entrada definitiva → venda por lote → recebimentos → indicadores, nas duas lojas.
2. Manter pendências externas separadas: B12 (provider/mailbox dedicada, OAuth, responsável e retenção), B15 (transportadoras/API/credenciais), ativação eBay, onboarding Amazon e planilha histórica real. Não registrar secrets em documentação.
3. Delimitar contratos faltantes antes de codificar correções patrimoniais, reconciliação de lotes, quantidade por pacote e anexos. O destino por pacote (D-15) já está implementado. A decisão D-6 não escolhe automaticamente um provider de armazenamento ou retenção.
4. Executar a conferência visual e a homologação operacional ao final, conforme orientação do Product Owner nesta continuidade. Adiar a conferência não equivale a declarar as telas homologadas.
5. Publicação depende de autorização própria, infraestrutura/HTTPS e tratamento dos riscos de dependências; o ambiente autorizado continua somente local.
