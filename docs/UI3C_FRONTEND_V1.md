# UI-3C Frontend V1

**Status:** implementado nos commits `fe658c8` e `cf3a880`.

## Escopo

O frontend operacional implementa a sequência Miami → Paraguai → Brasil → Recebimento → Entrada Definitiva sobre os contratos do backend UI-3C. Este batch não altera schema, migrations, seed, serviços da API nem regras de domínio.

## Arquitetura

- `OperationsPage` coordena navegação entre etapas e seleção de detalhes.
- `useOperations` concentra transporte HTTP, query keys tenantadas e invalidação.
- `types/operations.ts` descreve exclusivamente a forma serializada dos read models já publicados pela API; não contém máquina de estados.
- componentes em `components/operations` apresentam cards, loading, erro, vazio, bloqueios e histórico.
- um `QueryClient` existente continua sendo a fonte de server state.
- a troca de loja remonta o conteúdo e todas as chaves incluem `storeId`.

## Autoridade do backend

O frontend não calcula elegibilidade, progresso, alertas, impacto ou transições. Ele apresenta literalmente:

- `status`;
- `applicability`;
- `allowedActions`;
- `blockedReasons`;
- `progress`;
- `impactQuantity`;
- checkpoints e projeções efetivas;
- histórico de auditoria.

Botões operacionais só existem quando a ação correspondente está em `allowedActions`. Permissões da sessão protegem apenas o acesso geral; não criam transições nem correções contextuais. O backend continua validando JWT, `x-store-id`, vínculo e permissão em todas as chamadas.

## Contratos consumidos

Read models:

- `GET /operations/overview`;
- `GET /operations/miami/candidates`;
- `GET /operations/miami/items/:id`;
- `GET /operations/paraguay/candidates`;
- `GET /operations/paraguay/:id`;
- `GET /operations/brazil/candidates`;
- `GET /operations/brazil/:id`;
- `GET /operations/receiving/candidates`;
- `GET /operations/receiving/:id`;
- `GET /operations/definitive-entry/candidates`;
- `GET /operations/definitive-entry/:id`.

Mutações:

- `POST /logistics/miami-confirmations`;
- `POST /logistics/checkpoint-paraguai`;
- `POST /logistics/checkpoint-brasil`;
- `POST /receiving`;
- `POST /receiving/:id/items/:itemId/confirm`;
- `POST /receiving/entrada-definitiva`;
- `POST /operations/corrections` para correção auditável de item de recebimento.

O histórico é consumido dos detalhes oficiais, que retornam a mesma paginação produzida por `GET /operations/history`. O frontend não tenta correlacionar eventos por conta própria.

## Experiência

Todas as etapas possuem skeleton, erro, retry, vazio, atualização manual, feedback de mutação e bloqueios. Os formulários usam apenas enums aceitos pelos contratos e enviam uma chave de idempotência por tentativa.

## Testes

Os testes comportamentais cobrem loading, erro, retry, vazio, Miami, Paraguai aplicável e não aplicável, Brasil bloqueado, recebimento, entrada definitiva, histórico, correção, `allowedActions`, `blockedReasons`, headers tenantados, payloads e troca de loja sem estado stale.

## Limites preservados

- nenhuma regra foi movida para o frontend;
- nenhum impacto ou fórmula de estoque foi recalculado;
- nenhuma dependência foi adicionada;
- Compras Unificadas, Dashboard e Relatórios não foram alterados;
- correções de estoque com compensações continuam fora da UI genérica: exigem seleção segura de movimento original fornecida por read model específico, que não faz parte do contrato visual atual.

## Correção pós-auditoria — Batch 4.1

### Causa e regra corrigida

O Batch 4 apresentava o botão de correção de item quando a identidade local continha `CHECKPOINT_CORRIGIR`. Isso substituía indevidamente a decisão operacional do read model. A autorização visual agora depende exclusivamente de `allowedActions`; permissões da sessão não criam ações.

O backend atual não publica uma ação oficial de correção em `allowedActions`. Por isso, o frontend não apresenta o formulário de correção. Adicionar uma ação tipada como `CORRECT_RECEIVING_ITEM` ou equivalente exige primeiro ampliar o contrato do read model em um batch de backend autorizado. Nenhuma string de ação foi inventada neste batch.

### Fonte única de apresentação

`operationActionPresentation` é a única matriz `action → label/formulário/intenção HTTP/feedback`. Ela não contém status, elegibilidade, transição, bloqueio, perfil ou permissão. A página transforma literalmente as ações recebidas e não deriva mais `etapa → ação esperada`.

Foram removidas:

- a checagem local de `CHECKPOINT_CORRIGIR` para renderizar correção;
- a função `actionFor`, que reproduzia a associação entre etapa e ação;
- labels e URLs operacionais repetidos entre cards e formulários.

### Regressão coberta

Os testes comprovam:

- permissão local sem `allowedAction` não cria botão nem mutação;
- ação oficial de conferência abre formulário, envia payload e `idempotency-key` e invalida somente o prefixo tenantado de operações;
- refetch que remove a ação desmonta o formulário aberto;
- troca de loja remove ações e dados da loja anterior;
- `blockedReasons` sem ação permanece somente informativo.

### Limitação mantida

Não existe teste de correção com `allowedAction` oficial porque essa ação não existe no contrato serializado atual. A limitação é intencional e impede que o frontend invente autorização. O fluxo poderá ser habilitado quando o backend publicar a ação específica no read model da entidade.
