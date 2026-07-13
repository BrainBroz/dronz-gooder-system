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

A baseline técnica dos Batches 0–7 está concluída no commit `f413791`. Estão implementados e validados: autenticação cookie-only, Categorias, Produtos, Fornecedores, Pedidos Operacionais, Compras Unificadas, UI-3C, logística internacional, recebimento, entrada definitiva, estoque, financeiro manual, Dashboard e Relatórios. O Batch 8 adiciona uma fundação técnica comum de integrações, preservada para fontes futuras. O caso principal aprovado é `buyer purchase ingestion`: importar compras realizadas por Dronz e Gooder. A ingestão buyer do eBay é tecnicamente possível pela Trading API `GetMyeBayBuying`, sujeita à validação da aplicação, autorização da conta, limites e janela histórica; ela ainda não está implementada. Amazon buyer permanece sob investigação separada. Adapters seller Amazon/eBay ficam adiados; tracking automático, integrações PayPal/bancárias, e-mail operacional e QR Code permanecem futuros.

## Roadmap oficial

Executar em batches separados e nesta ordem:

1. Batch 8.2 — correção forense e contratual do eBay buyer;
2. Batch 9 — adapter eBay buyer, condicionado à confirmação da aplicação e das credenciais/permissões;
3. Batch 10 — investigação e contrato Amazon buyer;
4. Batch 11 — fontes complementares: e-mail autorizado, invoices e CSV;
5. Batch 12 — consolidação de envios, pacotes e trackings;
6. Batch 13 — motor automático de tracking independente;
7. Batch 14 — Financeiro e conciliação;
8. Batch 15 — Vendas e baixa patrimonial;
9. Batch 16 — Analytics avançado.

O adapter eBay buyer, a investigação Amazon buyer e as fontes complementares precedem o tracking automático porque podem fornecer compras, envios e códigos externos. Amazon e eBay são origens possíveis dos dados, não a arquitetura central do domínio. O tracking permanece independente da fonte: uma ordem pode existir sem tracking, o tracking pode surgir ou mudar posteriormente, um pedido pode possuir múltiplos envios, pacotes e códigos, e deve existir fallback manual auditável. Nunca presumir um único tracking por pedido nem acoplar a máquina de tracking diretamente ao marketplace, e-mail ou documento.

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
- Contratos normativos específicos preservam as regras do domínio; documentos iniciais ou de investigação devem ser marcados como históricos quando superados.
- Atualizações relevantes registram estado implementado, commit, riscos, limitações e roadmap sem duplicar contratos completos.
- Uma decisão planejada nunca deve ser descrita como implementada.
