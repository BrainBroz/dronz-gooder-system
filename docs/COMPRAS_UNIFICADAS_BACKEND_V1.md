# Compras Unificadas — Backend V1

## Status

Implementação técnica concluída e aprovada no Batch 5, commit `e9a9d9b`, subordinada a `AGENTS.md` e a `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md`. Gate: **APROVADO**. Este documento descreve o código implementado; não substitui o contrato normativo.

## Modelo de domínio

- `ContaExterna`: identifica uma conta por plataforma e identificador externo. Armazena somente metadados não sensíveis.
- `MerchantExterno`: representa o vendedor externo independentemente do fornecedor interno.
- `CompraImportada`: pedido externo global de staging, sem `lojaId` como autoridade de acesso.
- `CompraImportadaItem`: linha externa com identidade estável (`externalLineId`) ou fingerprint determinístico.
- `MapeamentoMerchantFornecedor`: mapping de merchant para fornecedor interno, por loja.
- `MapeamentoItemProduto`: mapping de linha externa para produto interno, por loja.
- `AtribuicaoCompraItem`: quantidade destinada a uma loja; mantém quantidade já materializada e versão.
- `MaterializacaoCompra` e `MaterializacaoCompraItem`: vínculo imutável entre staging e pedido operacional criado por loja.
- `ConflitoCompra`: divergência explícita que bloqueia materialização até resolução futura autorizada.

As tabelas legadas foram preservadas. A migration `20260712230000_unified_purchases_backend` é aditiva, classifica registros antigos como `LEGACY_REVIEW`/`EM_REVISAO` e gera identidades técnicas para linhas legadas sem inventar especificações comerciais.

## Identidade e idempotência

A identidade do pedido externo é `(plataforma, contaExternaId, externalOrderIdNormalizado)`. IDs externos são normalizados com trim e NFC, sem conversão de caixa. Linhas usam `externalLineId` quando disponível; o fallback é um hash determinístico de identificadores comerciais e variação, nunca a posição visual isolada.

Mutações usam `IdempotencyRecord`, com transação serializável. Mesmo escopo, operação, entidade, chave e payload retornam o resultado anterior. A mesma chave com payload diferente retorna `409 idempotency_conflict`.

## Quantidade e concorrência

Para uma linha:

`elegível = total - cancelada - reembolsada`

`pendente = elegível - soma(atribuições ativas)`

Atribuições são positivas, quantitativas e protegidas por lock pessimista da linha, versão otimista e isolamento serializável. A soma não pode exceder o elegível. Uma atribuição não pode ser reduzida abaixo do que já foi materializado.

## Materialização

A materialização é explícita, transacional, idempotente e independente por loja. Ela exige:

- vínculo do usuário com a loja;
- permissão de materialização;
- atribuição positiva ainda não materializada;
- mapping ativo de produto para cada item;
- mapping ativo de merchant para fornecedor;
- ausência de conflito aberto;
- moeda USD (ou conversão previamente consolidada fora deste batch).

O serviço cria `PedidoCompra`, `PedidoCompraItem` e vínculos de origem. Não cria estoque, checkpoint, recebimento, venda, tracking ou pagamento. O snapshot registra a versão da compra, mapping de fornecedor e produto usados.

## Rotas

Todas exigem JWT e permissão específica.

- `POST /imported-purchases/accounts`
- `POST /imported-purchases/conflicts/:conflictId/resolve`
- `POST /imported-purchases/merchants`
- `POST /imported-purchases`
- `POST /imported-purchases/manual`
- `GET /imported-purchases/overview`
- `GET /imported-purchases`
- `GET /imported-purchases/:id`
- `GET /imported-purchases/:id/history`
- `PUT|DELETE /imported-purchases/items/:itemId/assignments/:lojaId`
- `PUT /imported-purchases/items/:itemId/product-mappings/:lojaId`
- `PUT /imported-purchases/merchants/:merchantId/supplier-mappings/:lojaId`
- `POST /imported-purchases/:id/materializations/:lojaId`

As listas são paginadas, ordenadas deterministicamente e retornam progresso, `allowedActions` e `blockedReasons` produzidos pelo backend.

## RBAC e isolamento

Permissões semeadas de forma idempotente:

- `COMPRAS_IMPORTADAS_VISUALIZAR`
- `COMPRAS_IMPORTADAS_IMPORTAR`
- `COMPRAS_IMPORTADAS_REVISAR`
- `COMPRAS_IMPORTADAS_ATRIBUIR`
- `COMPRAS_IMPORTADAS_MATERIALIZAR`
- `CONTA_EXTERNA_GERENCIAR`
- `MAPPING_FORNECEDOR_GERENCIAR`
- `MAPPING_PRODUTO_GERENCIAR`

O `SUPER_ADMIN` recebe essas permissões. A staging global não usa `lojaId = null` como bypass: requer permissão global. Toda mutação destinada a uma loja também valida o vínculo presente na identidade autenticada. FKs compostas impedem mapping ou materialização com Produto, Fornecedor, Pedido ou Atribuição de outra loja.

## Auditoria e erros

O módulo reutiliza `AuditLog`, com ator, permissão, escopo de loja quando aplicável, correlação, chave idempotente, antes/depois e origem `API_COMPRAS_UNIFICADAS`. Falha crítica de auditoria ocorre dentro da transação e causa rollback.

Erros de domínio retornam códigos estáveis sem stack trace, incluindo `cross_store_access`, `store_assignment_overflow`, `product_mapping_required`, `supplier_mapping_required`, `external_id_conflict`, `concurrent_modification`, `idempotency_conflict` e `currency_conversion_required`.

## Compatibilidade e rollback conceitual

Nenhuma migration anterior foi editada e nenhuma coluna legada foi removida. O rollback operacional consiste em desativar as novas rotas e manter o legado; remover tabelas/colunas só pode ocorrer em cutover posterior com verificação de vínculos materializados. A migration não possui downgrade automático porque excluir vínculos de origem perderia rastreabilidade.

## Limitações deliberadas

- Não há conexão real, credencial ou sincronização com providers.
- Não há resolução pós-materialização que altere patrimônio; conflitos permanecem bloqueados e auditáveis.
- Moeda diferente de USD não é convertida silenciosamente; a materialização é bloqueada.
- Sugestões automáticas de produto/fornecedor não foram implementadas.
- O frontend foi implementado separadamente no Batch 6 e está documentado em `COMPRAS_UNIFICADAS_FRONTEND_V1.md`; este contrato permanece restrito ao backend.

## Limite com fontes futuras de buyer purchase ingestion

O módulo recebe payload interno controlado, mas não acessa e-mail, documentos, CSV ou APIs externas. Futuras fontes de `buyer purchase ingestion` devem adaptar dados ao contrato de staging existente, preservando identidade, idempotência e auditoria. Amazon e eBay são origens possíveis, não a arquitetura central; APIs seller não resolvem o caso principal de compras realizadas. Ordens podem ser importadas antes de qualquer tracking. Pacotes, códigos e atualizações posteriores pertencem ao futuro domínio independente de tracking e não devem ser incorporados diretamente às regras de materialização.
