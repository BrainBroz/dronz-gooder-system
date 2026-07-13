# Fundação unificada de integrações de marketplaces — V1

**Batch:** 8

**Data da pesquisa e implementação:** 2026-07-13

**Providers preparados:** Amazon e eBay

**Estado:** fundação interna implementada e aprovada; adapters externos desabilitados; Amazon Business Reporting API e eBay buyer confirmados como fontes oficiais candidatas e ainda não implementados

## 1. Escopo e princípio

A fundação técnica aceita adapters separados e um contrato normalizado comum. O domínio de Compras Unificadas continua sendo a única staging de pedidos externos:

```text
AmazonMarketplaceAdapter ─┐
                          ├─ MarketplaceAdapter → normalização → CompraImportada
EbayMarketplaceAdapter ───┘                         ├─ CompraImportadaItem
                                                    └─ Envio/Pacote/Tracking externo
```

Esta versão não autentica contas externas, não chama APIs reais, não consulta transportadoras e não cria pedido operacional, estoque, checkpoint ou materialização automaticamente. Amazon e eBay permanecem possíveis origens, não a arquitetura central do domínio.

### 1.1 Escopo do caso de uso

Caso principal aprovado:

- compras realizadas por Dronz e Gooder;
- `buyer purchase ingestion`;
- pedidos de compra externos;
- atualização posterior por fontes autorizadas.

Caso não atendido por Amazon SP-API ou eBay Sell Fulfillment, que são APIs seller:

- histórico geral de compras realizadas como consumidor;
- compras comuns feitas no site por contas buyer.

Caso secundário futuro:

- seller fulfillment, somente se houver necessidade de negócio específica e aprovada para importar vendas recebidas.

| Fonte/API                  | Seller orders | Buyer purchase history | Uso atual                         |
| -------------------------- | ------------: | ---------------------: | --------------------------------- |
| Amazon Business Reporting  |           Não |                    Sim | Adapter buyer futuro              |
| Amazon SP-API              |           Sim |                    Não | Seller adiado                     |
| eBay `GetMyeBayBuying`     |           Não |                    Sim | Adapter buyer futuro              |
| eBay Sell Fulfillment      |           Sim |                    Não | Seller adiado                     |
| eBay Buy Order API         |           Não |      Somente fluxo Buy | Não atende compras comuns         |
| E-mail autorizado          | Não aplicável |           Parcial/útil | Fonte complementar candidata      |
| Invoice/comprovante        | Não aplicável |                Parcial | Fonte complementar candidata      |
| CSV/exportação             | Não aplicável |         Conforme fonte | Fonte complementar candidata      |
| Entrada manual             | Não aplicável |                    Sim | Já compatível/fallback            |

### 1.2 Princípio para Buyer Purchase Ingestion

O futuro contrato deve ser independente da fonte:

```text
AmazonBusinessBuyerAdapter ─┐
EbayBuyerAdapter ───────────┤
EmailBuyerAdapter ──────────┤
InvoiceBuyerAdapter ────────┤
CsvBuyerAdapter ────────────┼─ NormalizedBuyerPurchase → Compras Unificadas
ManualBuyerAdapter ─────────┘
```

O Batch 9 define o contrato normativo comum antes de qualquer adapter. Ele preserva evidências independentes, reconciliação, aprovação humana, atribuição quantitativa e visão mensal. Amazon Business, eBay e e-mail serão implementados em batches separados, sem transformar uma fonte em autoridade absoluta e sem materialização automática.

## 2. Pesquisa oficial

### 2.1 Amazon

Fontes oficiais consultadas em 2026-07-13:

- [Selling Partner API — onboarding](https://developer-docs.amazon.com/sp-api/docs/onboarding-overview): cadastro, registro da aplicação e autorização do parceiro vendedor.
- [Selling Partner API — Orders v0](https://developer-docs.amazon.com/sp-api/reference/orders-v0?ld=ASXXSPAPIDirect): acesso a pedidos no contexto de Selling Partner.
- [Self-authorization](https://developer-docs.amazon.com/sp-api/docs/self-authorization): autorização de aplicação privada para a própria organização vendedora.
- [SP-API sandbox](https://developer-docs.amazon.com/sp-api/lang-zh/docs/sp-api-sandbox): sandbox estático/dinâmico sujeito à operação.
- [Orders API rate limits](https://developer-docs.amazon.com/sp-api/lang-tr_TR/docs/orders-api-rate-limits): limites variam por operação e podem ser devolvidos em headers.
- [Login with Amazon — customer profile](https://developer.amazon.com/docs/login-with-amazon/customer-profile.html): fornece perfil autorizado; não é uma API de histórico de compras do consumidor.

Estas referências continuam corretas para contas seller/consumer, mas não cobriam a oferta específica Amazon Business. Fontes adicionais oficiais consultadas em 2026-07-13:

- [Amazon Business Reporting API v2025-06-09](https://docs.business.amazon.com/docs/reporting-v2025-06-09): relatórios de pedidos, linhas, remessas e linhas de remessa para clientes Amazon Business.
- [Order reports](https://docs.business.amazon.com/docs/retrieving-order-reports): janela de até 366 dias, paginação de até 100 resultados e `nextPageToken`.
- [Order line items](https://docs.business.amazon.com/docs/retrieving-order-line-items): IDs de linha, ASIN, título, quantidade, valores/moeda e seller.
- [Shipment reports](https://docs.business.amazon.com/docs/retrieving-shipment-reports): remessas, status, datas, endereço e valores.
- [Amazon Business onboarding](https://docs.business.amazon.com/docs/onboarding-overview) e [roles](https://docs.business.amazon.com/docs/amazon-business-roles): aprovação do programa e papel Amazon Business Analytics para Reporting API.
- [Rate limits](https://docs.business.amazon.com/docs/rate-limits-in-amazon-business-apis): limites por operação/party, `429` e backoff com jitter.

Conclusão atualizada: SP-API Orders continua seller-side e Login with Amazon continua apenas identidade/perfil. Para compras realizadas em contas Amazon Business, a Reporting API é uma fonte buyer oficial candidata. Ela exige onboarding, papéis, autorização, regiões e validação reais. O adapter futuro será `AmazonBusinessBuyerAdapter`; ele ainda não está implementado.

#### Decisões aprovadas para a conexão Amazon Business V1

- uma conta inicial, `SHARED`, preservando arquitetura multi-conta;
- marketplace Amazon.com / Estados Unidos;
- moeda operacional inicial USD;
- Marco como responsável administrativo pela autorização, concessão, revogação e supervisão;
- backfill configurável, inicialmente 15 dias;
- sincronização manual autorizada e automática configurável, inicialmente recomendada a cada quatro horas;
- pedidos e itens como núcleo mínimo;
- ativação progressiva de `ORDERS`, `ORDER_ITEMS`, `SHIPMENTS`, `SHIPMENT_ITEMS`, `PACKAGE_TRACKING`, `DOCUMENTS` e `RECONCILIATION` conforme autorização.

Toda compra entra em staging e aprovação humana. Backfill não cria pedido operacional, estoque, recebimento, checkpoint ou logística. A conta pode usar usuários, grupos e papéis internos Amazon Business; Anselmo, Brunno e Marco poderão ser identificados quando a configuração e os relatórios devolverem IDs oficiais. Não serão criadas contas Amazon separadas por comprador e nomes não serão hardcoded.

### 2.2 eBay

Fontes oficiais consultadas em 2026-07-13:

- [OAuth credentials and authorization](https://developer.ebay.com/api-docs/static/oauth-credentials.html): aplicação, client credentials e user access tokens por ambiente.
- [Trading API — GetMyeBayBuying](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBayBuying.html): dados da área de compras da conta autenticada, incluindo `WonList`, transações e paginação.
- [Making a Trading API call](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html): OAuth usa User access token em `X-EBAY-API-IAF-TOKEN`; Auth'n'Auth legado permanece documentado.
- [API Deprecation Status](https://developer.ebay.com/develop/get-started/api-deprecation-status): `GetMyeBayBuying` não constava entre as capacidades descontinuadas ou com desligamento anunciado na consulta de 2026-07-13.
- [Sell Fulfillment API overview](https://developer.ebay.com/api-docs/sell/fulfillment/overview.html): pedidos e fulfillment no contexto de seller.
- [Buy Order API](https://developer.ebay.com/api-docs/buy/api-order.html): API em Limited Release para compras criadas pelo fluxo Buy API; não foi tratada como histórico geral de uma conta consumidora.
- [Platform notifications](https://developer.ebay.com/api-docs/static/platform-notifications-landing.html): notificações disponíveis dependem do programa e tópico.
- [Notification API release notes](https://developer.ebay.com/api-docs/commerce/notification/release-notes.html): alterações do contrato de notificações devem ser verificadas no adapter real.

Conclusão corrigida: `GetMyeBayBuying` retorna dados do usuário comprador autenticado e `WonList` cobre itens ganhos/comprados. `WonList.DurationInDays` aceita de 0 a 60 dias, possui paginação por `EntriesPerPage` e `PageNumber` e retorna `PaginationResult`. A resposta documenta identidades de item/transação/linha, quantidade, valores, pagamento, envio e cancelamento. Sell Fulfillment continua seller-side e Buy Order API continua restrita ao seu próprio fluxo. O adapter eBay buyer é tecnicamente possível, mas ainda depende da confirmação do keyset, consentimento/token, quota e comportamento produtivo da aplicação.

O sistema legado informado pelo Product Owner não foi encontrado nos repositórios ou históricos acessíveis. Permanecem sem evidência local: chamada e versão efetivamente usadas, autenticação, containers, frequência, retenção, quota, ambiente e origem do código de tracking. A referência atual de `GetMyeBayBuying` expõe `ShippedTime`, mas não foi localizado `ShipmentTrackingDetails`; portanto, tracking bruto não deve ser prometido sem resposta real ou fonte complementar comprovada.

### 2.3 Dependências externas ainda necessárias

- cadastro e aprovação das aplicações nos programas aplicáveis;
- confirmação do onboarding Amazon Business e concessão do papel Amazon Business Analytics;
- confirmação dos papéis/capabilities de Reporting, Package Tracking, Document e Reconciliation;
- IDs reais de organização, grupos e usuários e campos efetivamente retornados;
- rate limits aplicáveis à conta Amazon Business;
- referência de secrets mantida em secret manager, sem registrar valores no domínio;
- credenciais mantidas em secret manager, nunca no banco de domínio;
- confirmação de rate limits, retenção, dados restritos e compliance vigentes na implementação de cada adapter;
- confirmação do keyset/aplicação e da conta eBay que já opera no sistema legado;
- contrato e critérios das fontes complementares de buyer purchase ingestion.

## 3. Contrato comum

`MarketplaceAdapter` expõe capacidades, autorização e leitura de pedidos. Capabilities V1:

- `LIST_ORDERS`;
- `GET_ORDER`;
- `LIST_ORDER_ITEMS`;
- `LIST_SHIPMENTS`;
- `INCREMENTAL_CURSOR`.

Os adapters reais permanecem `NOT_CONFIGURED` e retornam erro interno tipado. Fakes existem somente em testes. A fundação continua aprovada e útil para múltiplos providers/contas, escopos, normalização, sincronização, idempotência, auditoria, RBAC e secrets externos. O futuro adapter eBay buyer poderá traduzir a paginação por página da Trading API em cursor opaco, sem alterar o contrato público.

Erros externos são normalizados em autorização expirada, throttling, resposta inválida, falha permanente ou falha genérica sanitizada. Mensagens, tokens e payloads sensíveis do provider não são persistidos nem retornados.

## 4. Conexões e escopo

`ConexaoMarketplace` representa uma configuração por conta externa e aceita múltiplas conexões por provider.

- `SHARED`: staging global; atribuições podem ser feitas para Dronz e Gooder; nenhuma atribuição é automática.
- `STORE_DEDICATED`: exige `lojaPermitidaId`; o backend rejeita e audita atribuição a outra loja.

O escopo não possui endpoint de alteração nesta versão. A ausência é deliberada: mudar escopo depois de haver staging exige análise de impacto e não pode ser uma edição silenciosa.

A identidade normativa continua:

```text
provider + contaExternaId + externalOrderId normalizado
```

A normalização aplica trim externo e Unicode NFC, preservando case. A mesma referência em providers ou contas diferentes não colide.

## 5. Secrets

O banco armazena somente uma referência opcional no formato `env:MARKETPLACE_*`. `SecretProvider` resolve referências fora do domínio. O read model informa apenas `secretConfigured`.

Nunca podem ser registrados ou devolvidos:

- client secret, access token ou refresh token;
- authorization header, assinatura, senha ou cookie;
- valor resolvido pelo `SecretProvider`;
- erro bruto que possa conter credencial.

A implementação por variável de ambiente existe apenas como ponte local. Produção deve fornecer um secret manager no adapter real.

## 6. Normalização

O pedido normalizado inclui identidade, referência, datas, moeda, total, status, cancelamento, merchant, itens e envios. Itens incluem quantidade total, cancelada e reembolsada; a soma cancelada + reembolsada não pode superar o total.

Envio, pacote e tracking são estruturas de origem externa:

- uma ordem pode não ter envio ou tracking;
- um envio pode ter múltiplos pacotes;
- um pacote pode ter múltiplos códigos;
- uma correção desativa o código substituído e preserva o vínculo histórico;
- transportadora pode estar ausente;
- não existe consulta automática à transportadora neste batch.

`EventoTrackingExterno` está preparado para eventos futuros, mas a consolidação operacional pertence ao Batch 14 e o motor automático de tracking ao Batch 15.

## 7. Sincronização

Rotas:

- `POST /integrations/marketplaces/connections`;
- `GET /integrations/marketplaces/connections`;
- `GET /integrations/marketplaces/connections/:connectionId`;
- `POST /integrations/marketplaces/connections/:connectionId/sync-runs`;
- `GET /integrations/marketplaces/connections/:connectionId/sync-runs`;
- `POST /integrations/marketplaces/sync-runs/:executionId/reprocess`.

Cada execução registra janela, cursores, origem, contadores, correlation ID, idempotency key, status e erro sanitizado. A chave idempotente é persistente: retry idêntico retorna a execução anterior; mesma chave com payload diferente gera conflito.

Um índice parcial PostgreSQL impede duas execuções `RUNNING` para a mesma conexão. Paginação é limitada a 100 páginas por execução. O adapter real deverá aplicar backoff e respeitar `Retry-After`/rate limits do provider; este batch apenas tipa throttling e não inventa política externa.

Falhas por pedido são contabilizadas como resultado parcial. Falha de página/provider encerra a execução como `FAILED`. Cursores são persistidos para retomada incremental; replay ignora o cursor salvo e usa a janela solicitada.

## 8. Compras Unificadas

A sincronização reutiliza `upsertMerchant` e `importPurchase`; não existe um segundo domínio de pedidos. Uma importação:

- cria staging sem loja;
- preserva conexão e conta de origem;
- não apaga mappings ou atribuições;
- não materializa pedido operacional;
- não cria estoque, checkpoint, venda ou pagamento;
- trata alteração incompatível segundo os conflitos existentes de Compras Unificadas.

Cancelamentos/reembolsos já chegam no contrato inicial. Evoluções externas incompatíveis com o snapshot atual permanecem conflito explícito até o adapter real definir a política específica e testada de atualização.

## 9. RBAC, read models e auditoria

Permissões comuns:

- `INTEGRACAO_MARKETPLACE_VISUALIZAR`;
- `INTEGRACAO_MARKETPLACE_GERENCIAR`;
- `INTEGRACAO_MARKETPLACE_SINCRONIZAR`;
- `INTEGRACAO_MARKETPLACE_HISTORICO_VISUALIZAR`;
- `INTEGRACAO_MARKETPLACE_REPROCESSAR`.

O seed as concede ao `SUPER_ADMIN`; perfis locais não as recebem. Conexões dedicadas também exigem vínculo do usuário com a loja. O read model devolve `allowedActions` e `blockedReasons`; toda mutação revalida RBAC e escopo.

São auditados criação de conexão, início/fim/falha de sincronização e tentativa incompatível de atribuição. Falha crítica de auditoria participa da transação da mutação correspondente. Valores secretos e erros brutos ficam fora do AuditLog.

## 10. Migration e compatibilidade

A migration `20260713180000_marketplace_integration_foundation` é aditiva. Ela cria conexões, execuções, envios, pacotes, trackings e eventos, além do vínculo opcional em `CompraImportada`. Nenhum registro legado é apagado, rematerializado ou reclassificado.

Rollback conceitual: interromper novas sincronizações, preservar os dados criados para investigação/exportação, remover primeiro os vínculos externos e somente então as novas tabelas/enums. Rollback destrutivo automático não é fornecido.

Há drift preexistente entre partes do schema Prisma e migrations antigas, relacionado a módulos fora deste batch. Ele não foi incorporado à migration de marketplace e deve ser tratado separadamente antes de usar `prisma migrate diff` como gerador automático de SQL.

## 11. Fontes de Buyer Purchase Ingestion

Fontes oficiais candidatas, sem prioridade absoluta entre canais:

- **Amazon Business Reporting API:** adapter buyer do Batch 10 para uma conta `SHARED`, Amazon.com/EUA e USD, condicionado a onboarding, papéis, resposta real e limites aplicáveis.
- **eBay `GetMyeBayBuying`:** adapter buyer do Batch 11, condicionado à validação do keyset e das permissões. A janela de até 60 dias exige sincronização recorrente e retenção local.

Fontes independentes do Batch 12 e posteriores:

- **E-mail autorizado:** confirmação, atualização, envio, tracking, cancelamento, reembolso, múltiplos pacotes e múltiplas mensagens correlacionadas ao mesmo pedido.
- **Caixa dedicada:** encaminhamento automático, regras por remetente e correlação por `externalOrderId`.
- **Gmail/Outlook autorizados:** OAuth, escopos mínimos, leitura seletiva, retenção, deduplicação e privacidade.
- **Invoice e comprovantes:** upload de PDF/imagem, extração estruturada e vínculo ou criação de compra.
- **CSV/exportação:** upload, mapeamento de colunas, validação, preview e importação idempotente.
- **Entrada manual:** fallback existente, independente de integração e apto a receber tracking posteriormente.

Critérios obrigatórios: autorização verificável, minimização de dados, identidade estável, deduplicação, idempotência, evidência preservada, reconciliação, aprovação humana, auditabilidade, privacidade, custo operacional, cobertura de atualizações e recuperação de falhas. O contrato completo está em `BUYER_PURCHASE_INGESTION_CONTRACT_V1.md`.

## 12. Tracking independente da fonte

- tracking não precisa existir na criação da compra;
- pode aparecer em mensagem ou documento posterior;
- um pedido pode ter múltiplos envios;
- um envio pode ter múltiplos pacotes;
- um pacote pode possuir um ou mais códigos;
- códigos podem ser corrigidos ou substituídos sem apagar histórico;
- tracking manual continua como fallback auditável;
- o motor não depende de Amazon, eBay, e-mail, invoice ou CSV.

## 13. Limitações e gates seguintes

- Batch 9: contrato normativo multicanal de Buyer Purchase Ingestion.
- Batch 10: Amazon Business Reporting API.
- Batch 11: eBay buyer por `GetMyeBayBuying`.
- Batch 12: e-mail autorizado e reconciliação multicanal.
- Batch 13: migração da planilha e painel mensal.
- Batch 14: consolidação operacional de envios, pacotes e trackings.
- Batch 15: motor independente de tracking e transportadoras.
- Batches 16–18: Financeiro/conciliação, Vendas/baixa patrimonial e Analytics avançado.

O Batch 9 é exclusivamente documental. Nenhum adapter seguinte está iniciado. Adapters seller Amazon/eBay permanecem adiados até existir necessidade específica de importar vendas recebidas. Amazon Business e eBay buyer são trilhas distintas dentro do mesmo contrato de evidências e exigem confirmação externa antes da implementação.
