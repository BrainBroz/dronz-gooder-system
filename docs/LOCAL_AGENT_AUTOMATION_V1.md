# Revisão local automatizada por Codex

**Status:** ativo · **Escopo:** hook local de Git, não afeta CI nem GitHub

## Objetivo

Permitir que qualquer commit marcado para auditoria dispare uma revisão técnica
independente por Codex, localmente, sem exigir GitHub, webhook, chave de API de
IA no repositório ou qualquer intervenção manual do Product Owner para
disparar a revisão.

## Como ativar

```bash
bash scripts/enable-local-agent-hooks.sh
```

Isso configura `core.hooksPath=.githooks` neste checkout local. É por
repositório clonado, não é global e não é versionado como estado — cada
pessoa/agente que quiser o gate ativo roda o script uma vez.

## Como usar

Adicione o trailer `Agent-Review: required` na mensagem do commit que deve
ser auditado:

```bash
git commit -m "feat: minha entrega

Agent-Review: required"
```

O hook `post-commit` só age quando esse trailer exato está presente — commits
sem o trailer não disparam nada, para não travar o dia a dia com revisões em
todo commit trivial.

## O que acontece

1. Verifica árvore de trabalho limpa (`git status --porcelain` vazio) — a
   revisão exige que o commit já exista, sem alterações soltas por cima.
2. Roda `codex exec -s read-only -a never` contra o diff do commit em relação
   a `${AGENT_REVIEW_BASE:-origin/main}`, com uma instrução explícita para o
   Codex rodar `git diff` ele mesmo (o script não embute o diff no prompt).
3. Grava `metadata.md` e `codex.md` em `.agents/reviews/<sha-do-commit>/`.
4. Se o Codex falhar (`exit != 0`) ou não gerar parecer (arquivo vazio), o
   hook termina com erro explícito — silêncio nunca é interpretado como
   aprovação.

## O que este gate NUNCA faz

- Não faz push, merge, amend, reset ou qualquer edição automática de arquivo.
- Não aprova nada sozinho — um `codex.md` com o veredito `APPROVED` ainda
  precisa ser lido por uma pessoa antes de declarar a entrega concluída.
- Não substitui o Quality Gate do GitHub Actions (lint/typecheck/build/test),
  que roda de forma totalmente independente deste hook.

## Gemini fica de fora deste gate — de propósito

Uma versão anterior deste hook tentava rodar Gemini em paralelo com Codex.
Foi removida depois de testar de ponta a ponta em worktree isolado e
encontrar dois problemas reais:

1. Em modo `--approval-mode plan` (somente leitura), o Gemini CLI não tem
   acesso à ferramenta de shell necessária para rodar `git diff` sozinho,
   quebrando o mesmo padrão que funciona para o Codex.
2. A chave usada está no tier gratuito da API do Gemini, com cota de
   **5 requisições** — insuficiente para disparo automático a cada commit.

Gemini continua disponível para revisão de arquitetura, contratos e
documentos grandes, mas **sob demanda**, via `mcp__pal__clink` (`cli_name:
"gemini"`) chamado explicitamente por quem estiver conduzindo a implementação
— nunca automaticamente no hook. Isso evita estourar a cota gratuita e evita
falhas silenciosas equivalentes às já observadas.

## Relação com o Quality Gate do GitHub

Este hook e o `.github/workflows/quality-gate.yml` (quando presente na
branch) são mecanismos independentes e complementares:

| | Hook local (`Agent-Review: required`) | Quality Gate (GitHub Actions) |
| --- | --- | --- |
| Dispara em | commit local, sob demanda | todo push/PR para `main` |
| Cobre | revisão técnica por IA (Codex) | lint, typecheck, build, testes |
| Depende de | Codex CLI autenticado na máquina | apenas o runner do GitHub |
| Bloqueia commit? | não (roda depois, `post-commit`) | bloqueia merge via proteção de branch |
