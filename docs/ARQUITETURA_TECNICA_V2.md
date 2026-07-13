# Arquitetura Técnica V2

> **Status histórico:** visão inicial, preservada para rastreabilidade. Versões, arquitetura consolidada e convenções vigentes estão em `PROJECT_CONTEXT_MASTER.md` e `AGENTS.md`.

Monorepo com npm workspaces.

Componentes:

- `apps/web` para interface React/Vite;
- `apps/api` para Express/Prisma;
- `packages/domain` para contratos de domínio;
- `packages/schemas` para schemas Zod compartilhados;
- `packages/shared` para utilidades comuns.

Decisões:

- TypeScript strict;
- sem Next.js;
- sem Tailwind;
- sem Supabase;
- sem Firebase;
- PostgreSQL com Prisma;
- backend responsável por autorização.
