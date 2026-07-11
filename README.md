# Dronz & Gooder System

Monorepo inicial do sistema operacional de compras, logística, estoque, remessas e financeiro internacional para Dronz e Gooder.

Status atual:

- fundação do monorepo criada;
- stack definida sem Next.js, Tailwind, Supabase ou Firebase;
- autenticação com refresh token exclusivamente em cookie HttpOnly;
- catálogo, compras, logística, recebimento, estoque, financeiro manual, dashboard e relatórios isolados por loja;
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

- Node.js LTS
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
- `npm run db:seed`

## Itens não implementados ainda

- tracking e integrações automáticas;
- PayPal, bancos e cartões como integrações (PAYPAL atual é classificação manual);
- e-mail e QR Code;
- exportações PDF e Excel.

## Produção

Consulte `docs/PRODUCTION_READINESS.md`. Defina origens e segredos reais fora do repositório, aplique migrations antes de iniciar a API e use HTTPS para que o cookie de refresh receba `Secure`.
