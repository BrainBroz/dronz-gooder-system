# Investigação forense do eBay buyer — V1

**Batch:** 8.2

**Data:** 2026-07-13

**Escopo:** correção documental; nenhum adapter, credencial ou integração implementado

## 1. Evidência disponível

O Product Owner informou que um sistema existente importa compras da própria conta eBay. Esse sistema, seu repositório, configuração e histórico não foram encontrados nos diretórios Git acessíveis nesta execução. Também não há referência a `GetMyeBayBuying`, `WonList` ou Trading API no histórico do repositório Dronz & Gooder.

Faltam, portanto, evidências locais para comprovar:

- chamada e versão realmente usadas;
- autenticação OAuth ou Auth'n'Auth e keyset associado;
- containers solicitados e parâmetros de paginação;
- `DurationInDays` efetivo e frequência de sincronização;
- ambiente Sandbox ou Production;
- quota concedida à aplicação;
- política de retenção acima da janela da API;
- origem dos códigos de tracking.

Nenhum segredo foi pesquisado por valor, exibido ou copiado.

## 2. Evidência oficial atual

Fontes oficiais consultadas:

- [Trading API — GetMyeBayBuying](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBayBuying.html);
- [Making a Trading API call](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html);
- [eBay authorization guide](https://developer.ebay.com/develop/guides-v2/authorization);
- [API Deprecation Status](https://developer.ebay.com/develop/get-started/api-deprecation-status);
- [API call limits](https://developer.ebay.com/support/kb-article?KBid=1074).

`GetMyeBayBuying` consulta a seção My eBay Buying somente do usuário autenticado. `WonList` retorna itens ganhos/comprados, com transações e pedidos quando disponíveis. A chamada aceita `WonList.DurationInDays` entre 0 e 60, paginação por `EntriesPerPage` e `PageNumber` e devolve totais de páginas e entradas.

A referência inclui, conforme disponibilidade, `OrderLineItemID`, `TransactionID`, `ItemID`, título/variação, `QuantityPurchased`, valores e moeda, `PaidTime`, `ShippedTime`, status de pagamento e cancelamento. `ShipmentTrackingDetails` não foi localizado no contrato atual de `GetMyeBayBuying`; a origem de tracking do sistema legado permanece não comprovada.

OAuth é suportado pela Trading API mediante User access token no header `X-EBAY-API-IAF-TOKEN`; o eBay recomenda OAuth para integrações tradicionais, embora Auth'n'Auth legado permaneça documentado. A forma usada pelo sistema existente é desconhecida.

Na consulta de 2026-07-13, `GetMyeBayBuying` não constava na página oficial de capacidades descontinuadas ou com desligamento anunciado. Isso não comprova elegibilidade de um keyset novo nem acesso produtivo da aplicação: ambos devem ser validados no Developer Portal e em Sandbox/Production. Quotas dependem da API e da aplicação; o valor aplicável à chamada não deve ser presumido a partir de limites genéricos.

## 3. Matriz corrigida

| Plataforma/API | Compras buyer | Vendas seller | Janela | Tracking | Disponibilidade |
| --- | ---: | ---: | --- | --- | --- |
| eBay `GetMyeBayBuying` | Sim, do usuário autenticado | Não é o foco | `DurationInDays` 0–60 | `ShippedTime` documentado; código não comprovado | Referência ativa; keyset e Production a confirmar |
| eBay Sell Fulfillment | Não | Sim | Conforme contrato seller | Seller fulfillment | GA, fora do caso buyer |
| eBay Buy Order API | Somente pedidos do próprio fluxo Buy API | Não | Conforme contrato restrito | Conforme o fluxo | Limited Release/restrita |
| Amazon APIs | Em investigação separada | SP-API atende seller | Não definida | Não definido | A confirmar por fonte buyer |

## 4. Compatibilidade com a fundação do Batch 8

| Capacidade | Estado | Observação |
| --- | --- | --- |
| identidade provider + conta + ordem | Compatível | `EBAY` e conta externa já compõem a identidade persistente |
| múltiplas contas e escopos | Compatível | conexões `SHARED` e `STORE_DEDICATED` já existem |
| janela temporal | Compatível | execução registra `from`/`to`; adapter deve mapear para `DurationInDays` |
| paginação | Compatível com adaptação | cursor opaco pode encapsular `PageNumber` |
| deduplicação e reimportação idêntica | Compatível | identidade e hash são persistentes |
| retenção acima de 60 dias | Compatível | staging local não depende da permanência no eBay |
| itens, moeda e status | Compatível | contrato normalizado possui esses campos |
| cancelamentos | Compatível em estrutura | mapping exato depende da resposta real |
| envios/pacotes/trackings | Parcial | estruturas existem, mas campos e fonte eBay precisam ser comprovados |
| atualização posterior | Contrato definido, implementação pendente | Batch 9 exige evidência versionada e reconciliação auditável; código atual ainda trata mudança incompatível como conflito |

A fundação não precisa ser descartada. O adapter poderá traduzir XML, paginação e janela do eBay para o contrato normalizado. Não é permitido interpretar esse diagnóstico como adapter implementado.

## 5. Retenção e sincronização

A janela máxima de 60 dias torna obrigatórios, para operação contínua:

- sincronização periódica com sobreposição segura de janela;
- deduplicação por conta e identidade externa;
- retenção local após o item sair da janela;
- reprocessamento idempotente;
- tratamento auditável de alterações de status, envio e cancelamento;
- monitoramento de token, quota e falhas de paginação.

A frequência não foi definida porque o comportamento do sistema existente e a quota real não estão disponíveis.

## 6. Gate do adapter

O contrato documental do Batch 9 foi concluído sem depender do keyset. O adapter eBay do Batch 11 não deve iniciar até obter evidência mínima da aplicação existente ou de um keyset legitimamente autorizado:

1. ambiente e keyset;
2. fluxo de consentimento e tipo de token;
3. chamada/versão e request XML reais, sem segredos;
4. resposta sanitizada de Sandbox ou Production;
5. paginação e janela efetivas;
6. quota aplicável;
7. origem comprovada de tracking;
8. política de atualização incremental e retenção.

Amazon buyer é uma trilha separada no Batch 10, baseada na Amazon Business Reporting API e condicionada ao onboarding próprio. Não se presume que a solução eBay seja transferível para Amazon.
