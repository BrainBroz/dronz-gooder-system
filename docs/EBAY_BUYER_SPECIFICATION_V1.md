# Especificação eBay Buyer — V1

**Gate:** eBay Buyer

**Data da comprovação:** 2026-07-14

**Ambiente comprovado:** Production, marketplace US (`siteId=0`)

**Estado:** onboarding OAuth e leitura buyer comprovados; adapter produtivo ainda não implementado

## 1. Escopo e decisão

Esta especificação é a referência oficial para o futuro `EbayBuyerAdapter`. O objetivo é importar compras realizadas pela conta eBay autorizada, preservando o contrato multicanal de evidências, reconciliação e aprovação humana.

A API efetiva escolhida é a **Trading API `GetOrders` com `OrderRole=Buyer`**. A decisão foi comprovada com resposta real de Production:

- `GetOrders` retornou pedidos, linhas, valores, estados, remessas e tracking;
- `GetMyeBayBuying/WonList` também retornou compras buyer, mas não expôs tracking na resposta real validada;
- Sell Fulfillment e demais APIs seller permanecem fora do caso de uso;
- Buy Order API não representa o histórico geral da conta buyer.

O adapter eBay é fonte de evidência. Ele nunca aprova, atribui loja, materializa pedido, cria estoque ou inicia logística automaticamente.

## 2. Arquitetura

```text
eBay OAuth user consent
  -> Trading API GetOrders (OrderRole=Buyer)
  -> resposta XML sanitizada e validada
  -> EbayBuyerAdapter
  -> evidência imutável + evento externo versionado
  -> reconciliação/candidato
  -> aprovação humana
  -> CompraImportada
  -> atribuição quantitativa Dronz/Gooder
  -> materialização explícita por loja
```

O adapter traduz XML e paginação do eBay para o contrato normalizado existente. O domínio não deve depender de nomes de campos XML fora do adapter.

## 3. Autenticação e OAuth

Fluxo comprovado:

1. Authorization Code Grant em Production;
2. consentimento explícito do usuário buyer;
3. callback configurado pelo RuName da aplicação;
4. troca única do authorization code no Identity API;
5. armazenamento do refresh token fora do repositório;
6. renovação de access token por `grant_type=refresh_token`;
7. User access token enviado à Trading API somente em `X-EBAY-API-IAF-TOKEN`.

Escopo mínimo comprovado:

```text
https://api.ebay.com/oauth/api_scope
```

A Trading API tradicional não exige scopes REST seller adicionais para `GetOrders`. O token de acesso comprovado possui duração de 7.200 segundos. O refresh token emitido possui duração aproximada de 18 meses; o adapter deve considerar a expiração devolvida pelo eBay, nunca uma constante local.

O teste de renovação foi executado com sucesso depois do consentimento inicial. Revogação e expiração definitiva devem transicionar a conexão para estado de reautorização, sem expor erro bruto ou credencial.

## 4. Gestão de secrets

Nunca persistir no Git, documentação, logs, payload de erro ou banco de domínio:

- client secret;
- access token;
- refresh token;
- authorization code;
- cookie do eBay;
- header de autorização;
- conteúdo do secret resolvido.

Durante o gate, a credencial de Production foi colocada no macOS Keychain, serviço `dronz-gooder-ebay-production`, apenas para validação local. Isso comprova custódia fora do Git, mas **não é a solução de produção**. O adapter deve usar a abstração `SecretProvider` e uma referência externa; a implantação deve fornecer secret manager apropriado.

O banco armazena somente referência opaca ao secret. Rotação ou nova autorização não exige migration.

## 5. Chamada principal

Endpoint:

```text
POST https://api.ebay.com/ws/api.dll
```

Headers obrigatórios:

```text
X-EBAY-API-CALL-NAME: GetOrders
X-EBAY-API-COMPATIBILITY-LEVEL: versão validada pelo adapter
X-EBAY-API-SITEID: 0
X-EBAY-API-IAF-TOKEN: <user-access-token>
Content-Type: text/xml; charset=utf-8
```

Request mínimo sanitizado:

```xml
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <OrderRole>Buyer</OrderRole>
  <NumberOfDays>30</NumberOfDays>
  <Pagination>
    <EntriesPerPage>100</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</GetOrdersRequest>
```

O request de validação usou compatibility level `1423`; o eBay respondeu com schema version `1455`. O adapter deve registrar a versão sanitizada para diagnóstico e testar compatibilidade antes de elevar o nível solicitado.

## 6. Evidência real sanitizada

Validação de Production em 2026-07-14, janela de 30 dias:

| Métrica | Resultado |
| --- | ---: |
| HTTP / Ack | `200` / `Success` |
| Pedidos | 37 |
| Linhas/transações | 44 |
| Pedidos com múltiplas linhas | 2 |
| Páginas | 1 |
| `HasMoreOrders` | `false` |
| Pedidos com tracking | 31 |
| Registros de tracking | 34 |
| Máximo de trackings em um pedido | 3 |
| Moeda observada | USD |
| Estados observados | `Completed`, `Cancelled` |
| Blocos de refund observados | 4 |

Nenhum Order ID, título, vendedor, comprador, código de tracking, token ou dado pessoal integra este documento.

## 7. Campos comprovados

### Pedido

- `OrderID`;
- `ExtendedOrderID`;
- `CreatedTime` e `LastModifiedTime`;
- `OrderStatus`;
- `CheckoutStatus` e `PaymentStatus`;
- `PaidTime` e `ShippedTime`;
- `AmountPaid`, `Total` e moeda;
- buyer e seller identifiers conforme política de dados do eBay;
- serviço e custo de envio;
- cancelamento e refunds quando presentes.

### Item/transação

- `OrderLineItemID`;
- `TransactionID`;
- `ItemID`;
- título e variação;
- `QuantityPurchased`;
- `TransactionPrice` e moeda;
- seller identifier;
- URLs/imagens quando presentes.

### Envio e tracking

- `ShippingDetails`;
- `ShippingServiceSelected`;
- `ShippingService`;
- `ShippingServiceCost`;
- `ShipmentTrackingDetails`;
- `ShipmentTrackingNumber`;
- `ShippingCarrierUsed`;
- `ActualShippingCost` quando presente.

Campos são condicionais. Ausência não deve ser preenchida com dado inventado. Identificadores de usuário podem ser mascarados ou substituídos por IDs imutáveis conforme políticas do eBay.

## 8. Identidade e deduplicação

Identidade de pedido:

```text
EBAY + externalAccountId + OrderID normalizado
```

Identidade preferencial de linha:

```text
OrderLineItemID
```

Fallback somente quando necessário:

```text
ItemID + TransactionID
```

Índice de array, título ou posição visual nunca são identidade. `ExtendedOrderID` deve ser preservado como evidência adicional, não usado silenciosamente para substituir uma identidade já materializada.

## 9. Paginação, janela e incremental

`GetOrders` aceita no máximo 100 pedidos por página. O adapter deve:

1. iniciar em `PageNumber=1`;
2. persistir cursor opaco com janela e página;
3. continuar enquanto `HasMoreOrders=true`;
4. validar `TotalNumberOfPages` e `TotalNumberOfEntries` sem tratá-los como identidade;
5. aplicar sobreposição temporal segura;
6. deduplicar por conta e identidade externa;
7. reprocessar idempotentemente alterações.

`NumberOfDays` cobre no máximo 30 dias. Para até 90 dias, a API documenta intervalos de criação/modificação. A primeira versão deve usar sincronização incremental por `ModTimeFrom/ModTimeTo` com sobreposição, para capturar cancelamentos, refunds, envio e tracking posteriores. O histórico local permanece após sair da janela do eBay.

Não há frequência normativa aprovada para o eBay. Ela deve ser configurável e respeitar quota, latência operacional e sobreposição; não pode ser hardcoded.

## 10. Tracking

Tracking foi comprovado diretamente em `GetOrders`, inclusive múltiplos registros no mesmo pedido. O adapter deve preservar:

- vínculo com pedido e, quando possível, linha/envio;
- carrier original;
- código original protegido conforme política de dados;
- instante da observação;
- origem e versão da evidência;
- inclusões, correções e substituições posteriores sem apagar histórico.

Tracking continua independente do marketplace. Uma ordem pode existir sem tracking, tracking pode surgir depois e a entrada manual auditável permanece fallback. O futuro motor de tracking não deve consultar eBay como autoridade única de eventos da transportadora.

## 11. Cancelamentos, refunds e mudanças

`Cancelled` e blocos de refund foram observados na resposta real. Cada reimportação deve comparar o payload normalizado com a projeção anterior:

- mudança cria nova evidência/evento;
- não sobrescreve evidência anterior;
- cancelamento bloqueia nova materialização;
- refund total ou parcial é preservado sem antecipar regra financeira;
- mudança após materialização gera conflito/correção conforme contrato comum;
- divergência exige revisão humana quando aplicável.

## 12. Rate limits, retry e backoff

A Developer Analytics API foi consultada com token de aplicação. Para o keyset validado, `GetOrders` e `GetMyeBayBuying` informaram limite de **5.000 chamadas por janela de 86.400 segundos**. A utilização e o saldo são dinâmicos e não devem ser documentados como constante operacional.

O adapter deve:

- consultar/monitorar a quota da aplicação;
- respeitar throttling e reset informado;
- usar retry limitado com backoff exponencial e jitter apenas para falhas transitórias;
- não repetir falha de autorização sem refresh/reautorização;
- persistir checkpoint antes de avançar página;
- impedir loop infinito de paginação;
- registrar métricas sem payload sensível.

## 13. Segurança e minimização

- parse XML com limites de tamanho e profundidade;
- rejeitar resposta sem `Ack=Success` ou contrato mínimo;
- não confiar em timestamps, valores ou status sem validação;
- não aceitar `lojaId` do provider;
- staging global exige RBAC próprio;
- não persistir XML bruto sem política explícita de retenção e sanitização;
- não armazenar buyer email/endereço se não forem necessários;
- não registrar headers, códigos, tokens ou payloads com PII;
- auditar sincronização, reconciliação, aprovação e falhas sanitizadas;
- cumprir políticas vigentes de Data Handling do eBay.

## 14. Casos especiais

- pedido combinado com múltiplas linhas;
- mudança do Order ID durante evolução de pagamento, conforme documentação da Trading API;
- item sem variação;
- tracking ausente ou posterior;
- múltiplos códigos por pedido;
- cancelamento depois da aprovação;
- refund parcial;
- resposta vazia válida;
- alteração enquanto uma página está sendo processada;
- username mascarado/ID imutável;
- resposta parcial ou warning do eBay.

## 15. Read models e ações futuras

O adapter alimentará o pipeline comum do Batch 10. O frontend não consumirá XML nem token e não chamará o eBay diretamente. Read models devem expor somente dados normalizados, evidências, divergências, `allowedActions` e `blockedReasons` autorizados.

Toda compra detectada automaticamente exige aprovação humana antes de atribuição e materialização.

## 16. Limitações e decisões abertas

Comprovado neste gate:

- keyset Production válido;
- OAuth User Token e refresh;
- conta buyer autorizada;
- `GetOrders` buyer;
- campos reais;
- tracking real e múltiplo;
- paginação do recorte;
- quota da aplicação.

Ainda aberto para implementação:

- frequência operacional e sobreposição exatas;
- quantidade futura de contas eBay e escopo `SHARED`/dedicado de cada uma;
- secret manager de produção;
- política final de retenção/minimização de XML e PII;
- comportamento de warnings/parciais observado em volume maior;
- mapeamento definitivo de refunds e cancelamentos para divergências do pipeline comum;
- validação de paginação com mais de uma página em dados reais;
- estratégia operacional de reautorização antes da expiração do refresh token.

Esses itens não invalidam o onboarding. Regras de produto que afetem o pipeline comum permanecem no Batch 10; detalhes do adapter pertencem ao Batch 11.

## 17. Referências oficiais

- [GetOrders — Trading API](https://www.developer.ebay.com/devzone/xml/docs/reference/ebay/GetOrders.html)
- [GetMyeBayBuying — Trading API](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBayBuying.html)
- [OAuth authorization](https://developer.ebay.com/develop/guides-v2/authorization)
- [OAuth credentials](https://developer.ebay.com/api-docs/static/oauth-credentials.html)
- [Making a Trading API call](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html)
- [Developer Analytics API](https://developer.ebay.com/develop/api/sell/developer_analytics_api)
- [API call limits](https://developer.ebay.com/develop/get-started/api-call-limits)
- [API status](https://developer.ebay.com/support/api-status)
- [API deprecation status](https://developer.ebay.com/develop/get-started/api-deprecation-status)

## 18. Gate

**PRONTO PARA IMPLEMENTAÇÃO DO ADAPTER EBAY BUYER**, condicionado à ordem normativa: Batch 10 implementa primeiro o pipeline comum; Batch 11 implementa o adapter usando esta especificação. Nenhum adapter, endpoint, schema, migration ou tela foi criado durante o gate.
