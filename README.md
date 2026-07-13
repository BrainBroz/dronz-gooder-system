# Dronz & Gooder System

Monorepo do sistema operacional de compras, logística, estoque, remessas e financeiro internacional para Dronz e Gooder.

Status atual:

- baseline técnica dos Batches 0–7 consolidada no commit `f413791`;
- stack definida sem Next.js, Tailwind, Supabase ou Firebase;
- autenticação com refresh token exclusivamente em cookie HttpOnly;
- catálogo, Fornecedores e Pedidos Operacionais isolados por loja;
- Compras Unificadas com staging global controlada, atribuição quantitativa e materialização independente por loja;
- UI-3C, logística, recebimento, entrada definitiva, estoque, financeiro manual, Dashboard e Relatórios;
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

O roadmap oficial está em `docs/PROJECT_CONTEXT_MASTER.md`. Dronz e Gooder usam marketplaces como compradores. A próxima sequência começa pela validação e implementação controlada do adapter eBay buyer baseado em `GetMyeBayBuying`; Amazon buyer permanece em investigação separada. Depois vêm fontes complementares de e-mail/invoices/CSV, consolidação de envios/pacotes, tracking automático independente, Financeiro, Vendas e Analytics. O contrato de tracking preserva ordens sem código, múltiplos envios/pacotes/códigos, atualizações posteriores e fallback manual auditável.

## Itens não implementados ainda

- adapter eBay buyer e ingestão automática de compras realizadas por contas buyer;
- investigação e contrato Amazon buyer;
- adapters seller Amazon/eBay, adiados até existir necessidade específica de importar vendas recebidas;
- tracking automático e integrações com transportadoras;
- PayPal, bancos e cartões como integrações (PAYPAL atual é classificação manual);
- e-mail e QR Code;
- exportações PDF e Excel.

## Produção

Consulte `docs/PRODUCTION_READINESS.md`. Defina origens e segredos reais fora do repositório, aplique migrations antes de iniciar a API e use HTTPS para que o cookie de refresh receba `Secure`.
