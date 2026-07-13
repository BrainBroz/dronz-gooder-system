# Contrato normativo de Buyer Purchase Ingestion — V1

**Batch:** 9

**Data:** 2026-07-13

**Estado:** contrato documental; nenhuma integração ou migration implementada

**Escopo:** compras realizadas por Dronz e Gooder em múltiplos canais, reconciliação de evidências, aprovação humana, atribuição por loja e visão mensal

## 1. Autoridade e objetivo

Este documento é o contrato normativo para os Batches 10–13. Ele complementa `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md` e não substitui o domínio operacional já implementado.

O objetivo é transformar dados externos incompletos ou repetidos em uma única compra candidata, comprovável e revisável, sem criar automaticamente pedido operacional, estoque, checkpoint, tracking ou financeiro.

Princípio obrigatório:

```text
fonte externa → evidência imutável → correlação/reconciliação
→ aprovação humana → atribuição quantitativa por loja
→ materialização explícita no domínio já existente
```

## 2. Decisões definitivas

1. Amazon, eBay, Gmail, Outlook, CSV, invoice e entrada manual são fontes; nenhuma é o domínio central.
2. Uma mensagem, linha de relatório ou resposta de API é uma evidência, não uma compra operacional.
3. Evidências de fontes distintas podem representar a mesma compra e devem ser correlacionadas sem serem apagadas ou fundidas destrutivamente.
4. Toda compra detectada automaticamente exige aprovação humana antes da atribuição/materialização.
5. A staging permanece global e só é visível por RBAC global; dados materializados voltam ao isolamento obrigatório por `lojaId`.
6. Atribuição é por item e quantidade. Uma linha pode ser dividida entre Dronz e Gooder, mantendo saldo pendente.
7. Conta dedicada restringe as lojas de destino autorizadas, mas não dispensa aprovação nem cria materialização automática.
8. `dataPedidoExterno` é a competência mensal principal. Data de pagamento será uma dimensão financeira posterior, não substitui a competência da compra.
9. Tracking é posterior e independente da origem da compra. Uma compra pode existir sem tracking.
10. Nenhuma credencial, token, cookie, mensagem bruta sensível ou segredo integra respostas, logs ou o domínio de compras.

## 3. Taxonomia de fontes e evidências

### 3.0 Glossário

- **fonte:** sistema ou canal autorizado que fornece dados;
- **evidência:** registro imutável do que uma fonte afirmou em determinado instante;
- **candidato:** projeção reconciliada de uma possível compra;
- **conciliação:** correlação de evidências e exposição de divergências;
- **aprovação:** decisão humana que torna uma versão elegível para atribuição;
- **atribuição:** destinação quantitativa de item a uma loja;
- **materialização:** criação idempotente do pedido operacional tenantado;
- **competência:** mês ao qual a compra pertence no painel;
- **tracking:** domínio posterior de envio, pacote, código e evento, independente da compra.

### 3.1 Tipos de fonte

- `AMAZON_BUSINESS_REPORTING` — relatórios buyer estruturados do Amazon Business.
- `EBAY_MY_BUYING` — `GetMyeBayBuying` da conta buyer autorizada.
- `GMAIL_AUTHORIZED` — caixa Gmail autorizada e filtrada.
- `MICROSOFT_GRAPH_MAIL` — Outlook/Exchange autorizado e filtrado.
- `CSV_IMPORT` — importação controlada com preview e mapping.
- `DOCUMENT_IMPORT` — invoice/comprovante; permanece posterior à fundação de storage e extração.
- `MANUAL` — registro humano auditável.

### 3.2 Entidades conceituais

- `BuyerSourceConnection`: configuração autorizada da fonte, sem segredo bruto no domínio.
- `BuyerIngestionRun`: execução paginada/incremental, janela, cursor, contadores e resultado.
- `BuyerEvidence`: fato imutável recebido de uma fonte, com hash, identidade externa, horário de origem e de ingestão.
- `BuyerSourceEvent`: criação, atualização, cancelamento, reembolso ou envio recebido da fonte, ordenável por horário de origem e ingestão.
- `BuyerEvidenceItem`: linha ou item preservado da evidência.
- `BuyerPurchaseCandidate`: agregado reconciliado ainda não aprovado.
- `BuyerPurchaseCandidateItem`: item reconciliado, com vínculos às evidências que o sustentam.
- `BuyerEvidenceLink`: relação tipada entre evidência e candidato (`MATCHED`, `SUPPORTING`, `CONFLICTING`, `REJECTED`).
- `BuyerReconciliationConflict`: divergência explícita, nunca resolvida silenciosamente.
- `BuyerApprovalDecision`: decisão humana imutável com ator, motivo, data e versão analisada.
- `BuyerStoreAllocationDraft`: proposta/aprovação de item, quantidade e loja antes da materialização.
- `BuyerMonthlyProjection`: read model derivado; nunca é fonte de verdade.

As denominações finais de schema poderão seguir a convenção Prisma vigente, mas essas responsabilidades não podem ser colapsadas.

Cada evidência registra, no mínimo: tipo de fonte, provider, conta, identificador do registro ou mensagem, Order ID extraído, data da fonte, payload normalizado/sanitizado, hash, confiança quando houver extração, instante da ingestão, correlation ID, vínculo eventual com `CompraImportada` e estado da conciliação. O payload bruto só pode ser retido conforme a política de privacidade aprovada.

## 4. Identidade e deduplicação

### 4.1 Pedido com identidade oficial

Identidade canônica preferencial:

```text
(sourceType, externalAccountId, normalizedExternalOrderId)
```

Para Amazon Business, `externalAccountId` identifica a conta/organização autorizada e `externalOrderId` o pedido do relatório. Para eBay, identifica a conta buyer autorizada e o pedido/linha retornado por `GetMyeBayBuying`.

Normalização de ID aplica trim externo e Unicode NFC e remove somente diferenças adicionais comprovadamente irrelevantes pelo provider. Nunca altera caixa ou pontuação quando o provider as tratar como significativas.

### 4.2 Item

Prioridade:

1. `externalLineId` oficial;
2. identidade composta documentada pelo provider;
3. fingerprint determinístico de campos normalizados e estáveis, marcado como fallback.

Índice visual, posição na lista e título isolado nunca são identidade.

### 4.3 Evidência sem ID suficiente

E-mail ou documento sem identidade inequívoca entra como `AGUARDANDO_IDENTIFICACAO`. O sistema pode sugerir candidatos, mas não faz merge automático. Correlação heurística deve expor evidências e confiança; a aprovação continua humana.

### 4.4 Idempotência

- mesma fonte + mesma identidade + mesmo payload normalizado: replay idempotente;
- mesma identidade + payload evolutivo permitido: nova versão de evidência;
- mesma identidade + divergência incompatível: conflito;
- mesma chave idempotente + payload diferente: `IDEMPOTENCY_CONFLICT`.

Evidências originais e hashes são preservados; projeções podem ser reconstruídas.

## 5. Precedência entre fontes

Não existe precedência absoluta por canal. A precedência é por campo e capacidade comprovada:

- identidade, item, quantidade, data, moeda e valores: API estruturada do marketplace tem prioridade operacional quando presente;
- invoice/reconciliação oficial tem prioridade para documento fiscal e transação financeira correspondente;
- e-mail pode confirmar, enriquecer ou contestar status, envio, cancelamento e tracking;
- entrada manual pode corrigir apenas mediante decisão humana auditável;
- tracking de qualquer fonte permanece evidência do domínio futuro de tracking, não altera silenciosamente a compra.

Uma fonte posterior não sobrescreve a anterior. Alterações geram nova evidência e reconciliação.

## 6. Estados de reconciliação e aprovação

Estados do candidato:

- `DETECTED` — evidência recebida;
- `AWAITING_IDENTIFICATION` — identidade insuficiente;
- `RECONCILING` — fontes sendo correlacionadas;
- `CONFLICTED` — divergência bloqueadora;
- `READY_FOR_REVIEW` — identidade e mínimos completos;
- `APPROVED` — aprovação humana concluída;
- `REJECTED` — não representa compra válida para o domínio;
- `PARTIALLY_ALLOCATED` — parte das quantidades atribuída;
- `ALLOCATED` — toda quantidade destinada ou deliberadamente mantida pendente conforme decisão explícita;
- `PARTIALLY_MATERIALIZED` — ao menos uma loja materializada;
- `MATERIALIZED` — todas as atribuições aprovadas materializadas;
- `CANCELLED` — cancelamento confirmado e preservado no histórico.

Transições são validadas no backend e versionadas. Aprovação rejeita versão stale. `REJECTED` e `CANCELLED` não apagam evidências.

## 7. Aprovação humana

Toda detecção automática passa por uma fila de revisão. O revisor deve visualizar:

- fontes e evidências;
- campos reconciliados e sua origem;
- divergências;
- conta externa;
- merchant;
- itens, quantidades, moeda e valores;
- data de competência;
- mappings pendentes;
- proposta de atribuição, se houver;
- ações permitidas e bloqueios vindos do backend.

A decisão grava ator, permissão, versão, antes/depois, motivo, correlation ID e timestamp UTC. Aprovação nunca é inferida por visualização, sincronização ou associação de conta.

## 8. Atribuição Dronz/Gooder

Para cada item:

```text
quantidadeTotal = quantidadeDronz + quantidadeGooder + quantidadePendente
```

Todos os termos são inteiros não negativos. A soma não pode exceder a quantidade total. Atribuições concorrentes são transacionais e versionadas.

Conta compartilhada permite Dronz e Gooder. Conta dedicada restringe o destino ao conjunto configurado, mas o usuário ainda confirma item e quantidade. Produto e fornecedor internos são mapeados por loja. Materialização ocorre independentemente por loja e reutiliza o contrato existente de Compras Unificadas.

## 9. Competência mensal e rateio

`dataPedidoExterno` define o mês de competência. `ingestedAt`, `approvedAt`, `paidAt`, `shippedAt` e `materializedAt` são dimensões separadas.

O painel mensal apresenta, por mês e moeda original:

- total detectado;
- total aprovado;
- total rejeitado/cancelado;
- total atribuído Dronz;
- total atribuído Gooder;
- total pendente;
- total materializado;
- quantidade de conflitos e mappings pendentes;
- composição por fonte, conta e merchant.

Filtros obrigatórios: mês, ano, loja, provider, conta, merchant, status, Categoria, Produto e moeda.

Indicadores e detalhamento previstos:

- valor bruto, descontos, impostos, frete, valor líquido, cancelado e reembolsado;
- pedidos, linhas e unidades;
- pendências de aprovação, identificação, atribuição e materialização;
- aprovadas, materializadas, canceladas e com divergência;
- data, Order ID, provider, merchant, item, quantidade da loja e valor proporcional;
- Produto mapeado, responsável, origem e links para compra e pedido operacional.

Valores USD e BRL só são combinados quando existir cotação oficial no domínio. Sem cotação, o painel separa moedas e não inventa conversão.

Para um valor inequívoco no nível do item, o rateio entre lojas é proporcional à quantidade atribuída:

```text
valorLoja = valorItem × quantidadeLoja / quantidadeTotalItem
```

Arredondamento usa a menor unidade da moeda e o resíduo não pode ser descartado. A regra definitiva de distribuição do resíduo, frete, imposto, desconto e encargos no nível do pedido é decisão de produto bloqueadora. Até sua aprovação, esses valores aparecem separados e não compõem silenciosamente o total por loja.

O read model mensal é dinâmico e auditável na V1. Fechamento contábil com snapshot/lock permanece bloqueado até definição do Product Owner; não será simulado por cache ou exportação.

## 10. Amazon Business buyer

Adapter futuro: `AmazonBusinessBuyerAdapter`.

Fonte oficial atual: Amazon Business Reporting API `2025-06-09`, não SP-API seller. Capacidades comprovadas:

- order reports;
- order line item reports;
- shipment reports;
- shipment line item reports;
- paginação de até 100 resultados por página com `nextPageToken`;
- janelas de data de até 366 dias nas consultas documentadas;
- regiões/marketplaces conforme operação;
- rate limiting por operação/party, resposta `429` e backoff com jitter.

Papéis/onboarding:

- integração depende de aprovação/onboarding da Amazon Business;
- Reporting API exige papel Amazon Business Analytics;
- Reconciliation e Document APIs exigem Business Purchase Reconciliation;
- Package Tracking integra o programa/role aplicável e permanece fora do Batch 10.

O adapter deve persistir cursores, respeitar paginação e janela, reter IDs oficiais e normalizar pedidos/itens sem materializar. Reconciliation e Document são evidências adicionais futuras, não pré-requisitos para importar pedidos.

## 11. eBay buyer

Adapter futuro: `EbayBuyerAdapter` sobre Trading API `GetMyeBayBuying`.

- autenticação por token de usuário autorizado;
- `WonList` representa itens ganhos/comprados;
- janela documentada de até 60 dias;
- paginação por `EntriesPerPage` e `PageNumber` com `PaginationResult`;
- identidades de item/transação/linha, quantidade, valores, pagamento, envio e cancelamento.

O adapter deve sincronizar de forma recorrente para não perder a janela histórica, reter dados localmente e transformar paginação por página em cursor interno opaco. Elegibilidade do keyset, quota e comportamento real em produção são gates externos. Tracking bruto não é prometido enquanto não houver campo/resposta ou fonte complementar comprovada.

## 12. E-mail autorizado

E-mail é segunda evidência independente, não fallback silencioso da API.

### Gmail

- OAuth 2.0 com menor escopo suficiente;
- `gmail.metadata` quando cabeçalhos/labels bastarem; `gmail.readonly` somente quando corpo for indispensável;
- escopos restritos podem exigir verificação e avaliação de segurança se dados forem armazenados/transmitidos;
- full sync inicial por `messages.list/get` e incremental por `history.list`/`historyId`;
- `historyId` expirado/ausente exige full sync controlado;
- push usa Cloud Pub/Sub, `watch` renovado antes de sete dias e reconciliação periódica porque notificações podem atrasar ou faltar.

### Outlook / Microsoft Graph

- OAuth authorization code e menor permissão suficiente;
- `Mail.ReadBasic` não inclui corpo/anexos; `Mail.Read` somente quando necessários;
- delta query é por pasta e usa links opacos;
- `Prefer: IdType="ImmutableId"` evita que movimento entre pastas altere a identidade usada na correlação;
- change notifications reduzem polling, mas exigem renovação e política específica para caixas compartilhadas;
- throttling `429` respeita `Retry-After`.

Regras comuns:

- caixa/pastas/labels e remetentes permitidos são configurados explicitamente;
- conteúdo bruto tem retenção mínima definida antes da implementação;
- anexos não são persistidos sem contrato de storage e privacidade;
- desconexão/revogação interrompe novas leituras sem apagar auditoria;
- tokens residem em secret manager e nunca no domínio, logs ou frontend;
- uma mensagem pode sustentar várias evidências, mas seu provider message ID é idempotente.

## 13. Tracking posterior

Compra, envio, pacote, código e evento são conceitos distintos:

- compra pode existir sem envio;
- envio pode existir sem tracking;
- pedido pode ter múltiplos envios;
- envio pode ter múltiplos pacotes;
- pacote pode ter um ou mais códigos ao longo do histórico;
- e-mail/API podem adicionar ou corrigir tracking depois;
- atualização nunca apaga código/evento anterior;
- entrada manual permanece fallback auditável.

Amazon Package Tracking, dados de shipment, e-mail e transportadoras alimentarão o domínio futuro, sem acoplar sua máquina de estado a uma fonte.

## 14. RBAC conceitual

Permissões futuras, com nomenclatura final alinhada ao padrão existente:

- visualizar staging global;
- gerenciar conexões buyer;
- executar/reprocessar sincronização;
- visualizar evidências sensíveis;
- reconciliar evidências;
- aprovar/rejeitar compra candidata;
- atribuir quantidades por loja;
- visualizar painel mensal;
- fechar/reabrir mês, somente se o fechamento for aprovado.

SUPER_ADMIN não elimina validações de estado. Perfis locais não recebem staging global automaticamente. Leitura de e-mail e conteúdo financeiro exigem escopos separados.

## 15. APIs conceituais

Sem compromisso de paths finais:

- conexões buyer: criar, listar, autorizar, revogar e diagnosticar;
- execuções: iniciar, listar, consultar e reprocessar;
- evidências: listar, detalhar e consultar origem;
- candidatos: overview, lista, detalhe, conflitos e histórico;
- reconciliação: vincular/desvincular evidência e resolver conflito;
- aprovação: aprovar ou rejeitar versão;
- atribuição: definir/corrigir item, quantidade e loja;
- materialização: delegar ao serviço existente por loja;
- painel mensal: overview e detalhe por competência, fonte, conta, merchant e loja;
- importação de planilha: upload/preview/validação/commit idempotente no Batch 13.

Read models retornam DTOs tipados, `allowedActions`, `blockedReasons`, paginação e origem de cada valor. Mutações revalidam RBAC, versão, estado, idempotência e escopo.

## 16. Migração da planilha atual

O Batch 13 deve usar pipeline de importação, nunca SQL manual:

1. inventariar colunas, fórmulas, moedas e meses;
2. preservar arquivo original e hash;
3. mapear cada linha a uma evidência `CSV_IMPORT`;
4. validar preview, duplicidades, datas, quantidades e totais;
5. exigir aprovação do lote;
6. importar idempotentemente;
7. reconciliar com Amazon/eBay/e-mail sem duplicar;
8. produzir relatório de aceitos, rejeitados e conflitos;
9. comparar totais mensais antigos e novos;
10. manter rollback lógico por lote, sem apagar auditoria.

## 17. Auditoria, privacidade e retenção

Toda mutação registra ator, permissão, entidade, ação, timestamp UTC, antes/depois sanitizados, motivo, source, correlation ID e idempotency key. Falha crítica de auditoria provoca rollback.

Evidências devem aplicar minimização, criptografia em trânsito e repouso, segregação de segredos, prazo de retenção, exclusão controlada e trilha de acesso. Payload original só é guardado quando necessário, permitido e sanitizado. Corpo de e-mail, endereço, documento e dados financeiros não integram logs de aplicação.

## 18. Concorrência e consistência

- importação: unique constraints e idempotência persistente;
- reconciliação/aprovação/atribuição: versionamento otimista e transação;
- soma de atribuições: lock/serialização suficiente no PostgreSQL;
- materialização: mecanismo idempotente já existente;
- sincronização: uma execução ativa por conexão, cursor persistido, retry com backoff;
- evento fora de ordem: preservado por timestamp de origem e ingestão, com projeção determinística.

## 19. Cenários mínimos de aceite

1. Amazon API + e-mail para a mesma ordem: um candidato e duas evidências.
2. eBay API + e-mail para a mesma ordem: um candidato e duas evidências.
3. E-mail sem registro da API cria candidato aguardando aprovação.
4. API sem e-mail permanece válida para revisão.
5. E-mail duplicado não duplica evidência.
6. Replay idêntico da API é idempotente.
7. Order ID divergente gera conflito.
8. Valor divergente gera conflito visível.
9. Quantidade divergente não trunca atribuição ou materialização.
10. Cancelamento posterior cria evidência e nova projeção.
11. Reembolso posterior preserva compra e registra o evento.
12. Tracking posterior não altera a identidade da compra.
13. Múltiplos pacotes permanecem distintos.
14. Compra aprovada registra ator e versão.
15. Compra rejeitada não materializa e preserva evidências.
16. Quantidade 10 permite Dronz 4, Gooder 3 e pendente 3; total 11 falha.
17. Conta dedicada à Dronz bloqueia Gooder e ainda exige aprovação.
18. Relatório mensal Dronz considera somente a parcela Dronz.
19. Relatório mensal Gooder considera somente a parcela Gooder.
20. Rateio proporcional de valor de item conserva o total e o resíduo.
21. Mês provisório reflete eventos posteriores auditáveis.
22. Se fechamento for aprovado, snapshot é imutável e versionado.
23. Correção pós-fechamento segue reabertura ou ajuste que o Product Owner aprovar.
24. Planilha e API com mesma identidade reconciliam sem duplicar.
25. Usuário local não lê staging global nem parcela da outra loja.
26. Toda decisão ou mutação relevante gera AuditLog sanitizado.
27. Mesma chave idempotente com payload diferente gera conflito.
28. Aprovações ou atribuições concorrentes rejeitam versão stale ou overflow.

## 20. Estratégia incremental

1. Batch 9 — este contrato, sem código.
2. Batch 10 — Amazon Business Reporting API: onboarding validado, conexão, adapter, pedidos e itens.
3. Batch 11 — eBay buyer: keyset validado, `GetMyeBayBuying`, janela e paginação.
4. Batch 12 — Gmail/Outlook autorizados e reconciliação multicanal.
5. Batch 13 — migração de planilha e painel mensal.
6. Batch 14 — consolidação de shipment/package/tracking.
7. Batch 15 — motor independente de tracking.
8. Batch 16 — Financeiro e conciliação.
9. Batch 17 — Vendas e baixa patrimonial.
10. Batch 18 — Analytics avançado.

Cada implementação exige migration aditiva quando aplicável, banco limpo e baseline, seed idempotente, testes PostgreSQL reais, isolamento/RBAC, auditoria e rollback conceitual.

## 21. Decisões Exclusivas do Product Owner

Bloqueadoras antes dos respectivos batches:

1. Qual mailbox receberá os e-mails?
2. Gmail, Outlook ou ambos?
3. Uma caixa compartilhada ou uma por conta?
4. Quais contas Amazon Business existem e quais regiões entram no primeiro rollout?
5. Quais contas eBay existem?
6. Quais contas são compartilhadas ou dedicadas e a quais lojas?
7. Quanto histórico inicial importar e com qual frequência sincronizar cada fonte?
8. Quem pode visualizar staging global, reconciliar, aprovar e atribuir?
9. Quais campos mínimos e tolerâncias tornam uma correlação e aprovação válidas?
10. Quem resolve conflitos e quais motivos são obrigatórios?
11. O corpo completo e anexos de e-mail podem ser armazenados e por quanto tempo?
12. Fechamento mensal será obrigatório?
13. Correções após fechamento reabrem o mês ou viram ajuste?
14. Como ratear frete, impostos, descontos e resíduo de arredondamento no split?
15. Qual planilha é a fonte histórica, quais colunas são canônicas e qual mês inicial será migrado?

Já fechadas pelo Product Owner neste contrato: compra detectada por API também exige aprovação; conta dedicada ainda exige atribuição explícita; competência mensal principal usa `dataPedidoExterno`.

## 22. Referências oficiais consultadas

### Amazon Business

- [Reporting API v2025-06-09](https://docs.business.amazon.com/docs/reporting-v2025-06-09)
- [Order reports](https://docs.business.amazon.com/docs/retrieving-order-reports)
- [Order line items](https://docs.business.amazon.com/docs/retrieving-order-line-items)
- [Shipment reports](https://docs.business.amazon.com/docs/retrieving-shipment-reports)
- [Package Tracking](https://docs.business.amazon.com/docs/package-tracking-overview)
- [Reconciliation API](https://docs.business.amazon.com/docs/reconciliation-api-overview)
- [Document API](https://docs.business.amazon.com/docs/document-api)
- [Onboarding](https://docs.business.amazon.com/docs/onboarding-overview)
- [Amazon Business roles](https://docs.business.amazon.com/docs/amazon-business-roles)
- [Rate limits](https://docs.business.amazon.com/docs/rate-limits-in-amazon-business-apis)

### eBay

- [GetMyeBayBuying](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBayBuying.html)
- [Making a Trading API call](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html)
- [OAuth credentials](https://developer.ebay.com/api-docs/static/oauth-credentials.html)
- [API deprecation status](https://developer.ebay.com/develop/get-started/api-deprecation-status)

### Gmail

- [OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Synchronize a mail client](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)

### Microsoft Graph

- [Mail permissions](https://learn.microsoft.com/en-us/graph/permissions-reference#mail-permissions)
- [Message delta query](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Immutable Outlook IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [Throttling](https://learn.microsoft.com/en-us/graph/throttling)
- [OAuth authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

## 23. Status

O contrato técnico está definido, mas a implementação permanece bloqueada pelas decisões do Product Owner listadas na seção 21 e pelos gates externos de onboarding/credenciais. Nenhum adapter, endpoint, schema, migration ou tela foi criado neste Batch 9.
