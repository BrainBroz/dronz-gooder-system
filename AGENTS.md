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

## Estado da fundação

A fundação do monorepo, a autenticação cookie-only, Categorias e Produtos estão implementados e validados. Compras, pedidos, fornecedores, tracking, estoque, remessas, viajantes, logística, financeiro, PayPal, e-mail, QR Code e dashboard ainda não foram implementados.

## Padrões arquiteturais vigentes

- A API é organizada por módulos com rotas, controllers, services e schemas Zod próximos ao domínio.
- Controllers tratam HTTP; services concentram regras e acessam o Prisma centralizado em `apps/api/src/lib/prisma.ts`.
- Rotas e controllers não acessam Prisma diretamente.
- Não criar repository genérico ou camadas vazias; repositories específicos só existem quando trouxerem valor real.
- TanStack Query é o padrão para server state no frontend, sempre com `lojaId` nas query keys de dados comerciais.
- Zustand permanece restrito à identidade autenticada, loja ativa e estado global legítimo de interface.

## Contratos normativos operacionais

`docs/domain-contracts.md`, aprovado em 2026-07-11, é a fonte normativa para Fornecedores, Pedidos de Compra, Logística Internacional, Recebimento, Estoque, Financeiro, Dashboard e Relatórios. Ele define campos mínimos, enums, transições, fórmulas, timezones, cancelamento, exclusão, isolamento e autorização.

- Valores monetários usam `Decimal`; datas são persistidas em UTC.
- O backend recalcula totais e valida todo vínculo de `lojaId`.
- Estoque real só nasce após chegada confirmada ao Brasil.
- Mala tem limite padrão de 23 kg; tara padrão é 0,5 kg por volume/caixa.
- Miami usa `America/New_York`; exibição no Brasil usa `America/Sao_Paulo`.
- Câmbio e pagamentos são manuais neste ciclo; PAYPAL não representa integração externa.
- Markup mínimo permanece 25%; venda zero é “A definir”.
- `calcSimulacao` permanece protegida.

## Rotina

- manter TypeScript strict;
- preservar separação entre apps e packages;
- não introduzir Next.js, Tailwind, Nx, Turborepo, pnpm ou Yarn;
- não usar mocks como banco;
- manter backend como fonte de autorização;
- não alterar regras de negócio sem aprovação explícita.
