# Gate 9.1 — Onboarding e Capabilities Amazon Business

**Data da consulta:** 2026-07-13

**Escopo:** comprovação de prontidão externa para o futuro adapter buyer Amazon Business

**Estado:** onboarding não iniciado; Batch 10 bloqueado

Este documento separa capacidade documentada, estado comprovado da conta e decisão técnica. Informação pública não prova autorização da conta real. Nenhum segredo, token, resposta comercial ou dado pessoal foi coletado.

## 1. Decisões normativas preservadas

- uma conta Amazon Business inicial, arquitetura futura multi-conta;
- escopo `SHARED`, Amazon.com/EUA, região NA/US e moeda esperada USD;
- Marco é o responsável administrativo;
- backfill inicial configurável de 15 dias;
- aprovação humana obrigatória;
- materialização e estoque automáticos proibidos.

## 2. Pesquisa oficial

| Título | URL | Consulta | Relevância | Dependência |
| --- | --- | --- | --- | --- |
| Onboarding overview | [Amazon Business](https://docs.business.amazon.com/docs/onboarding-overview) | 2026-07-13 | aprovação prévia, registro e atribuição de papéis pela Amazon | contato e aprovação Amazon Business |
| Amazon Business API roles | [Amazon Business](https://docs.business.amazon.com/docs/amazon-business-roles) | 2026-07-13 | nomes oficiais e operações autorizadas | papel concedido à aplicação |
| App Center authorization workflow | [Amazon Business](https://docs.business.amazon.com/docs/app-center-authorization-workflow) | 2026-07-13 | OAuth, consentimento e URIs | aplicação criada no SPP |
| Third-party website authorization | [Amazon Business](https://docs.business.amazon.com/docs/website-authorization-workflow) | 2026-07-13 | authorization code e troca por refresh token LWA | administrador da conta e redirect URI |
| View app information and credentials | [Amazon Business](https://docs.business.amazon.com/docs/viewing-your-application-information-and-credentials) | 2026-07-13 | Application ID, client ID e secret no SPP | app client criado |
| Reporting API v2025-06-09 | [Amazon Business](https://docs.business.amazon.com/docs/reporting-api-v2025-06-09-reference) | 2026-07-13 | pedidos, itens, remessas, paginação, campos e usage plan | papel Amazon Business Analytics |
| API endpoints | [Amazon Business](https://docs.business.amazon.com/docs/ab-api-endpoints) | 2026-07-13 | endpoint NA `https://na.business-api.amazon.com` | marketplace/consentimento NA |
| Rate limits | [Amazon Business](https://docs.business.amazon.com/docs/rate-limits-in-amazon-business-apis) | 2026-07-13 | token bucket, limites por operação/party e header real | chamada autenticada para limite efetivo |
| Static sandbox | [Amazon Business](https://docs.business.amazon.com/docs/amazon-business-api-sandbox) | 2026-07-13 | sandbox estático e endpoint NA | conta SPP e app sandbox |
| Package Tracking | [Amazon Business](https://docs.business.amazon.com/docs/package-tracking-overview) | 2026-07-13 | pacote, status, eventos e push | Amazon Business Order Placement |
| Document API | [Amazon Business](https://docs.business.amazon.com/docs/document-api) | 2026-07-13 | invoices e documentos | Business Purchase Reconciliation |
| Reconciliation API | [Amazon Business](https://docs.business.amazon.com/docs/reconciliation-api-overview) | 2026-07-13 | transações, invoices e ajustes | Business Purchase Reconciliation |
| User Management API | [Amazon Business](https://docs.business.amazon.com/docs/user-management-api-overview) | 2026-07-13 | criação de usuários e vínculo a grupo | papel User Management obtido offline |
| LWA client secret rotation | [Amazon Business](https://docs.business.amazon.com/docs/lwa-client-secret-rotation) | 2026-07-13 | rotação obrigatória e período de transição | app e credenciais LWA existentes |

Desde maio de 2026, o onboarding começa por solicitação à equipe Amazon Business. A equipe aprova o caso de uso e atribui papéis; eles não podem ser considerados concedidos por aparecerem no portal ou na documentação.

## 3. Estado real comprovado

| Item | Estado | Evidência sanitizada |
| --- | --- | --- |
| Conta Amazon Business declarada | `CONFIGURED` | decisão do Product Owner: uma conta inicial |
| Conta ativa e apta à API | `UNKNOWN` | nenhuma evidência do portal |
| Marketplace US ativo na conta | `UNKNOWN` | configuração desejada aprovada, não testada |
| Administrador Amazon da conta | `UNKNOWN` | Marco é responsável operacional; papel de admin não comprovado |
| Organização | `UNKNOWN` | nenhum identificador fornecido |
| Grupos | `UNKNOWN` | inventário não executado |
| Usuários/compradores internos | `UNKNOWN` | inventário não executado |
| SPP/developer profile | `NOT_CONFIGURED` | acesso à API ainda não solicitado segundo o contexto do Product Owner |
| Aplicação/API registrada | `NOT_CONFIGURED` | nenhum Application ID comprovado |
| Application ID | `NOT_CONFIGURED` | nenhum valor coletado |
| Client ID | `NOT_CONFIGURED` | nenhum valor coletado |
| Client secret | `NOT_CONFIGURED` | nenhum valor coletado |
| Refresh token | `NOT_CONFIGURED` | nenhuma autorização executada |
| Papéis concedidos | `NOT_CONFIGURED` | nenhum papel comprovado |
| Solicitações pendentes | `NOT_CONFIGURED` | solicitação ainda não iniciada |
| Contato técnico Amazon | `UNKNOWN` | nenhum contato comprovado |

O repositório contém somente a abstração `secretReference` e um provider local baseado em variável de ambiente. Não existem variáveis Amazon configuradas no `.env` local. A tabela da migration da fundação de integrações também não está aplicada no banco local consultado; isso não altera o gate externo e nenhuma migration foi executada nesta análise.

## 4. Papéis e capabilities

| Capability | Papel oficial atual | Necessário na V1 | Solicitado | Concedido | Testado |
| --- | --- | ---: | ---: | ---: | ---: |
| `ORDERS` | Amazon Business Analytics | Sim, núcleo | Não | Não comprovado | Não |
| `ORDER_ITEMS` | Amazon Business Analytics | Sim, núcleo | Não | Não comprovado | Não |
| `SHIPMENTS` | Amazon Business Analytics | Desejável | Não | Não comprovado | Não |
| `SHIPMENT_ITEMS` | Amazon Business Analytics | Desejável | Não | Não comprovado | Não |
| `PACKAGE_TRACKING` | Amazon Business Order Placement | Progressivo | Não | Não comprovado | Não |
| `DOCUMENTS` | Business Purchase Reconciliation | Progressivo | Não | Não comprovado | Não |
| `RECONCILIATION` | Business Purchase Reconciliation | Progressivo | Não | Não comprovado | Não |
| `USER_MANAGEMENT` | User Management, solicitação offline | Não; fora do núcleo V1 | Não | Não comprovado | Não |

`ORDERS` e `ORDER_ITEMS` são o único mínimo funcional do Batch 10. Remessas não bloqueiam o núcleo; tracking, documentos, reconciliação e gestão de usuários devem ser ativados separadamente conforme os papéis concedidos.

### 4.1 Classificação atual

Todas as oito capabilities são `DOCUMENTED`. Todas dependem de papel e estão `ROLE_REQUIRED`. Nenhuma está `AUTHORIZED` ou `ACCESS_TESTED`. `USER_MANAGEMENT` está adicionalmente `OUT_OF_SCOPE_V1`; as demais permanecem `NOT_REQUESTED` até o onboarding.

## 5. Checklist operacional para Marco

1. Acessar o [onboarding oficial](https://docs.business.amazon.com/docs/onboarding-overview) e solicitar aprovação para o caso buyer purchase ingestion.
2. Informar região NA/US, Amazon.com, uma conta Business compartilhada, uso interno e ausência de materialização automática.
3. Solicitar primeiro `Amazon Business Analytics`; solicitar papéis progressivos somente para capabilities realmente necessárias.
4. Após aprovação, criar ou acessar a conta Solution Provider Portal e concluir o developer profile.
5. Criar app client de sandbox/draft e registrar OAuth Login URI e Redirect URI exatas.
6. Registrar Application ID e client ID em inventário administrativo não secreto.
7. Guardar client secret diretamente no cofre de segredos; não copiar para chat, documento, banco ou Git.
8. Como administrador das entidades legais da conta, executar o consentimento LWA e guardar o refresh token somente no cofre.
9. Confirmar endpoint NA e `region=US`.
10. Testar o sandbox estático sem interpretar resposta mockada como prova dos dados reais.
11. Testar em produção, com escopo mínimo, `orderReports` e `orderLineItemReports` para uma janela sanitizada.
12. Guardar somente evidência sanitizada: HTTP status, request ID mascarado, campos presentes, limite retornado e timestamps.
13. Registrar papéis concedidos, revogação, proprietário operacional e datas de rotação.
14. Definir alerta e procedimento de rotação do client secret; a documentação atual exige rotação a cada 180 dias e informa transição de sete dias para o secret anterior.

Nenhuma credencial deve ser enviada ao repositório ou a esta documentação.

## 6. Autenticação e secrets

O fluxo oficial usa LWA OAuth. A autorização gera código de curta duração, trocado por access token e refresh token; o access token expira e deve ser renovado. Consentimento produtivo exige administrador apto a autorizar todas as entidades legais relevantes.

Estratégia proposta:

| Ambiente | Estratégia |
| --- | --- |
| Desenvolvimento | app sandbox/draft; segredo em variável de ambiente local não versionada; banco guarda somente `env:MARKETPLACE_*` |
| Homologação | cofre de segredos gerenciado ainda a selecionar; aplicação recebe apenas referência/identidade de workload |
| Produção | secret manager gerenciado, acesso mínimo e auditável; escolha do provedor permanece pendente |
| Rotação | calendário máximo de 180 dias, alerta antecipado e troca dentro da janela oficial; automatização futura somente com infraestrutura aprovada |
| Revogação | revogar consentimento/token, desativar conexão e invalidar acesso ao cofre sem apagar auditoria |
| Responsável | Marco pela autorização/revogação administrativa; responsável técnico pelo cofre ainda `UNKNOWN` |

O banco pode armazenar apenas `secretReference`. Client secret, refresh token, access token, authorization header, cookies e senhas nunca são persistidos nas tabelas do domínio. Não será criada criptografia própria.

## 7. Usuários e grupos

O Reporting API documenta `buyingCustomer`, `buyerGroup`, `businessOrderInfo` e `approverDetails`, mas a presença efetiva depende da conta e da resposta autorizada. O User Management permite criar usuário associado a `groupId`, porém exige papel offline e Account Authority.

`AB-USER-01` permanece aberta. Antes de decidir por usuários separados, Marco deve inventariar organização, grupos, logins e papéis no Amazon Business. Recomenda-se identidade individual para rastreabilidade quando operacionalmente viável, sem bloquear a ingestão. Anselmo, Brunno e Marco não serão hardcoded, e nenhum comprador será inferido por nome ou e-mail sem campo oficial.

## 8. Prova de acesso

```text
PROVA DE ACESSO NÃO EXECUTADA — ONBOARDING PENDENTE
```

Não havia Application ID, client ID, secret, refresh token, papel concedido ou conexão local comprovada. Nenhuma chamada autenticada foi tentada, nenhuma compra foi importada e nenhuma resposta real foi persistida.

## 9. Contrato de campos documentados, ainda não confirmados

Os campos abaixo existem no schema público. Nenhum foi confirmado em resposta da conta real.

### 9.1 Pedido

- `orderMetadata.orderId`, `orderDate` e `region`;
- `purchaseOrderNumber`, `orderStatus` e `charges` (`SUBTOTAL`, `SHIPPING_AND_HANDLING`, `PROMOTION`, `TAX`, `NET_TOTAL`);
- moeda e valor em `Money`;
- `buyingCustomer`, `buyerGroup`, `businessOrderInfo` e `approverDetails`, opcionais.

### 9.2 Item

- `orderLineItemId`, `purchaseOrderLineItemNumber`, `quantity` e `unitPrice`;
- `charges`, `taxExemption` e `pricingProgram`;
- `productDetails`: ASIN, título, categoria, UNSPSC, condição, marca, fabricante e seriais opcionais.

SKU e variação não foram comprovados como campos diretos deste relatório e não podem ser inventados pelo adapter.

### 9.3 Remessa

- `shipmentId`, `shipmentDate`, `shipmentStatus`, `shippingAddress`, `charges` e `deliveryInfo`;
- itens com `orderLineItemId`, produto, quantidade, carrier, packages e receiving info.

### 9.4 Tracking

Package Tracking documenta order ID, shipment ID, package ID, carrier, status, promessa de entrega, eventos e timestamps. O acesso é separado e limitado a pacotes enviados nos últimos 90 dias segundo o guia atual.

### 9.5 Documentos e reconciliação

Document e Reconciliation documentam invoices, documentos, transações, reembolsos e ajustes sob Business Purchase Reconciliation. Formatos e disponibilidade NA precisam ser comprovados na conta antes de mapping final.

## 10. Rate limits, paginação e backfill

- os cinco endpoints Reporting v2025-06-09 documentam default de `0,5` requisição/segundo e burst `10` por operação;
- o limite efetivo é por combinação aplicação + conta consentida (`party`) e deve ser lido de `x-amzn-RateLimit-Limit` quando retornado;
- `429` exige retry com backoff exponencial e jitter;
- o sandbox estático documenta 5 requisições/segundo e burst 15, valores que não comprovam produção;
- paginação usa `nextPageToken`, reutilizado com os mesmos filtros;
- pedidos, itens e remessas aceitam janela de até 366 dias, portanto 15 dias são documentalmente compatíveis;
- timestamps são UTC salvo indicação contrária;
- o atraso real de disponibilização dos relatórios permanece `UNKNOWN`.

A sincronização a cada quatro horas permanece `CONFIGURAÇÃO INICIAL PROPOSTA`, não decisão hardcoded. Deve ser confirmada após observar limite efetivo, volume e atraso da conta.

O futuro backfill usa 15 dias, janela sobreposta e idempotência. Reexecução nunca cria automaticamente pedido operacional, materialização, estoque, recebimento ou logística.

## 11. Matriz final de capabilities

| Capability | Documentada | Papel identificado | Concedida | Acesso testado | Campos confirmados na conta | Bloqueio |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `ORDERS` | Sim | Sim | Não comprovada | Não | Não | onboarding, Analytics e LWA |
| `ORDER_ITEMS` | Sim | Sim | Não comprovada | Não | Não | onboarding, Analytics e LWA |
| `SHIPMENTS` | Sim | Sim | Não comprovada | Não | Não | onboarding, Analytics e LWA; não bloqueia núcleo |
| `SHIPMENT_ITEMS` | Sim | Sim | Não comprovada | Não | Não | onboarding, Analytics e LWA; não bloqueia núcleo |
| `PACKAGE_TRACKING` | Sim | Sim | Não comprovada | Não | Não | Order Placement e IDs de pacote |
| `DOCUMENTS` | Sim | Sim | Não comprovada | Não | Não | Business Purchase Reconciliation |
| `RECONCILIATION` | Sim | Sim | Não comprovada | Não | Não | Business Purchase Reconciliation |
| `USER_MANAGEMENT` | Sim | Sim | Não comprovada | Não | Não | processo offline; fora do núcleo V1 |

## 12. Critério de liberação e pendências

O Batch 10 permanece bloqueado até todos os itens abaixo estarem comprovados:

1. app e developer profile aprovados;
2. papel Amazon Business Analytics concedido;
3. LWA autorizado pela conta Business;
4. `orderReports` e `orderLineItemReports` com `ACCESS_TESTED`;
5. marketplace/region US comprovado na resposta;
6. campos reais e tratamento de PII inventariados por resposta sanitizada;
7. rate limit efetivo ou default aceito e política de retry registrada;
8. `secretReference` apontando para armazenamento seguro definido para o ambiente;
9. responsável técnico por rotação/revogação definido.

As capabilities progressivas não bloqueiam o núcleo. Qualquer uma indisponível deve ser declarada no read model futuro, sem simulação.

## 13. Veredito

`ONBOARDING NÃO INICIADO — BATCH 10 BLOQUEADO`

O desenho é compatível com a documentação oficial, mas não existe prova material de autorização ou acesso da conta real.

O procedimento manual para eliminar esses bloqueios está em `AMAZON_BUSINESS_ONBOARDING_RUNBOOK_V1.md`.
