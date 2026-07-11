# Dronz & Gooder System

Monorepo inicial do sistema operacional de compras, logística, estoque, remessas e financeiro internacional para Dronz e Gooder.

Status atual:

- fundação do monorepo criada;
- stack definida sem Next.js, Tailwind, Supabase ou Firebase;
- API e web ainda estão em fase inicial;
- módulos de negócio futuros ainda não foram implementados.

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

## Itens não implementados ainda

- compras
- tracking
- estoque
- remessas
- viajantes
- financeiros
- integrações

