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

O roadmap oficial está em `docs/PROJECT_CONTEXT_MASTER.md`. Dronz e Gooder usam marketplaces como compradores. O Batch 9 documenta um contrato multicanal: APIs buyer, e-mail autorizado, planilha e entrada manual produzem evidências imutáveis, eventos versionados e candidatos reconciliados antes da aprovação humana, atribuição e materialização. Um score explicável de confiança poderá priorizar a revisão, mas nunca aprovar ou operar automaticamente. O Gate eBay Buyer comprovou OAuth Production e Trading API `GetOrders` com `OrderRole=Buyer`, pedidos, itens e tracking reais; a especificação sanitizada está em `docs/EBAY_BUYER_SPECIFICATION_V1.md`. A sequência é pipeline comum de evidências, adapter eBay, e-mail autorizado Amazon/eBay, painel mensal com migração controlada da planilha, consolidação de remessas/pacotes e motor de tracking. A Amazon Business API permanece `PENDENTE_DE_ONBOARDING_EXTERNO` e será incorporada futuramente como evidência adicional, sem duplicar compras já criadas por e-mail.

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
