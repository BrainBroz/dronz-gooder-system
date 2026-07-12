# Batch 3.1 — Correções do Backend UI-3C

## Escopo

Este batch corrige exclusivamente os achados bloqueadores e altos da auditoria do commit `6367fb3`. Não inclui frontend, Compras Unificadas, Dashboard ou Relatórios.

O arquivo `docs/PROJECT_CONTEXT_MASTER.md`, citado no pedido do batch, não estava presente. Nenhum conteúdo foi inferido para substituí-lo.

As validações deste batch usam Node.js 22, conforme `.nvmrc`.

## B3-A01 — Conservação de compensações

Problema: compensações eram limitadas apenas pelo saldo atual, permitindo compensar mais que o movimento original quando o estoque continha outras origens.

Solução:

- FK composta real para o movimento original na mesma loja;
- check contra autorreferência;
- movimento compensatório não pode servir como movimento original;
- lock pessimista `FOR UPDATE` no movimento original;
- soma transacional das compensações anteriores;
- saldo compensado limitado ao intervalo entre zero e a quantidade original;
- movimento e estoque atualizados na mesma transação.

## B3-A02 — Projeção efetiva

Problema: o evento corretivo era persistido, mas read models e entrada definitiva continuavam usando o estado original.

Solução: `ProjecaoOperacional` mantém o estado efetivo versionado. Correções continuam imutáveis e os read models sobrepõem a projeção ao evento original. Entrada definitiva também valida as projeções efetivas de checkpoints e itens.

## B3-A03 — Ações e policy

Problema: read models ofereciam ações sem considerar todas as pré-condições dos POSTs.

Solução: avaliações Paraguai/Brasil foram centralizadas em `operations.policy.ts`. Os mesmos avaliadores alimentam `allowedActions`, bloqueios e assertions das mutações.

## B3-A04 — RBAC

Problema: uma permissão de leitura dava acesso ao overview integral e ao histórico de outras etapas.

Solução:

- overview calcula somente seções autorizadas;
- histórico exige entidade explícita;
- cada entidade possui permissão correspondente;
- detalhe sem checkpoint retorna histórico vazio, não histórico amplo.

## B3-A05 — Upgrade legado

Problema: marcar uma `EstoqueEntrada` duplicada como superada não corrigia movimentos `ENTRY` e saldo duplicado.

Solução: migration corretiva compara `ENTRY` de recebimento com a quantidade fisicamente aceita. Excesso gera `ADJUSTMENT_NEGATIVE` auditável, ligado ao movimento original. Se a correção violar saldo reservado ou resultar em saldo negativo, a migration aborta em vez de corromper dados.

O script `scripts/test-ui3c-migration.sh` aplica a baseline em banco descartável, cria duas entradas para a mesma quantidade, executa o upgrade e comprova saldo, histórico e compensação.

## B3-A06 — Divergências de recebimento

Foi criado `TipoDivergenciaRecebimento`:

- `CORRETO`;
- `FALTA`;
- `EXCESSO`;
- `AVARIA`;
- `ITEM_INCORRETO`;
- `OUTRO`.

Divergências exigem observação e permanecem não resolvidas até correção explícita. Entrada definitiva é bloqueada enquanto houver divergência não resolvida.

## B3-A07 — Read models

Foram adicionados detalhes de recebimento e entrada definitiva com:

- itens;
- quantidades;
- divergências;
- progresso;
- impacto previsto;
- estado efetivo;
- ações;
- bloqueios;
- histórico.

Consultas de detalhe filtram o recurso no banco e não carregam toda a coleção da loja.

## B3-A08 — Testes

Cobertura acrescentada:

- compensação sequencial e concorrente;
- limite acumulado do movimento original;
- projeção efetiva de correção;
- RBAC específico do perfil Miami;
- equivalência entre action e policy;
- rollback quando `AuditLog` falha;
- divergência tipada de recebimento;
- upgrade real com saldo duplicado.

Nenhum teste anterior foi removido.
