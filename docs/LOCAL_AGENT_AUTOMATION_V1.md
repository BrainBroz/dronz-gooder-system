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
   Isso não substitui o isolamento real: arquivos ignorados (`.env`, etc.)
   são invisíveis ao `git status` e só ficam de fora pelo worktree abaixo.
2. Cria um worktree temporário e descartável baseado no commit HEAD (`git
   worktree add --detach`). O Codex roda exclusivamente nesse checkout limpo
   — sem `.env`, sem `.agents`, sem arquivos ignorados ou alterações locais.
   Um `trap EXIT` garante remoção do worktree mesmo em falha.
3. Roda `codex exec -s read-only -a never` no worktree isolado, com timeout
   configurável (`AGENT_REVIEW_TIMEOUT`, padrão 300 s). O timeout usa um
   processo em background + `kill -TERM`, compatível com macOS (sem depender
   de `timeout` GNU). Ao expirar, registra status e encerra com erro.
4. O prompt declara explicitamente que diff, mensagens de commit e nomes de
   arquivo são dados não confiáveis e não podem sobrescrever as instruções do
   revisor.
5. Grava `metadata.md` e `codex.md` em `.agents/reviews/<sha-do-commit>/`
   com permissões restritas (diretório 700, arquivos 600).
6. Se o Codex falhar (`exit != 0`), expirar ou não gerar parecer (arquivo
   vazio ou ausente), o hook termina com erro explícito — silêncio nunca é
   interpretado como aprovação.

## Base do diff e atualização de origin/main

`origin/main` é a referência **local e cacheada** no momento da execução —
o script não faz `git fetch` automaticamente para não adicionar dependência
de rede ao hook. Consequência prática:

- Em revisões de commits do dia a dia, a defasagem é irrelevante.
- **Antes de uma revisão de conclusão ou PR**, execute `git fetch` para
  garantir que `origin/main` reflita o estado atual do remote.
- Alternativamente, passe a base explicitamente:
  `AGENT_REVIEW_BASE=origin/main git commit ...`

O SHA resolvido da base é registrado no `metadata.md` de cada revisão, não
apenas o nome simbólico — isso garante reprodutibilidade mesmo que o remote
avance depois da revisão.

## Timeout e compatibilidade macOS

O `codex exec` roda com timeout padrão de 300 segundos, configurável via
`AGENT_REVIEW_TIMEOUT` (deve ser um inteiro positivo — valores inválidos
encerram o script com erro imediato antes de iniciar qualquer processo). A
implementação usa um processo em background com `kill -TERM`, sem depender de
`timeout` GNU (não disponível por padrão no macOS). Ao expirar:

- O processo Codex recebe `SIGTERM`.
- O hook registra "timed out" no stderr e encerra com código 1.
- O worktree temporário é removido via `trap EXIT`.
- O terminal do desenvolvedor não fica bloqueado indefinidamente.

## Artefatos locais e permissões

Os arquivos gerados em `.agents/reviews/<sha>/` recebem permissões restritas:

- Diretório: `chmod 700`
- `metadata.md`, `codex.md`, `codex.stderr`: `chmod 600`

O diretório `.agents/` é ignorado pelo Git (`.gitignore: /.agents/`), local
por checkout, e deve ser limpo periodicamente. Não armazenar tokens, segredos
ou dados de produção nesses arquivos.

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
