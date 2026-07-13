# Matriz de Cobertura do Briefing V1

## 1. Status e uso

**Consolidada em:** 2026-07-13
**Baseline:** `f413791`

Esta matriz compara o resumo disponível do briefing “Sistema de Gestão de Compras e Logística” com a baseline após os Batches 0–7. O briefing integral continua não localizado; portanto, `NÃO LOCALIZADO` indica ausência de requisito canônico suficiente e não autoriza implementação por suposição.

Fontes de estado: `AGENTS.md`, `PROJECT_CONTEXT_MASTER.md`, contratos normativos, schema, migrations, código e testes. Os detalhes permanecem nos contratos; esta matriz registra somente cobertura e lacuna.

Classificações: `IMPLEMENTADO`, `PARCIAL`, `PLANEJADO`, `FORA DO ESCOPO ATUAL` e `NÃO LOCALIZADO`.

## 2. Cobertura consolidada

| IDs              | Área                              | Situação atual               | Evidência ou limite                                                                                         |
| ---------------- | --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| B-01             | Compra nos EUA                    | IMPLEMENTADO                 | staging global, compra manual, atribuição quantitativa e materialização por loja nos Batches 5–6            |
| B-02             | Plataformas e contas externas     | PARCIAL                      | fundação de conexões e contrato buyer existem; adapters Amazon Business/eBay/e-mail não foram implementados |
| B-03, B-05, B-06 | Miami, conferência e divergências | IMPLEMENTADO                 | UI-3C possui read models, RBAC, eventos corretivos, auditoria e interface operacional                       |
| B-04             | Galpão nos EUA                    | NÃO LOCALIZADO               | localização genérica existe, mas operação específica de galpão não possui contrato canônico                 |
| B-07             | Consolidação física               | PARCIAL                      | viagens, malas, volumes e checkpoints existem; regras adicionais do briefing integral não foram localizadas |
| B-08             | Malas                             | IMPLEMENTADO                 | limite, tara, cálculo backend, alocação e interface estão cobertos                                          |
| B-09, B-10       | Remessas e viajantes              | PARCIAL                      | modelos operacionais existem; responsabilidades adicionais não foram comprovadas pelo briefing              |
| B-11             | Frete integrado                   | PLANEJADO                    | rateio/provider e conciliação exigem contrato futuro                                                        |
| B-12, B-13, B-14 | Rota, Paraguai e Brasil           | IMPLEMENTADO                 | snapshot de rota, aplicabilidade, checkpoints e histórico tenant-safe concluídos                            |
| B-15, B-16       | Recebimento Brasil e estoque real | IMPLEMENTADO                 | conferência não cria saldo; somente entrada definitiva gera `ENTRY`                                         |
| B-17, B-35       | Venda e baixa patrimonial         | FORA DO ESCOPO ATUAL         | roadmap posterior às fontes buyer, tracking e Financeiro                                                    |
| B-18             | Fornecedores internos             | IMPLEMENTADO                 | CRUD tenantado e mapping merchant→fornecedor por loja                                                       |
| B-19             | Produtos internos                 | IMPLEMENTADO                 | catálogo tenantado e mapping item externo→Produto por loja                                                  |
| B-20             | Pagamentos e conciliação          | PARCIAL                      | financeiro manual existe; integrações externas permanecem futuras                                           |
| B-21             | Custos em USD                     | IMPLEMENTADO                 | USD é moeda consolidada; origem externa é preservada                                                        |
| B-22, B-23, B-24 | BRL, câmbio e lucratividade       | PARCIAL                      | fluxo manual e indicadores existem; evolução financeira/analítica exige contratos próprios                  |
| B-25, B-36       | Responsabilidades por pessoa      | NÃO LOCALIZADO               | RBAC usa funções; nomes de pessoas nunca viram autorização                                                  |
| B-26             | Auditoria                         | IMPLEMENTADO NO ESCOPO ATUAL | `AuditLog` cobre UI-3C e Compras Unificadas sem sistema paralelo                                            |
| B-27             | Permissões                        | IMPLEMENTADO NO ESCOPO ATUAL | RBAC granular de UI-3C e Compras Unificadas está semeado e testado                                          |
| B-28             | Documentos e comprovantes         | FORA DO ESCOPO ATUAL         | exige storage, retenção e contrato tenant-safe                                                              |
| B-29, B-30       | Alertas e deadlines               | PARCIAL                      | timezone e terça 14h existem; janela P-08 de quinta permanece não computável                                |
| B-31             | Relatórios                        | PARCIAL                      | relatórios atuais existem; contratos avançados e exportações permanecem futuros                             |
| B-32             | Status operacionais               | IMPLEMENTADO NO ESCOPO ATUAL | backend governa estados, `allowedActions`, bloqueios e projeções efetivas                                   |
| B-33             | Transporte por viajante           | PARCIAL                      | fundação existe; custódia e responsabilidades adicionais exigem briefing canônico                           |
| B-34             | Transporte por frete e tracking   | PLANEJADO                    | será tratado após ingestão buyer e consolidação de envios/pacotes                                           |

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

### 3.2 Matriz de bloqueios do questionário

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

## 4. Roadmap oficial

1. Batch 9 — contrato normativo de Buyer Purchase Ingestion;
2. Batch 10 — Amazon Business Reporting API;
3. Batch 11 — eBay Buyer API;
4. Batch 12 — e-mail autorizado e reconciliação multicanal;
5. Batch 13 — migração da planilha e painel mensal;
6. Batch 14 — consolidação de envios, pacotes e trackings;
7. Batch 15 — tracking automático independente;
8. Batch 16 — Financeiro e conciliação;
9. Batch 17 — Vendas e baixa patrimonial;
10. Batch 18 — Analytics avançado.

O tracking automático depende de dados ingeridos por fontes autorizadas, mas seu domínio não depende de marketplace, e-mail ou documento. Ordem sem tracking é válida; tracking pode surgir ou mudar depois; pedidos podem possuir múltiplos envios, pacotes e códigos; e o fallback manual deve permanecer auditável.

## 5. Lacunas documentais reais

- briefing integral não localizado;
- definição horária P-08 ainda pendente;
- responsabilidades adicionais de galpão, remessa, viajante e frete não comprovadas;
- contrato buyer e decisões iniciais Amazon estão definidos; onboarding, papéis, IDs, campos retornados, limites e referência de secrets Amazon, contas eBay, autorização de e-mail/caixa, privacidade, retenção, rateio, fechamento mensal e planilha histórica permanecem pendentes;
- Financeiro ampliado, Vendas, Patrimônio e Analytics exigem contratos próprios.
