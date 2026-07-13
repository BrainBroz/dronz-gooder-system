# UI-3C Backend V1

## Estado implementado

O backend da UI-3C foi concluído nos commits `6367fb3` e `79f5247`. Ele fornece read models tenant-safe, RBAC granular, snapshot de rota, idempotência persistente, auditoria estruturada e eventos corretivos. O frontend foi implementado posteriormente nos commits `fe658c8` e `cf3a880`, documentados em `UI3C_FRONTEND_V1.md`.

## Rotas e checkpoints

`Viagem` preserva `rotaCodigo`, `rotaVersao` e `checkpointsObrigatorios`. Rotas novas aceitas:

- `MIAMI_PARAGUAI_BRASIL`;
- `MIAMI_BRASIL`.

Miami, Brasil, recebimento e entrada definitiva permanecem essenciais. Paraguai é exigido somente quando consta no snapshot. Configurações futuras não reescrevem viagens existentes.

## Read models

Todos exigem JWT, `x-store-id`, vínculo e permissão de leitura:

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
- `GET /operations/definitive-entry/:id`;
- `GET /operations/history`.

Os DTOs retornam `allowedActions` e `blockedReasons`. Dados monetários não fazem parte do read model Miami.

## Mutações

As rotas existentes foram preservadas e agora aplicam permissão específica. O header opcional `idempotency-key` ativa replay persistente: mesmo payload retorna o resultado anterior; payload diferente retorna `idempotency_conflict`.

- `POST /logistics/miami-confirmations`;
- `POST /logistics/checkpoint-paraguai`;
- `POST /logistics/checkpoint-brasil`;
- `POST /receiving`;
- `POST /receiving/:id/items/:itemId/confirm`;
- `POST /receiving/entrada-definitiva`;
- `POST /operations/corrections`.

Confirmação de item não cria estoque. Somente entrada definitiva concluída cria `ENTRY`. Correção pós-estoque usa movimento `ADJUSTMENT_POSITIVE` ou `ADJUSTMENT_NEGATIVE`, motivo `MANUAL_CORRECTION` e referência ao movimento original.

## Permissões

- `MIAMI_RECEBIMENTO_VISUALIZAR`;
- `MIAMI_RECEBIMENTO_CONFIRMAR`;
- `PARAGUAI_CHECKPOINT_VISUALIZAR`;
- `PARAGUAI_CHECKPOINT_CONFIRMAR`;
- `BRASIL_CHECKPOINT_VISUALIZAR`;
- `BRASIL_CHECKPOINT_CONFIRMAR`;
- `RECEBIMENTO_VISUALIZAR`;
- `RECEBIMENTO_CONFIRMAR`;
- `ENTRADA_DEFINITIVA_VISUALIZAR`;
- `ENTRADA_DEFINITIVA_CONFIRMAR`;
- `CHECKPOINT_CORRIGIR`.

`SUPER_ADMIN` recebe todas. `CHECKPOINT_MIAMI` recebe somente leitura/confirmação Miami e não recebe permissões financeiras.

## Auditoria e correção

Mutações críticas gravam ator, loja, permissão, ação, entidade, correlação, idempotency key e antes/depois na mesma transação. Eventos originais permanecem imutáveis. Duplicidades legadas são preservadas e marcadas por `supersededAt`; índices parciais impedem mais de um registro ativo por viagem+mala+loja.

## Erros de domínio relevantes

- `insufficient_permission` — 403;
- `checkpoint_not_applicable` — 409;
- `checkpoint_required` — 409;
- `invalid_transition` — 409;
- `brazil_arrival_required` — 409;
- `receiving_not_complete` — 409;
- `idempotency_conflict` — 409;
- `already_confirmed` — 409;
- `correction_not_allowed` — 409.

## Compatibilidade e migration

Migrations: `20260712180000_ui3c_backend` e `20260712210000_ui3c_audit_fixes`.

As alterações são aditivas. Registros duplicados legados não são apagados: o primeiro registro canônico permanece ativo e os demais recebem `supersededAt`. Banco limpo e baseline existente devem executar ambas as migrations antes do deploy. A migration corretiva também preserva compensações e aborta quando não puder reparar saldo legado com segurança.
