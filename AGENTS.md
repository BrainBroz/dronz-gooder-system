# AGENTS.md — Dronz & Gooder System

## Objetivo

Construir um sistema operacional para Dronz e Gooder com separação rigorosa entre lojas, estoques, movimentações auditáveis e base pronta para compras, logística, estoque, remessas, financeiro e integrações.

## Regras centrais

- Duas lojas iniciais: `dronz` e `gooder`.
- Toda entidade comercial operacional ou materializada preserva `lojaId`. A staging global de Compras Unificadas é a única exceção aprovada: não usa `lojaId` como tenant, exige RBAC global e cria dados tenantados somente por atribuição/materialização explícita.
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

A baseline técnica dos Batches 0–7 está concluída no commit `f413791`. Estão implementados e validados: autenticação cookie-only, Categorias, Produtos, Fornecedores, Pedidos Operacionais, Compras Unificadas, UI-3C, logística internacional, recebimento, entrada definitiva, estoque, financeiro manual, Dashboard e Relatórios. O Batch 8 adiciona uma fundação técnica comum de integrações, preservada para fontes futuras. O caso principal aprovado é `buyer purchase ingestion`: importar compras realizadas por Dronz e Gooder. O Batch 9 define o contrato multicanal de evidências, reconciliação, aprovação humana, atribuição por loja e visão mensal, sem implementar adapters. Amazon Business Reporting API e eBay `GetMyeBayBuying` são fontes buyer oficiais candidatas, sujeitas a onboarding, autorização e validação real. E-mail autorizado é evidência independente. Adapters seller ficam adiados; tracking automático, integrações PayPal/bancárias e QR Code permanecem futuros.

## Roadmap oficial

Executar em batches separados e nesta ordem:

1. Batch 9 — contrato de Buyer Purchase Ingestion, reconciliação, aprovação e visão mensal;
2. Batch 10 — Amazon Business Reporting API;
3. Batch 11 — eBay Buyer API;
4. Batch 12 — e-mail autorizado e reconciliação multicanal;
5. Batch 13 — migração da planilha e painel mensal;
6. Batch 14 — consolidação de envios, pacotes e trackings;
7. Batch 15 — motor automático de tracking independente;
8. Batch 16 — Financeiro e conciliação;
9. Batch 17 — Vendas e baixa patrimonial;
10. Batch 18 — Analytics avançado.

Amazon, eBay e e-mail precedem o tracking automático porque fornecem evidências de compras, envios e códigos externos. Nenhuma fonte é a arquitetura central do domínio. Toda compra detectada automaticamente exige reconciliação e aprovação humana antes da atribuição/materialização. O tracking permanece independente da fonte: uma ordem pode existir sem tracking, o tracking pode surgir ou mudar posteriormente, um pedido pode possuir múltiplos envios, pacotes e códigos, e deve existir fallback manual auditável. Nunca presumir um único tracking por pedido nem acoplar a máquina de tracking diretamente ao marketplace, e-mail ou documento.

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

## Documentação

- `docs/PROJECT_CONTEXT_MASTER.md` é o índice oficial de continuidade e deve refletir somente o que o código e os testes comprovam.
- `docs/BUYER_PURCHASE_INGESTION_CONTRACT_V1.md` é o contrato normativo para os Batches 10–13; decisões de produto nele marcadas como bloqueadoras não podem ser preenchidas por suposição.
- Contratos normativos específicos preservam as regras do domínio; documentos iniciais ou de investigação devem ser marcados como históricos quando superados.
- Atualizações relevantes registram estado implementado, commit, riscos, limitações e roadmap sem duplicar contratos completos.
- Uma decisão planejada nunca deve ser descrita como implementada.
