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
fonte externa → evidência imutável → normalização → reconciliação
→ candidato → aprovação humana → CompraImportada
→ atribuição quantitativa por loja → materialização explícita
```

## 2. Decisões definitivas

1. eBay Buyer API, e-mail Amazon/eBay, futura Amazon Business API, CSV, documento e entrada manual são fontes; nenhuma é o domínio central.
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

O contrato normalizado reconhece estas origens conceituais:

- `AMAZON_BUSINESS_API` — relatórios buyer estruturados do Amazon Business;
- `EBAY_BUYER_API` — API buyer autorizada do eBay;
- `EMAIL_AMAZON`, `EMAIL_EBAY` e `EMAIL_OUTRO` — evidência recebida em caixa autorizada, preservando provider de e-mail e identidade da mensagem;
- `INVOICE` e `DOCUMENTO` — documento autorizado, posterior à fundação de storage, retenção e extração;
- `CSV` — importação controlada com preview e mapping;
- `MANUAL` — registro humano auditável.

Prioridade operacional vigente:

- `EBAY_BUYER_API`: primeira integração estruturada, condicionada ao gate de validação da aplicação existente;
- `EMAIL_AMAZON`: fonte inicial Amazon enquanto o onboarding externo permanecer pendente;
- `EMAIL_EBAY`: evidência complementar da API eBay;
- `AMAZON_BUSINESS_API`: fonte futura, com estado `PENDENTE_DE_ONBOARDING_EXTERNO`.

Nomes técnicos já usados pela fundação, como `AMAZON_BUSINESS_REPORTING`, `EBAY_MY_BUYING`, `GMAIL_AUTHORIZED`, `MICROSOFT_GRAPH_MAIL`, `CSV_IMPORT` e `DOCUMENT_IMPORT`, são identificadores de adapter ou transporte. Eles devem mapear para uma das origens conceituais acima e não criam uma segunda taxonomia de domínio.

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

Cada evidência registra, no mínimo: fonte, provider, conexão, identificador externo da evidência, Order ID extraído, data da fonte, dados normalizados, hash, versão, confiança da extração, instante da ingestão, correlation ID, vínculo eventual com `CompraImportada`, estado da conciliação, referência segura ao original quando permitido e classificação de sensibilidade. O payload original só pode ser retido conforme política de privacidade e retenção aprovada; quando não puder ser guardado, a evidência mantém hash e referência segura suficiente para auditoria.

## 4. Identidade e deduplicação

### 4.1 Pedido com identidade oficial

Identidade forte canônica:

```text
(provider, externalAccountId, normalizedExternalOrderId)
```

Para Amazon Business, `externalAccountId` identifica a conta/organização autorizada e `externalOrderId` o pedido do relatório. Para eBay, identifica a conta buyer autorizada e o pedido/linha retornado por `GetMyeBayBuying`.

Normalização de ID aplica trim externo, Unicode NFC e a regra de caixa documentada pelo provider. Qualquer remoção adicional de pontuação ou transformação deve ser comprovadamente irrelevante para aquele provider. Correlação heurística nunca consolida registros sem decisão humana.

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

### 5.1 Confiança de conciliação

`ConfiancaConciliacao` é uma avaliação explicável e versionada da qualidade da correlação entre evidências. Possui score de `0` a `100` e classificação `ALTA`, `MEDIA` ou `BAIXA`. Considera sinais como identidade forte, conta, Order ID, itens, quantidades, valores, moeda, merchant e proximidade temporal.

O backend é a única fonte da fórmula. A versão da fórmula, os sinais usados e a justificativa do resultado acompanham a avaliação. Pesos e faixas de classificação permanecem decisão aberta de produto/técnica antes da implementação.

Confiança nunca:

- aprova ou rejeita uma compra;
- escolhe loja ou quantidade;
- resolve divergência;
- cria `CompraImportada`;
- materializa pedido;
- altera decisão histórica quando a fórmula evolui.

Ela apenas prioriza filas, simplifica a apresentação de revisão e qualifica a origem dos dados. Toda aprovação da V1 continua humana.

## 6. Estados de reconciliação e aprovação

O estado de revisão do candidato usa uma única taxonomia conceitual:

- `DETECTADA`;
- `AGUARDANDO_IDENTIFICACAO`;
- `AGUARDANDO_CONCILIACAO`;
- `CONCILIADA`;
- `COM_DIVERGENCIA`;
- `AGUARDANDO_APROVACAO`;
- `APROVADA`;
- `REJEITADA`;
- `CANCELADA`;
- `REEMBOLSADA`;
- `IGNORADA`.

Atribuição e materialização são projeções posteriores com estados próprios e não são misturadas ao estado de revisão. Transições são validadas no backend e versionadas. Aprovação rejeita versão stale. Estados terminais não apagam evidências.

### 6.1 Compra externa estável, eventos e projeção

A identidade da compra permanece estável. Mudanças posteriores são fatos representados por `EventoCompraExterna`; a visão corrente é uma `ProjecaoCompraExterna` reconstruível. Este recorte não institui event sourcing genérico no sistema: aplica registro imutável apenas aos fatos externos e decisões de ingestão que precisam de rastreabilidade.

Eventos mínimos previstos:

- compra detectada ou confirmada e pagamento informado;
- alteração de item, quantidade, valor, moeda ou status;
- cancelamento e reembolso, totais ou parciais;
- remessa, pacote, tracking e invoice detectados ou atualizados;
- conciliação, conflito, aprovação, rejeição e classificação humana;
- atribuição e materialização, apenas como referências aos comandos internos correspondentes.

Evento confirmado é imutável. Correção cria novo evento ligado ao original. A projeção pode ser reconstruída deterministicamente e fatos externos nunca sobrescrevem silenciosamente decisões internas. Nenhum evento externo cria estoque, checkpoint ou materialização. Horários oficiais são armazenados em UTC, preservando também o instante informado pela fonte.

### 6.2 Cenários multicanal normativos

- API primeiro e e-mail depois: a mensagem é nova evidência reconciliada ao mesmo candidato quando a identidade forte coincide.
- E-mail primeiro e API depois: o candidato permanece provisório até a API confirmar ou uma decisão humana resolver a identidade.
- API sem e-mail ou e-mail sem API: a compra pode seguir para revisão; ausência de uma fonte não implica rejeição automática.
- Fontes divergentes: nenhuma sobrescreve a outra; o candidato fica `COM_DIVERGENCIA` até decisão auditável.
- Replay idêntico: retorna a evidência já conhecida; payload diferente sob a mesma identidade cria versão/evento ou conflito conforme o contrato.

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

`ConfiancaConciliacao` pode ordenar a fila e reduzir ruído visual, mas não elimina esta etapa nem muda as ações permitidas.

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

Filtros obrigatórios: mês, ano, loja, provider, conta, merchant, Categoria, Produto, status, responsável e moeda.

Indicadores e detalhamento previstos:

- valor bruto, valor líquido, cancelado e reembolsado;
- pedidos, linhas e unidades;
- compras aprovadas, pendentes de aprovação, pendentes de atribuição e materializadas;
- canceladas, reembolsadas e com divergência;
- data, Order ID, provider, conta, merchant, item, quantidade e valor por loja;
- Produto mapeado, status, comprador interno somente quando comprovado, aprovador, fonte, evidências e links para compra e pedido operacional.

Valores USD e BRL só são combinados quando existir cotação oficial no domínio. Sem cotação, o painel separa moedas e não inventa conversão.

Para um valor inequívoco no nível do item, o rateio entre lojas é proporcional à quantidade atribuída:

```text
valorLoja = valorItem × quantidadeLoja / quantidadeTotalItem
```

Arredondamento usa a menor unidade da moeda e o resíduo não pode ser descartado. A regra definitiva de distribuição do resíduo, frete, imposto, desconto e encargos no nível do pedido é decisão de produto bloqueadora. Até sua aprovação, esses valores aparecem separados e não compõem silenciosamente o total por loja.

O read model mensal é dinâmico e auditável na V1, derivado de `CompraImportada` aprovada, itens, atribuições, materializações, eventos, cancelamentos, reembolsos, valores e moedas. Não existe uma segunda base mensal independente. A confiança aparece como qualidade da evidência e histórico, sem excluir resultados de baixa confiança. CSV é a primeira exportação prevista; PDF e metas são posteriores. Fechamento contábil com snapshot/lock permanece decisão futura e não será simulado por cache ou exportação.

## 10. Amazon Business buyer

Adapter futuro: `AmazonBusinessBuyerAdapter`, com estado `PENDENTE_DE_ONBOARDING_EXTERNO`. Esse bloqueio não impede eBay Buyer, e-mail autorizado, conciliação ou painel mensal.

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
- Package Tracking integra o programa/role aplicável e permanece fora do núcleo inicial do futuro adapter Amazon.

O adapter deve persistir cursores, respeitar paginação e janela, reter IDs oficiais e normalizar pedidos/itens sem materializar. Reconciliation e Document são evidências adicionais futuras, não pré-requisitos para importar pedidos. Quando autorizado, o adapter deve reconciliar com compras já detectadas por e-mail usando a identidade forte canônica; ele não pode duplicar `CompraImportada`, apagar evidência de e-mail, sobrescrever decisão humana ou alterar materialização silenciosamente.

## 11. eBay buyer

Adapter prioritário: `EbayBuyerAdapter` sobre Trading API `GetMyeBayBuying`. Antes da implementação, o Gate eBay Buyer deve validar empiricamente a aplicação/API existente.

- autenticação por token de usuário autorizado;
- `WonList` representa itens ganhos/comprados;
- janela documentada de até 60 dias;
- paginação por `EntriesPerPage` e `PageNumber` com `PaginationResult`;
- identidades de item/transação/linha, quantidade, valores, pagamento, envio e cancelamento.

O adapter deve sincronizar de forma recorrente para não perder a janela histórica, reter dados localmente e transformar paginação por página em cursor interno opaco. Elegibilidade do keyset, quota e comportamento real em produção são gates externos. Tracking bruto não é prometido enquanto não houver campo/resposta ou fonte complementar comprovada.

## 12. E-mail autorizado

E-mail é evidência independente. Para Amazon, é a fonte inicial enquanto o onboarding da API estiver pendente; para eBay, complementa a API. Não é fallback silencioso nem cria operação automaticamente.

Mensagens inicialmente previstas: confirmação de ordem, pagamento aprovado, envio, tracking, cancelamento, reembolso, invoice e alteração de item ou quantidade. Quando disponíveis, a extração busca Amazon/eBay Order ID, data, conta/mailbox, merchant, itens, quantidades, valores, moeda, status, shipment, tracking e invoice. Mensagem sem Order ID confiável fica `AGUARDANDO_IDENTIFICACAO`.

Uma mensagem duplicada não cria evidência duplicada. Mensagens diferentes da mesma ordem atualizam o mesmo candidato por eventos/evidências distintas. Encaminhamento deve preservar identificadores quando possível, e conteúdo original ou referência segura deve ser mantido conforme retenção e minimização aprovadas.

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
3. mapear cada linha a uma evidência de origem conceitual `CSV` pelo adapter de importação controlada;
4. validar preview, duplicidades, datas, quantidades e totais;
5. exigir aprovação do lote;
6. importar idempotentemente;
7. reconciliar com Amazon/eBay/e-mail sem duplicar;
8. produzir relatório de aceitos, rejeitados e conflitos;
9. comparar totais mensais antigos e novos;
10. manter rollback lógico por lote, sem apagar auditoria;
11. operar planilha e sistema em paralelo até reconciliação, comparação de totais e aceite operacional;
12. desativar a planilha somente após aceite formal, sem perda do arquivo histórico.

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

1. Gate eBay Buyer — validação da aplicação/API existente, sem adapter produtivo.
2. Batch 10 — pipeline comum de evidências, conciliação e aprovação.
3. Batch 11 — adapter eBay Buyer.
4. Batch 12 — ingestão autorizada por e-mail Amazon/eBay e reconciliação multicanal.
5. Batch 13 — painel mensal e migração da planilha histórica.
6. Batch 14 — consolidação de remessas, pacotes e tracking.
7. Batch 15 — motor de tracking e alertas.
8. Batches 16–18 — Financeiro/conciliação, Vendas/baixa patrimonial e Analytics.
9. Amazon Business API — retomada em batch próprio quando o onboarding externo for aprovado.

Cada implementação exige migration aditiva quando aplicável, banco limpo e baseline, seed idempotente, testes PostgreSQL reais, isolamento/RBAC, auditoria e rollback conceitual.

## 20.1 Decisões Amazon Business aprovadas

### Conta, marketplace e compradores

- existe uma conta inicial, do tipo Amazon Business;
- a conexão inicial é `SHARED`, apta a receber atribuições Dronz e Gooder;
- o marketplace inicial é Amazon.com / Estados Unidos;
- a moeda operacional inicial é USD;
- Marco é o responsável administrativo pela autorização, concessão, revogação e supervisão da conexão;
- a arquitetura permanece multi-conta para conexões futuras.

A Amazon Business admite usuários, grupos e papéis dentro da mesma conta. Não será criada uma conta separada por comprador. Anselmo, Brunno e Marco poderão ser configurados ou identificados como compradores internos se a configuração da conta permitir. `buyerName`, `buyerId` e `groupId` só serão preservados quando retornados oficialmente. Nomes pessoais nunca integram regras de domínio, RBAC hardcoded ou inferência sem evidência.

Decisão ainda aberta `AB-USER-01`: configurar ou não Anselmo, Brunno e Marco como usuários/compradores internos na Amazon Business. A avaliação ocorrerá antes ou durante o onboarding e não bloqueia a ingestão se a conta ainda não possuir usuários separados.

### Backfill e classificação humana

A primeira sincronização real usa, por configuração, os 15 dias imediatamente anteriores ao seu início. A janela permanece configurável sem migration. Toda compra do backfill entra em staging e revisão; nenhuma cria estoque, recebimento, checkpoint, pedido operacional ou logística automaticamente.

Classificações conceituais disponíveis mediante decisão humana, com nomenclatura final alinhada às convenções do projeto:

- `VALIDA_PENDENTE`;
- `JA_TRATADA_NO_LEGADO`;
- `JA_VENDIDA_OU_ENCERRADA`;
- `CANCELADA`;
- `REEMBOLSADA`;
- `COMPRA_PESSOAL`;
- `DUPLICADA`;
- `IGNORADA_COM_MOTIVO`.

Toda classificação registra ator, timestamp e motivo quando aplicável. `JA_TRATADA_NO_LEGADO` não recria operação, estoque ou pedido. `JA_VENDIDA_OU_ENCERRADA` preserva a evidência sem gerar patrimônio. Registros não são apagados; correções criam eventos auditáveis; nenhuma classificação é inferida somente pela data.

### Sincronização e capabilities

- sincronização manual autorizada é obrigatória;
- sincronização automática é configurável;
- recomendação inicial: a cada quatro horas;
- a frequência nunca é hardcoded e deve respeitar rate limits e papéis oficiais;
- sincronizações sem novas compras continuam necessárias para detectar aprovação, cancelamento, reembolso, remessa, tracking, invoice e mudança de status.

Capabilities progressivas desejadas:

- `ORDERS`;
- `ORDER_ITEMS`;
- `SHIPMENTS`;
- `SHIPMENT_ITEMS`;
- `PACKAGE_TRACKING`;
- `DOCUMENTS`;
- `RECONCILIATION`.

Pedidos e itens são o núcleo mínimo. Capability não autorizada não bloqueia as disponíveis. Read models futuros expõem `AVAILABLE`, `UNAVAILABLE` ou `UNAUTHORIZED`; o sistema não simula dados ausentes. Ausência de tracking ou invoice não impede a entrada na staging, e falhas devem ser isoladas por capability quando possível.

### Operadores, aprovação e divergências

Anselmo, Brunno e Marco poderão receber permissões funcionais, por perfil e vínculo administrativo, para revisar e aprovar compras conforme sua atuação operacional em Miami/Paraguai. A nomenclatura final será definida no batch de implementação; nomes pessoais não serão hardcoded.

Permissões conceituais:

- `BUYER_INGESTION_VISUALIZAR`;
- `BUYER_INGESTION_RECONCILIAR`;
- `BUYER_INGESTION_APROVAR`;
- `BUYER_INGESTION_REJEITAR`;
- `BUYER_INGESTION_ATRIBUIR`.

Toda compra detectada automaticamente exige aprovação humana, mesmo quando API/e-mail coincidem, conta e Order ID são conhecidos, não existe divergência, a conta é dedicada ou todos os itens foram encontrados. Coincidência pode simplificar a revisão, nunca aprovar automaticamente. Antes da aprovação não há materialização, estoque, logística, entrada ou patrimônio.

USD é a moeda inicial esperada. Divergência de quantidade sempre exige verificação; divergência de moeda é sempre bloqueadora; toda divergência material deve ser apresentada. Categorias conceituais: quantidade, valor, moeda, itens, variação, conta, merchant, Order ID, cancelamento, reembolso, duplicidade, compra pessoal, status, tracking e invoice. Resolução nunca sobrescreve fonte e registra ator, instante, decisão, motivo, antes/depois e evidências consideradas.

Cancelamento e reembolso são eventos e estados distintos. Cancelamento não apaga a compra, bloqueia nova materialização e, se houver downstream, exige correção posterior. Reembolso preserva valores original e reembolsado, pode ser total ou parcial e mantém vínculos com itens/atribuições quando possível. Variação de item, quantidade, preço, status, remessa, tracking, invoice ou outro dado externo cria novo evento e nova conciliação.

### Atribuição

A conta inicial compartilhada permite atribuir itens aprovados à Dronz, à Gooder ou dividir quantidades, mantendo saldo pendente. A aprovação pode anteceder a atribuição completa e a materialização continua explícita.

```text
Dronz + Gooder + Pendente = Quantidade Elegível
```

## 21. Decisões Exclusivas do Product Owner

### 21.1 Pendências específicas do Amazon Business

O estado normativo é `PENDENTE_DE_ONBOARDING_EXTERNO`. Após as decisões do complemento do Batch 9, permanecem abertas somente:

1. status do onboarding da aplicação;
2. concessão do papel Amazon Business Analytics;
3. disponibilidade efetiva dos papéis/capabilities de Reporting, Package Tracking, Document e Reconciliation;
4. IDs reais de organização, grupos e usuários, incluindo `AB-USER-01` sobre configurar ou não os três compradores internos;
5. campos efetivamente retornados pelos relatórios da conta;
6. rate limits oficiais aplicáveis à conta;
7. referência segura de secrets no ambiente/secret manager, sem valor no documento;
8. política final de tolerância monetária;
9. se Anselmo, Brunno e Marco também receberão permissão de atribuição, além de revisão/aprovação.

### 21.2 Pendências dos batches posteriores

Bloqueadoras antes dos respectivos batches, mas não do planejamento documental Amazon:

1. Qual mailbox receberá os e-mails?
2. Gmail, Outlook ou ambos?
3. Uma caixa compartilhada ou uma por conta?
4. Quais contas eBay existem?
5. Quais contas eBay são compartilhadas ou dedicadas e a quais lojas?
6. Quanto histórico inicial importar e com qual frequência sincronizar eBay e e-mail?
7. Quem pode visualizar staging global e resolver conflitos fora do fluxo Amazon já indicado?
8. Quais campos mínimos e tolerâncias tornam uma correlação multicanal válida?
9. Quem resolve conflitos e quais motivos são obrigatórios?
10. O corpo completo e anexos de e-mail podem ser armazenados e por quanto tempo?
11. Fechamento mensal será obrigatório?
12. Correções após fechamento reabrem o mês ou viram ajuste?
13. Como ratear frete, impostos, descontos e resíduo de arredondamento no split?
14. Qual planilha é a fonte histórica, quais colunas são canônicas e qual mês inicial será migrado?

### 21.3 Decisões fechadas neste complemento

1. fonte, evidência imutável, candidato reconciliado, aprovação, `CompraImportada`, atribuição e materialização são etapas distintas;
2. a identidade forte é provider + conta externa + Order ID normalizado;
3. merge heurístico nunca ocorre sem decisão humana;
4. evidências são versionadas e preservam hash, origem, correlação e sensibilidade;
5. a compra mantém identidade estável e mudanças externas são eventos;
6. eventos confirmados são imutáveis e correções geram novos eventos;
7. a projeção corrente é reconstruível;
8. não será introduzido event sourcing genérico;
9. confiança é explicável, versionada e calculada no backend;
10. confiança não aprova, atribui, resolve conflito ou materializa;
11. aprovação humana continua obrigatória na V1;
12. painel mensal é read model derivado, sem base independente;
13. `dataPedidoExterno` é a competência mensal e moedas permanecem separadas sem cotação oficial;
14. planilha só será aposentada após importação, reconciliação, comparação de totais, operação paralela e aceite.

### 21.4 Decisões ainda abertas deste complemento

- pesos e fórmula de `ConfiancaConciliacao`;
- faixas de `ALTA`, `MEDIA` e `BAIXA`;
- tolerância monetária;
- eventual limiar para revisão simplificada, sem aprovação automática;
- arquivo e estrutura reais da planilha histórica;
- rateio de frete, imposto, desconto geral e taxas;
- regra do resíduo de arredondamento;
- eventual fechamento mensal futuro;
- retenção de payloads e documentos;
- privacidade e retenção de e-mail.

Essas decisões não bloqueiam a consolidação documental atual. Elas bloqueiam somente a implementação que dependa diretamente de cada regra.

Já fechadas: uma conta Amazon Business inicial, `SHARED`, Amazon.com/EUA, USD, Marco como responsável administrativo, arquitetura multi-conta, backfill de 15 dias, sincronização manual mais automática configurável com recomendação de quatro horas, capabilities progressivas, aprovação humana obrigatória, quantidade sempre revisada, moeda divergente bloqueadora, exceções separadas e split com saldo pendente. Permanecem vigentes: conta dedicada ainda exige atribuição explícita e competência mensal principal usa `dataPedidoExterno`.

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

O contrato técnico Amazon está definido e permanece `PENDENTE_DE_ONBOARDING_EXTERNO`; somente o futuro adapter Amazon depende da comprovação externa de onboarding, papel Amazon Business Analytics, capabilities concedidas, resposta real sanitizada, limites aplicáveis e referência segura de secrets. O próximo gate é a validação eBay Buyer, seguido pelo pipeline comum. As demais decisões da seção 21 bloqueiam apenas os respectivos trabalhos que dependem delas. Nenhum adapter, endpoint, schema, migration ou tela foi criado neste redirecionamento.
