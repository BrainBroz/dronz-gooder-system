# Protocolo de colaboração entre agentes V1

## Objetivo

Permitir que implementação, validação técnica e revisão documental ocorram em sequência rastreável, sem o Product Owner precisar retransmitir mensagens entre agentes.

Este protocolo não altera o domínio, não autoriza merges automáticos e não substitui o `AGENTS.md` nem os contratos normativos.

## Papéis

| Papel | Responsabilidade | Não faz |
| --- | --- | --- |
| Implementador (Claude) | Implementa uma tarefa delimitada, testa, cria commit e preenche o handoff. | Aprovar a própria entrega ou alterar o escopo sem registro. |
| Revisor técnico (Codex) | Audita diff, testes, segurança, isolamento por loja e compatibilidade com contratos. | Corrigir silenciosamente a entrega durante uma revisão. |
| Revisor documental (Gemini) | Revisa documentos grandes, contratos, contradições e cobertura de decisões. | Declarar comportamento de código sem evidência. |
| Product Owner | Decide regras de produto, aprova dependências, riscos e merge. | Ser intermediário manual entre agentes. |
| CI do GitHub | Executa checks repetíveis de qualidade. | Tomar decisão de produto ou chamar modelos de IA sem integração aprovada. |

## Fluxo obrigatório

```text
Tarefa aprovada
  -> branch curta por escopo
  -> implementação + testes + commit
  -> handoff completo na PR
  -> Quality gate do GitHub
  -> revisão Codex
  -> revisão Gemini quando documentos/contratos forem afetados
  -> Product Owner decide apenas pendências e merge
```

Cada PR trata de um batch ou correção coerente. Não misture UI, domínio, migrations e refatorações não relacionadas sem uma justificativa explícita no handoff.

## Handoff

O modelo oficial é [`handoffs/PR_HANDOFF_TEMPLATE.md`](handoffs/PR_HANDOFF_TEMPLATE.md). O implementador deve registrar commit base/final, escopo, arquivos relevantes, validações, riscos e decisões pendentes.

O revisor deve responder diretamente no mesmo handoff ou na PR com um dos vereditos definidos pelo modelo. Uma afirmação sem comando, diff, teste ou referência ao contrato é `NÃO COMPROVADA`.

## Automação disponível agora

O workflow [`.github/workflows/quality-gate.yml`](../.github/workflows/quality-gate.yml) executa em PRs para `main` e em pushes para `main`:

1. instalação reprodutível por `npm ci`;
2. Prisma Client;
3. lint;
4. typecheck;
5. build;
6. testes com PostgreSQL 16 efêmero.

Falha em qualquer etapa bloqueia o merge pela regra de proteção do repositório, a ser habilitada pelo administrador no GitHub.

## Revisão assistida por IA

GitHub Actions não deve conter chaves de OpenAI, Gemini ou tokens de chat no código, em arquivos `.env` ou nos logs. A revisão por Codex/Gemini deve usar uma integração aprovada (GitHub App, webhook interno ou conector oficial), configurada com secrets exclusivamente no provedor.

Quando essa integração estiver disponível, ela deve ser disparada após o `quality-gate` verde e publicar um parecer no pull request. Até lá, o handoff permite que cada revisor receba o mesmo contexto sem retransmissão manual pelo Product Owner.

## Regras de segurança e Git

- Não enviar `main` diretamente para mudanças de produto.
- Não fazer merge automático de PR que altere schema, migration, RBAC, contrato de domínio ou dependências.
- Não usar o mesmo working tree para dois agentes ativos.
- Não reaplicar stashes ou branches antigas sem comparação por diff e aprovação.
- Não incluir tokens, cookies, dados de produção, `node_modules`, artefatos ou arquivos `.env`.
- Manter a decisão final de merge humana.

## Configuração única no GitHub

O administrador deve configurar proteção da branch `main` para exigir o check **Lint, types, build and tests**, bloquear force-push e exigir ao menos uma aprovação humana. Uma futura integração Codex/Gemini deve virar check obrigatório somente após ser validada em PRs não críticos.

## Próximo passo operacional

1. Criar uma PR de teste com este protocolo.
2. Verificar que o Quality gate aparece e executa com PostgreSQL.
3. Habilitar a proteção de `main` no GitHub.
4. Conectar Codex/Gemini por GitHub App ou webhook, sem versionar credenciais.
