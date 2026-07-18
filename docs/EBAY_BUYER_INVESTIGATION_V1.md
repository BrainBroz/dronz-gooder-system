# Investigação forense do eBay buyer — V1

**Batch original:** 8.2

**Investigação inicial:** 2026-07-13

**Atualização pós-gate:** 2026-07-14

**Estado:** investigação histórica superada por evidência operacional; ver `EBAY_BUYER_SPECIFICATION_V1.md`

## 1. Hipótese inicial

O Product Owner informou que um sistema anterior importava compras da própria conta eBay. O repositório, a configuração e o histórico desse sistema não foram localizados nos diretórios Git acessíveis. A investigação inicial identificou `GetMyeBayBuying/WonList` como chamada buyer tecnicamente possível, mas ainda não possuía keyset, OAuth, resposta real, quota ou origem comprovada de tracking.

Nenhum código legado foi recuperado ou reaplicado. Em vez de confiar no relato do sistema anterior, o Gate eBay Buyer validou diretamente a aplicação e a conta autorizadas no eBay Production.

## 2. Resultado da investigação operacional

O gate comprovou duas chamadas buyer da Trading API:

| Chamada | Resultado real | Decisão |
| --- | --- | --- |
| `GetMyeBayBuying` com `WonList` | compras buyer, identidades, quantidades, valores e datas; tracking ausente na resposta observada | auxiliar, não principal |
| `GetOrders` com `OrderRole=Buyer` | pedidos, itens, estados, envio, cancelamentos, refunds e tracking | fonte principal do adapter |

`GetOrders` é a decisão final porque atende o pedido externo e o tracking no mesmo contrato sem recorrer a API seller. Sell Fulfillment continua fora do caso de uso, e Buy Order API continua limitada ao próprio fluxo Buy API.

## 3. Evidência sanitizada

Na chamada Production de 2026-07-14, janela de 30 dias:

- HTTP `200` e `Ack=Success`;
- schema version respondida `1455`;
- 37 pedidos e 44 linhas/transações;
- 2 pedidos com múltiplas linhas;
- 31 pedidos com tracking;
- 34 registros de tracking;
- até 3 registros de tracking no mesmo pedido;
- USD observado;
- estados `Completed` e `Cancelled` observados;
- refunds presentes;
- uma página, `HasMoreOrders=false`.

Nenhum identificador, título, seller, buyer, código de tracking, token, cookie ou secret foi registrado neste documento.

## 4. OAuth e segurança

Foi comprovado em Production:

- Authorization Code Grant;
- consentimento da conta buyer;
- escopo base `https://api.ebay.com/oauth/api_scope`;
- User access token usado em `X-EBAY-API-IAF-TOKEN`;
- access token com 7.200 segundos;
- refresh token de longa duração;
- renovação real do access token por refresh;
- credencial mantida fora do repositório.

Durante o gate, o material foi guardado no macOS Keychain apenas para validação local. Produção exige secret manager integrado ao `SecretProvider`; banco, Git, documentação, logs e respostas armazenam somente referência opaca, nunca o valor.

## 5. Paginação e janela

`GetOrders` aceita até 100 pedidos por página e informa `HasMoreOrders`, `TotalNumberOfPages` e `TotalNumberOfEntries`. `NumberOfDays` cobre até 30 dias; intervalos de criação/modificação suportam até 90 dias conforme documentação oficial.

O adapter deve usar janela de modificação com sobreposição, cursor opaco, retenção local e deduplicação por conta/pedido/linha. O recorte real possuía apenas uma página; a execução com múltiplas páginas precisa ser coberta por testes e monitorada em produção.

## 6. Quota

A Developer Analytics API foi consultada para o keyset Production autorizado. `GetOrders` e `GetMyeBayBuying` informaram limite de 5.000 chamadas por janela de 86.400 segundos. Uso, saldo e reset são dinâmicos e devem ser monitorados, não hardcoded.

## 7. Campos comprovados

- pedido: `OrderID`, `ExtendedOrderID`, datas, status, pagamento, total e moeda;
- linha: `OrderLineItemID`, `TransactionID`, `ItemID`, título, variação, quantidade e preço;
- participantes: buyer/seller identifiers conforme política de dados;
- envio: serviço, custo, `ShippingDetails` e datas;
- tracking: `ShipmentTrackingDetails`, carrier e código;
- exceções: cancelamento e refund quando presentes;
- mídia: URLs/imagens quando presentes.

Campos condicionais ausentes não podem ser inventados. Título ou índice de array não servem como identidade.

## 8. Compatibilidade com a fundação

| Capacidade | Estado pós-gate |
| --- | --- |
| provider + conta + pedido | compatível |
| identidade de linha | `OrderLineItemID`, fallback `ItemID + TransactionID` |
| múltiplas contas | suportado pela fundação; quantidade/escopo futuro ainda abertos |
| paginação | adaptável a cursor opaco |
| retenção | staging local cobre saída da janela externa |
| cancelamento/refund | comprovados; mapping do pipeline pendente |
| envios/trackings | comprovados, inclusive múltiplos |
| atualização posterior | contrato definido; pipeline/adapter pendentes |
| secrets externos | abstração pronta; secret manager de produção pendente |

A fundação não precisa ser descartada. O adapter traduzirá `GetOrders` para evidências e DTOs normalizados existentes, sem materialização automática.

## 9. Itens ainda abertos

- frequência e sobreposição operacionais;
- quantidade e escopo das futuras contas eBay;
- secret manager de produção;
- retenção/minimização de XML e PII;
- teste real com mais de uma página;
- política operacional de reautorização;
- mapping final de cancelamentos/refunds no pipeline comum.

Esses itens pertencem aos Batches 10 e 11 e não invalidam o onboarding.

## 10. Fontes oficiais

- [Trading API — GetOrders](https://www.developer.ebay.com/devzone/xml/docs/reference/ebay/GetOrders.html)
- [Trading API — GetMyeBayBuying](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBayBuying.html)
- [Making a Trading API call](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html)
- [eBay authorization guide](https://developer.ebay.com/develop/guides-v2/authorization)
- [Developer Analytics API](https://developer.ebay.com/develop/api/sell/developer_analytics_api)
- [API status](https://developer.ebay.com/support/api-status)
- [API deprecation status](https://developer.ebay.com/develop/get-started/api-deprecation-status)

## 11. Veredito

**PRONTO PARA IMPLEMENTAÇÃO DO ADAPTER EBAY BUYER**, depois da implementação do pipeline comum do Batch 10. A especificação normativa está em `EBAY_BUYER_SPECIFICATION_V1.md`. Nenhum adapter foi implementado por esta investigação.
