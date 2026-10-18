# Dronz & Gooder System

Monorepo do sistema operacional de compras, logística, estoque, remessas e financeiro internacional para Dronz e Gooder.

Status atual:

- baseline técnica dos Batches 0–7 consolidada no commit `f413791`;
- stack definida sem Next.js, Tailwind, Supabase ou Firebase;
- autenticação com refresh token exclusivamente em cookie HttpOnly;
- catálogo, Fornecedores e Pedidos Operacionais isolados por loja;
- Compras Unificadas com staging global controlada, atribuição quantitativa e materialização independente por loja;
- UI-3C, logística, recebimento, entrada definitiva, estoque, financeiro manual, Dashboard e Relatórios;
- posições operacionais, remessas, recebimento parcial e Home operacional;
- revisão humana de evidências multicanal, adapter eBay Buyer implementado (desabilitado até configuração segura) e painel mensal com CSV;
- contas/faturas e conciliação financeira manual, vendas por lote e indicadores com acesso financeiro controlado;
- migrations e testes de integração usam PostgreSQL real.

## Stack

- Frontend: React, Vite, TypeScript, Material UI, React Router, TanStack Query, React Hook Form, Zod, Zustand, Axios
- Backend: Node.js, Express, TypeScript, PostgreSQL, Prisma, JWT, refresh token, storage compatível com S3
- Monorepo: npm workspaces

## Estrutura

- `apps/web` — aplicação web
- `apps/api` — API HTTP
- `packages/domain` — tipos e contratos de domínio
- `packages/schemas` — schemas Zod compartilhados
- `packages/shared` — tipos comuns, constantes e utilitários
- `docs/` — documentação funcional e técnica
- `tasks/` — tarefas do Codex

## Colaboração e qualidade

O fluxo de implementação, revisão e aprovação está documentado em
[`docs/AGENT_COLLABORATION_PROTOCOL_V1.md`](docs/AGENT_COLLABORATION_PROTOCOL_V1.md).
Pull requests usam o template versionado e passam pelo Quality gate do GitHub
(PostgreSQL 16, lint, typecheck, build e testes). O modelo de handoff para
implementador e revisores está em
[`docs/handoffs/PR_HANDOFF_TEMPLATE.md`](docs/handoffs/PR_HANDOFF_TEMPLATE.md).

## Requisitos

- Node.js 22, conforme `.nvmrc`
- npm
- PostgreSQL local ou remoto

## Configuração

1. copie `.env.example` para `.env` em cada app quando necessário;
2. configure `DATABASE_URL`, secrets JWT e dados do seed admin;
3. rode `npm install` na raiz;
4. execute migrações e seed após a base de dados estar disponível.

## Comandos

- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:migrate:deploy`
- `npm run db:seed`

## Roadmap

O roadmap oficial e seus bloqueios estão em `docs/PROJECT_CONTEXT_MASTER.md`. Dronz e Gooder usam marketplaces como compradores. O pipeline multicanal preserva evidências e exige revisão/aprovação humana antes de atribuir e materializar. O score explicável X-03 prioriza a revisão sem autorizar operações. O adapter eBay Buyer implementa Trading API `GetOrders` com `OrderRole=Buyer`; a especificação sanitizada está em `docs/EBAY_BUYER_SPECIFICATION_V1.md`. Painel mensal/CSV, tracking manual, Financeiro, Vendas e Analytics estão implementados. Mailbox autorizada (B12), migração da planilha real e motor de tracking (B15) mantêm dependências específicas. A Amazon Business API permanece `PENDENTE_DE_ONBOARDING_EXTERNO` e será incorporada como evidência adicional, sem duplicar compras já existentes.

## Itens não implementados ainda

- ativação real do adapter eBay buyer depende de credenciais/configuração segura e homologação da conta;
- adapter Amazon Business buyer após onboarding externo;
- ingestão automática de mailbox autorizada (Batch 12) e migração da planilha histórica real;
- adapters seller Amazon/eBay, adiados até existir necessidade específica de importar vendas recebidas;
- tracking automático e integrações com transportadoras;
- PayPal, bancos e cartões como integrações (PAYPAL atual é classificação manual);
- e-mail e QR Code;
- exportações PDF e Excel.

Vendas com perdas/saídas antigas que não identificam lote ficam bloqueadas até reconciliação do saldo de origem. Recebimentos parciais são auditados individualmente; sua associação a transações-fonte do B16 permanece bloqueada até existir contrato de entrada financeira compatível. Tracking manual e códigos do marketplace não substituem o motor automático do Batch 15.

## Produção

Consulte `docs/PRODUCTION_READINESS.md`. Defina origens e segredos reais fora do repositório, aplique migrations antes de iniciar a API e use HTTPS para que o cookie de refresh receba `Secure`.
