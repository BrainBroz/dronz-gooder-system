# Project Context Master — Dronz & Gooder System

## 1. Finalidade e autoridade

Este documento é o índice oficial de continuidade técnica do projeto. Ele consolida o estado implementado, as decisões permanentes, os contratos e o histórico dos batches sem substituir suas fontes normativas.

Em caso de conflito, prevalecem, nesta ordem:

1. `AGENTS.md`;
2. contratos normativos específicos, especialmente `domain-contracts.md` e `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md`;
3. schema Prisma e migrations aplicadas;
4. código e testes da baseline atual;
5. este documento como mapa de continuidade;
6. documentos históricos ou de planejamento.

## 2. Objetivo do sistema

O sistema coordena a operação internacional de Dronz e Gooder: compras, atribuição por loja, pedidos operacionais, logística, recebimento, entrada definitiva, estoque, custos e análise. A automação deve preservar revisão humana, rastreabilidade, auditoria e isolamento rigoroso por loja.

As lojas iniciais são `dronz` e `gooder`. Uma remessa física pode transportar itens das duas lojas, mas cada item conserva seu próprio `lojaId`; patrimônio, estoque, autorização e operação não são misturados.

## 3. Arquitetura atual

Monorepo npm workspaces:

- `apps/web`: React 19, Vite 6, TypeScript strict, Material UI 7, React Router 7, TanStack Query 5, React Hook Form, Zod, Zustand e Axios;
- `apps/api`: Node.js 22, Express, TypeScript strict, Prisma 6.19.3 e PostgreSQL;
- `packages/domain`: tipos e contratos elementares de domínio;
- `packages/schemas`: schemas compartilháveis;
- `packages/shared`: constantes e utilitários comuns;
- `docs`: contratos, arquitetura e continuidade;
- `tasks`: especificações históricas de execução.

O frontend é cliente fino. A API valida autenticação, RBAC, `lojaId`, transições, idempotência e regras de negócio. Serviços acessam o Prisma centralizado; rotas e controllers não acessam o banco diretamente.

Páginas web são carregadas por rota com `React.lazy` e `Suspense`. Dependências estáveis são separadas em chunks de React, Material UI, formulários e server state para cache e carregamento previsíveis.

## 4. Persistência e segurança

- PostgreSQL é a persistência operacional.
- Prisma CLI e Client permanecem alinhados em `6.19.3`.
- Migrations são incrementais e migrations aplicadas não são reescritas.
- JWT de acesso permanece em memória no frontend.
- Refresh token existe exclusivamente em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e não integra bodies ou storage web.
- CORS usa origem explícita e credenciais.
- Senhas e refresh tokens são persistidos somente em representação segura.
- `AuditLog` é o mecanismo único de auditoria; não criar sistema paralelo.
- Mutações críticas usam idempotência persistente e transações.

## 5. Regras permanentes

- Toda entidade comercial materializada preserva `lojaId`.
- O backend é a autoridade final de acesso; `x-store-id` nunca é aceito sem validar a identidade.
- Estoques de Dronz e Gooder nunca são combinados.
- Compra consolidada usa USD; BRL serve para conversão e relatórios.
- Estoque real só nasce após chegada ao Brasil, conferência e entrada definitiva.
- A mesma unidade não pode ocupar simultaneamente mais de uma localização ou saldo.
- Toda movimentação deve ser auditável.
- Mala usa limite padrão de 23 kg e volume/caixa usa tara padrão de 0,5 kg.
- Markup mínimo permanece 25%; preço de venda zero é exibido como “A definir”.
- `calcSimulacao` é protegida.
- Datas são persistidas em UTC; Miami usa `America/New_York` e apresentação brasileira usa `America/Sao_Paulo`.
- Não introduzir Next.js, Tailwind, Supabase, Firebase, Nx, Turborepo, pnpm ou Yarn.
- Não adicionar dependências, providers ou integrações sem autorização.

## 6. Contratos normativos

- `domain-contracts.md`: Fornecedores, Pedidos Operacionais, Logística, Recebimento, Estoque, Financeiro manual, Dashboard e Relatórios.
- `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md`: staging global, identidade externa, atribuição quantitativa, materialização por loja e checkpoints.
- `COMPRAS_UNIFICADAS_BACKEND_V1.md`: implementação persistente e HTTP da staging.
- `COMPRAS_UNIFICADAS_FRONTEND_V1.md`: consumo fino dos read models e mutações da staging.
- `UI3C_BACKEND_V1.md`: read models, RBAC, auditoria e correções dos checkpoints.
- `UI3C_FRONTEND_V1.md`: interfaces operacionais governadas por `allowedActions`.
- `PRODUCTION_READINESS.md`: requisitos de ambiente, publicação e riscos operacionais.

## 7. Fluxo operacional implementado

```text
Conta externa / compra manual
  → CompraImportada global
  → revisão e identificação dos itens
  → mapping de merchant para fornecedor por loja
  → mapping de item para produto por loja
  → atribuição quantitativa Dronz / Gooder / saldo pendente
  → materialização idempotente por loja
  → PedidoCompra + PedidoCompraItem operacionais
  → confirmação Miami
  → checkpoint Paraguai quando aplicável à rota
  → checkpoint Brasil
  → recebimento e conferência
  → entrada definitiva
  → estoque real e movimentos auditáveis
  → custos, financeiro manual, dashboard e relatórios
```

Pedido externo, item externo e pedido operacional são entidades distintas. Materializar uma loja não aguarda a outra e retry não duplica pedidos ou quantidades.

## 8. Estado funcional atual

Implementado e coberto por testes:

- autenticação JWT com refresh cookie-only, rotação e revogação;
- usuários, perfis, permissões e vínculos de loja;
- Categorias, Produtos e Fornecedores isolados por loja;
- Pedidos Operacionais por loja;
- staging global de Compras Unificadas;
- contas e merchants externos como registros de domínio sem credenciais;
- mappings, atribuição quantitativa, conflitos e materialização independente por loja;
- logística, viajantes, viagens e malas;
- confirmações Miami, Paraguai e Brasil;
- recebimento, divergências, correções auditáveis e entrada definitiva;
- estoque e movimentações;
- financeiro manual, Dashboard e Relatórios existentes;
- testes de integração PostgreSQL e testes comportamentais web.

Não implementado:

- integrações reais Amazon/eBay;
- tracking automático;
- integrações PayPal, bancárias ou de cartão;
- e-mail, OCR operacional e QR Code;
- documentos e anexos;
- exportações PDF e Excel.

## 9. Histórico da estabilização

| Batch                           | Commit                             | Resultado                                                                |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| 0 — higiene da baseline         | `4ac6336`                          | Node, Prisma, lockfile, ambiente e segredos normalizados                 |
| 1 — testes                      | `2d4b0cb`                          | suítes API/web estabilizadas e infraestrutura jsdom criada               |
| 2 — contrato normativo          | `3fbcc99`, `0ce36f6`               | Compras Unificadas e checkpoints definidos; decisões de produto fechadas |
| 3 — UI-3C backend               | `6367fb3`, `79f5247`               | read models, RBAC, auditoria, idempotência e correções                   |
| 4 — UI-3C frontend              | `fe658c8`, `cf3a880`               | interfaces operacionais e alinhamento estrito a `allowedActions`         |
| 5 — Compras Unificadas backend  | `e9a9d9b`                          | staging, mappings, atribuição, conflitos e materialização                |
| 6 — Compras Unificadas frontend | `968b2bf`                          | workflow global e pedidos operacionais separados                         |
| 7 — production readiness        | `chore: harden production baseline` | code splitting, cache preciso, documentação master e validação final    |

O hash do Batch 7 deve ser consultado no Git porque este documento integra o mesmo commit.

## 10. Convenções de implementação

- TypeScript strict, sem `any`, `@ts-ignore`, `eslint-disable` ou casts usados para ocultar contrato ausente.
- DTOs e schemas Zod próximos ao módulo responsável.
- Regras e cálculos pertencem ao backend.
- Query keys comerciais incluem `lojaId`; staging global usa namespace explicitamente global e RBAC próprio.
- Invalidações devem atingir somente overview, listas e detalhes afetados.
- `allowedActions` e `blockedReasons` governam ações contextuais; permissões locais não recriam transições.
- Um `QueryClient` por teste, retries desabilitados e nenhum HTTP real em testes web.
- Testes de API usam PostgreSQL exclusivo e fixtures autocontidas.
- Não remover ou condicionar assertions para fazer a suíte passar.
- Mudanças de performance exigem medição antes/depois.

## 11. Operação e validação

Versão oficial: Node.js 22 (`.nvmrc`). Em Homebrew:

```bash
export PATH="$(brew --prefix node@22)/bin:$PATH"
```

Validação completa:

```bash
npm ci
npm run db:generate
npx prisma validate --schema apps/api/prisma/schema.prisma
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

Produção exige secrets distintos, `WEB_ORIGIN` HTTPS explícito, PostgreSQL permanente, backups, migrations via `db:migrate:deploy` e health check após publicação. Seed administrativo é deliberado e não faz parte automática do deploy.

## 12. Roadmap controlado

Próximos módulos só podem iniciar em batches aprovados e independentes:

1. Financeiro operacional ampliado e conciliação;
2. Vendas e baixa patrimonial;
3. tracking automático;
4. integrações externas Amazon/eBay;
5. documentos, notificações e exportações adicionais.

Cada módulo deve preservar os contratos existentes, isolamento por loja, auditoria e migrations incrementais. Este roadmap não declara esses itens implementados nem autoriza iniciá-los automaticamente.

## 13. Riscos residuais conhecidos

- A API V1 não lista contas externas ou merchants; a UI aceita IDs conhecidos e não inventa opções.
- Contratos antigos de Relatórios ainda usam estruturas genéricas em alguns pontos; sua evolução exige batch próprio para não alterar respostas existentes.
- Existem casts legados em rotas e analytics da API; removê-los exige tipagem dos contratos afetados e testes específicos.
- A janela “quinta-feira de manhã” continua sem limites horários normativos e não deve gerar bloqueio horário inventado.
- Upgrades major de Prisma, Vite ou Vitest permanecem fora do escopo e exigem validação dedicada.

## 14. Baseline de continuidade

Ao iniciar uma nova tarefa:

1. ler `AGENTS.md` e este documento;
2. confirmar branch, HEAD, working tree e remoto;
3. localizar o contrato normativo do módulo;
4. validar baseline antes de editar;
5. implementar um batch por commit;
6. executar testes proporcionais ao risco;
7. não fazer deploy ou iniciar o próximo módulo sem autorização explícita.
