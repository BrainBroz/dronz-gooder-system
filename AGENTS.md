# AGENTS.md — Dronz & Gooder System

## Objetivo

Construir um sistema operacional para Dronz e Gooder com separação rigorosa entre lojas, estoques, movimentações auditáveis e base pronta para compras, logística, estoque, remessas, financeiro e integrações.

## Regras centrais

- Duas lojas iniciais: `dronz` e `gooder`.
- Toda entidade comercial preserva `lojaId`.
- Estoques nunca são misturados.
- Uma remessa pode transportar itens das duas lojas.
- Cada item mantém seu próprio `lojaId`.
- Autorização é aplicada no backend.
- Toda compra consolidada em USD.
- BRL serve para conversão e relatórios.
- Miami é apenas uma localização possível, não uma regra fixa.
- O sistema deve suportar locais fixos, endereços de viajantes, hotéis, escritórios, Paraguai, Brasil e novas localizações.
- Pacote externo usa tracking e código de barras da transportadora.
- Caixa/remessa interna usa código interno e QR Code.
- OCR é apenas fallback.
- Compra confirmada já integra o patrimônio.
- Disponibilidade física depende de localização e conferência.
- Nunca duplicar a mesma unidade em vários estoques.
- Toda movimentação deve ser auditável.
- Fórmula `calcSimulacao` é protegida e não deve ser alterada.
- Não adicionar bibliotecas fora da stack definida sem autorização.

## Stack oficial

- Frontend: React, Vite, TypeScript, Material UI, React Router, TanStack Query, React Hook Form, Zod, Zustand, Axios
- Backend: Node.js, Express, TypeScript, PostgreSQL, Prisma, JWT, refresh token, storage compatível com S3
- Monorepo: npm workspaces

## Escopo desta fundação

Implementar apenas a fundação do monorepo, a documentação inicial, os contratos base e as telas/rotas mínimas. Não implementar compras, produtos, tracking, estoque, remessas, viajantes, financeiro, e-mail, QR Code ou integrações além do necessário para autenticação e health check.

## Rotina

- manter TypeScript strict;
- preservar separação entre apps e packages;
- não introduzir Next.js, Tailwind, Nx, Turborepo, pnpm ou Yarn;
- não usar mocks como banco;
- manter backend como fonte de autorização;
- não alterar regras de negócio sem aprovação explícita.

