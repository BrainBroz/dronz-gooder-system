# Project Context Master — Dronz & Gooder System

## 1. Finalidade e autoridade

Este documento é o índice oficial de continuidade técnica do projeto. Ele consolida o estado implementado, as decisões permanentes, os contratos e o histórico dos batches sem substituir suas fontes normativas.

Em caso de conflito, prevalecem, nesta ordem:

1. `AGENTS.md`;
2. contratos normativos específicos, especialmente `domain-contracts.md` e `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md`;
3. schema Prisma e migrations aplicadas;
4. código e testes da baseline atual;
5. este documento como mapa de continuidade;
6. documentos históricos ou de planejamento.

## 2. Objetivo do sistema

### Estado funcional em 2026-10-18

A baseline `caa148c` da PR #4 foi ampliada pela linha `5617800` (Codex, integrada na PR #5). As PRs #6–#14 acrescentaram posições, remessas, recebimento parcial, Home operacional, revisão humana multicanal (B10), adapter eBay Buyer (B11), painel mensal/CSV (B13), tracking manual (B14) e Financeiro (B16). Vendas (B17, PR #15) e Analytics (B18, PR #16) completam esta rodada de implementação; os SHAs de merge devem ser consultados no histórico Git. Batch 12 e Batch 15 permanecem dependentes de mailbox/OAuth e APIs de transportadoras, respectivamente. O adapter eBay está implementado e desabilitado até configuração e homologação seguras.

As provas anteriores de compra/materialização, confirmação e alocação foram feitas com dados fictícios. A jornada até estoque possui teste integrado, mas eventos simulados não homologam mercadoria física real. O ambiente autorizado continua sendo somente local. Resultados, histórico das validações, alertas de dependências e limites de publicação estão em [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

Validação local B17/B18 em Node 22: 265 testes API e 230 web (495 no total, sem ignorados), Prisma validate/generate, lint, typecheck e builds aprovados. Migrations verificadas em instalação limpa (44) e upgrade de cópia restaurada da baseline B16; homologação de produção e de integrações reais permanece pendente.

O sistema coordena a operação internacional de Dronz e Gooder: compras, atribuição por loja, pedidos operacionais, logística, recebimento, entrada definitiva, estoque, custos e análise. A automação deve preservar revisão humana, rastreabilidade, auditoria e isolamento rigoroso por loja.

As lojas iniciais são `dronz` e `gooder`. Uma remessa física pode transportar itens das duas lojas, mas cada item conserva seu próprio `lojaId`; patrimônio, estoque, autorização e operação não são misturados.

## 3. Arquitetura atual

Monorepo npm workspaces:

- `apps/web`: React 19, Vite 6, TypeScript strict, Material UI 7, React Router 7, TanStack Query 5, React Hook Form, Zod, Zustand e Axios;
- `apps/api`: Node.js 22, Express, TypeScript strict, Prisma 6.19.3 e PostgreSQL;
- `packages/domain`: tipos e contratos elementares de domínio;
- `packages/schemas`: schemas compartilháveis;
- `packages/shared`: constantes e utilitários comuns;
- `docs`: contratos, arquitetura e continuidade;
- `tasks`: especificações históricas de execução.

O frontend é cliente fino. A API valida autenticação, RBAC, `lojaId`, transições, idempotência e regras de negócio. Serviços acessam o Prisma centralizado; rotas e controllers não acessam o banco diretamente.

Páginas web são carregadas por rota com `React.lazy` e `Suspense`. Dependências estáveis são separadas em chunks de React, Material UI, formulários e server state para cache e carregamento previsíveis.

Fluxo de dependência consolidado:

```text
web → API HTTP → routes/controllers → services → Prisma → PostgreSQL
```

O frontend não reconstrói RBAC, transições, elegibilidade, cálculo financeiro, estoque ou tracking. A staging global é um contexto autorizado próprio; após atribuição/materialização, toda operação volta ao tenant obrigatório por `lojaId`.

## 4. Persistência e segurança

- PostgreSQL é a persistência operacional.
- Prisma CLI e Client permanecem alinhados em `6.19.3`.
- Migrations são incrementais e migrations aplicadas não são reescritas.
- JWT de acesso permanece em memória no frontend.
- Refresh token existe exclusivamente em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e não integra bodies ou storage web.
- CORS usa origem explícita e credenciais.
- Senhas e refresh tokens são persistidos somente em representação segura.
- `AuditLog` é o mecanismo único de auditoria; não criar sistema paralelo.
- Mutações críticas usam idempotência persistente e transações.
- Falha de auditoria em mutação crítica provoca rollback; eventos confirmados não são editados ou apagados silenciosamente.
- Chaves idempotentes são persistidas e vinculadas à operação e ao payload normalizado; replay divergente é conflito.
- Migrations são aditivas, versionadas, testadas em banco limpo e baseline compatível; migrations aplicadas nunca são reescritas.

## 5. Regras permanentes

- Toda entidade comercial materializada preserva `lojaId`.
- O backend é a autoridade final de acesso; `x-store-id` nunca é aceito sem validar a identidade.
- Estoques de Dronz e Gooder nunca são combinados.
- Compra consolidada usa USD; BRL serve para conversão e relatórios.
- Estoque real só nasce após chegada ao Brasil, conferência e entrada definitiva.
- A mesma unidade não pode ocupar simultaneamente mais de uma localização ou saldo.
- Toda movimentação deve ser auditável.
- Mala usa limite padrão de 23 kg e volume/caixa usa tara padrão de 0,5 kg.
- Markup mínimo permanece 25%; preço de venda zero é exibido como “A definir”.
- `calcSimulacao` é protegida.
- Datas são persistidas em UTC; Miami usa `America/New_York` e apresentação brasileira usa `America/Sao_Paulo`.
- Não introduzir Next.js, Tailwind, Supabase, Firebase, Nx, Turborepo, pnpm ou Yarn.
- Não adicionar dependências, providers ou integrações sem autorização.

## 6. Contratos normativos

- `domain-contracts.md`: Fornecedores, Pedidos Operacionais, Logística, Recebimento, Estoque, Financeiro manual, Dashboard e Relatórios.
- `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md`: staging global, identidade externa, atribuição quantitativa, materialização por loja e checkpoints.
- `COMPRAS_UNIFICADAS_BACKEND_V1.md`: implementação persistente e HTTP da staging.
- `COMPRAS_UNIFICADAS_FRONTEND_V1.md`: consumo fino dos read models e mutações da staging.
- `UI3C_BACKEND_V1.md`: read models, RBAC, auditoria e correções dos checkpoints.
- `UI3C_FRONTEND_V1.md`: interfaces operacionais governadas por `allowedActions`.
- `MARKETPLACE_INTEGRATION_FOUNDATION_V1.md`: fundação comum de providers, conexões, sincronização e normalização, com eBay priorizado e Amazon por e-mail como fonte inicial.
- `EBAY_BUYER_INVESTIGATION_V1.md`: investigação histórica anterior ao onboarding; superada pela comprovação operacional do gate.
- `EBAY_BUYER_SPECIFICATION_V1.md`: especificação oficial comprovada para OAuth e Trading API `GetOrders` buyer, campos, paginação, tracking, quota e segurança.
- `BUYER_PURCHASE_INGESTION_CONTRACT_V1.md`: evidências multicanal, reconciliação, aprovação humana, atribuição e visão mensal.
- `UX_OPERATIONAL_FOUNDATION_V1.md`: contrato aprovado para a futura reconstrução incremental da experiência, com navegação por jornada, três projeções ortogonais, camada econômica, decisões F-1 a F-12, gaps e roadmap FIX-0/UX-0 a UX-9.
- `AMAZON_BUSINESS_ONBOARDING_GATE_V1.md`: Gate 9.1, papéis/capabilities oficiais, checklist do responsável e comprovação pendente da conta real.
- `AMAZON_BUSINESS_ONBOARDING_RUNBOOK_V1.md`: Gate 9.2, pacote operacional preenchível para Marco executar onboarding, consentimento e prova sanitizada.
- `PRODUCTION_READINESS.md`: requisitos de ambiente, publicação e riscos operacionais.

## 7. Fluxo operacional implementado

```text
Conta externa / compra manual
  → CompraImportada global
  → revisão e identificação dos itens
  → mapping de merchant para fornecedor por loja
  → mapping de item para produto por loja
  → atribuição quantitativa Dronz / Gooder / saldo pendente
  → materialização idempotente por loja
  → PedidoCompra + PedidoCompraItem operacionais
  → confirmação Miami
  → checkpoint Paraguai quando aplicável à rota
  → checkpoint Brasil
  → recebimento e conferência
  → entrada definitiva
  → estoque real e movimentos auditáveis
  → custos, financeiro manual, dashboard e relatórios
```

Pedido externo, item externo e pedido operacional são entidades distintas. Materializar uma loja não aguarda a outra e retry não duplica pedidos ou quantidades.

## 8. Estado funcional atual

Implementado e coberto por testes:

- autenticação JWT com refresh cookie-only, rotação e revogação;
- usuários, perfis, permissões e vínculos de loja;
- Categorias, Produtos e Fornecedores isolados por loja;
- Pedidos Operacionais por loja;
- staging global de Compras Unificadas;
- contas e merchants externos como registros de domínio sem credenciais;
- mappings, atribuição quantitativa, conflitos e materialização independente por loja;
- logística, viajantes, viagens e malas;
- confirmações Miami, Paraguai e Brasil;
- recebimento, divergências, correções auditáveis e entrada definitiva;
- estoque e movimentações;
- financeiro manual, Dashboard e Relatórios existentes;
- testes de integração PostgreSQL e testes comportamentais web.
- posições operacionais, responsabilidade contextual, remessas e recebimento parcial;
- reconciliação humana multicanal, adapter eBay configurável e painel mensal/CSV;
- tracking manual, contas/faturas e conciliação financeira manual;
- vendas com baixa por lote/custo em snapshot e indicadores derivados com controle financeiro.

Não implementado:

- ativação real do adapter buyer e homologação da conexão eBay;
- ingestão automática de mailbox (B12), dependente de OAuth, caixa dedicada e retenção;
- adapters seller Amazon/eBay, adiados até existir necessidade específica;
- tracking automático;
- integrações PayPal, bancárias ou de cartão;
- OCR operacional e QR Code;
- documentos e anexos;
- exportações PDF e Excel.

## 9. Histórico e gates oficiais

| Batch                           | Commits              | Resultado                                                                | Gate final   |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------ | ------------ |
| 0 — higiene da baseline         | `4ac6336`            | Node, Prisma, lockfile, ambiente e segredos normalizados                 | APROVADO     |
| 1 — testes                      | `2d4b0cb`            | suítes API/web estabilizadas e infraestrutura jsdom criada               | APROVADO     |
| 2 — contrato normativo          | `3fbcc99`, `0ce36f6` | Compras Unificadas e checkpoints definidos; decisões de produto fechadas | APROVADO     |
| 3 — UI-3C backend               | `6367fb3`, `79f5247` | read models, RBAC, auditoria, idempotência e correções                   | APROVADO     |
| 4 — UI-3C frontend              | `fe658c8`, `cf3a880` | interfaces operacionais e alinhamento estrito a `allowedActions`         | APROVADO     |
| 5 — Compras Unificadas backend  | `e9a9d9b`            | staging, mappings, atribuição, conflitos e materialização                | APROVADO     |
| 6 — Compras Unificadas frontend | `968b2bf`            | workflow global e pedidos operacionais separados                         | APROVADO     |
| 7 — production readiness        | `f413791`            | code splitting, cache preciso, documentação master e validação final     | APROVADO     |
| 8 — fundação de integrações     | `8644188`            | adapters comuns, conexões, sincronização explícita e logística externa   | APROVADO     |
| 8.1 — buyer versus seller       | `9790de0`            | corrige contexto de produto e roadmap sem alterar a fundação técnica     | SUPERADO EM PARTE |
| 8.2 — correção eBay buyer       | `1e4dec9`            | confirma `GetMyeBayBuying`, corrige investigação e roadmap               | APROVADO     |
| 9 — contrato buyer multicanal   | `01224db`            | define evidências, reconciliação, aprovação, atribuição e visão mensal   | BLOQUEADO POR DECISÕES |
| 9 — complemento Amazon Business | `09062fa`            | registra conta, backfill, capabilities, aprovação e atribuição           | APROVADO DOCUMENTALMENTE |
| 9 — onboarding Amazon Business  | `bf91487`, `79e9ec4` | documenta gate e runbook; acesso externo continua pendente                | `PENDENTE_DE_ONBOARDING_EXTERNO` |
| 9 — redirecionamento operacional | `afff787`           | prioriza eBay Buyer e Amazon por e-mail sem iniciar adapters              | APROVADO PARA GATE EBAY |
| Gate eBay Buyer                  | este commit         | comprova OAuth Production, `GetOrders` buyer, tracking, paginação e quota | PRONTO PARA ADAPTER APÓS BATCH 10 |

As auditorias independentes dos Batches 7 e 8 foram aprovadas. A baseline funcional histórica do Batch 8 é `8644188`; `caa148c` registra a integração da PR #4, depois ampliada conforme a seção 2. Os Batches 8.1, 8.2 e 9 alteram somente documentação e não modificam comportamento. O Batch 8.2 supera apenas a conclusão incorreta de que não havia fonte oficial para compras buyer do eBay. O Batch 9 supera o roadmap provider-first e define primeiro o contrato multicanal comum.

## 10. Convenções de implementação

- TypeScript strict, sem `any`, `@ts-ignore`, `eslint-disable` ou casts usados para ocultar contrato ausente.
- DTOs e schemas Zod próximos ao módulo responsável.
- Regras e cálculos pertencem ao backend.
- Query keys comerciais incluem `lojaId`; staging global usa namespace explicitamente global e RBAC próprio.
- Invalidações devem atingir somente overview, listas e detalhes afetados.
- `allowedActions` e `blockedReasons` governam ações contextuais; permissões locais não recriam transições.
- Um `QueryClient` por teste, retries desabilitados e nenhum HTTP real em testes web.
- Testes de API usam PostgreSQL exclusivo e fixtures autocontidas.
- Não remover ou condicionar assertions para fazer a suíte passar.
- Testes não usam registros incidentais, ordem de execução, guards silenciosos, `skip` ou sleeps para mascarar falhas.
- Baseline do Batch 8 aprovada: 126 testes de API e 78 web, total de 204, sem ignorados. Os Batches 8.1, 8.2 e 9 são exclusivamente documentais e não alteram essa contagem.
- Mudanças de performance exigem medição antes/depois.

## 11. Operação e validação

Versão oficial: Node.js 22 (`.nvmrc`). Em Homebrew:

```bash
export PATH="$(brew --prefix node@22)/bin:$PATH"
```

Validação completa:

```bash
npm ci
npm run db:generate
npx prisma validate --schema apps/api/prisma/schema.prisma
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

Produção exige secrets distintos, `WEB_ORIGIN` HTTPS explícito, PostgreSQL permanente, backups, migrations via `db:migrate:deploy` e health check após publicação. Seed administrativo é deliberado e não faz parte automática do deploy.

## 12. Roadmap controlado

Sequência aprovada e estado atual; dependências externas não autorizam atalhos de domínio:

1. Gate eBay Buyer — concluído; OAuth, `GetOrders`, conta autorizada, campos, tracking, paginação do recorte e quota comprovados;
2. Batch 10 — implementado: evidências, conciliação e aprovação humana;
3. Batch 11 — adapter eBay Buyer implementado; ativação depende de secrets e homologação;
4. Batch 12 — mailbox Amazon/eBay bloqueada por OAuth, caixa e retenção; entrada controlada de evidências já existe;
5. Batch 13 — painel mensal e CSV implementados; migração histórica aguarda a planilha real;
6. Batch 14 — remessas, pacotes e tracking manual implementados;
7. Batch 15 — motor de tracking e alertas bloqueado por APIs/credenciais de transportadoras;
8. Batches 16–18 — Financeiro, Vendas e Analytics implementados, com integração de Vendas/Analytics pelas PRs #15/#16;
9. Amazon Business API — retomada em batch próprio após aprovação do onboarding externo.

Cada módulo deve preservar os contratos existentes, isolamento por loja, auditoria e migrations incrementais. Este roadmap não declara esses itens implementados nem autoriza iniciá-los automaticamente.

### 12.1 Fundação operacional de UX

`UX_OPERATIONAL_FOUNDATION_V1.md` é o contrato normativo para uma trilha incremental de reconstrução da interface. Seu registro não altera o roadmap de Buyer Purchase Ingestion nem autoriza implementação automática.

Ordem aprovada da trilha:

1. `FIX-0` — corrigir somente defeitos comprovados em alocação versus disponibilidade, uso de `valor`/`valorMercado` e recuperação global de sessão, sempre com testes de regressão;
2. `UX-0` — inventário, decisões visuais, acessibilidade, navegação, ícones, bundle, screenshots e baseline de testes;
3. Compras e Home — fila, detalhe, mapping, atribuição, materialização e Home acionável em duas ondas;
4. Base Miami — recebimento, conferência e posição operacional após os contratos necessários;
5. Envios e Logística — posições, volumes, preparação, transporte e timeline;
6. Paraguai e Brasil — conferências e transições dependentes da rota;
7. Estoque — entrada definitiva, posição patrimonial, disponibilidade e futura reserva persistente;
8. demais áreas — Financeiro, Relatórios, Produtos e Administração.

A Home operacional consome o read model `BE-HOME` implementado no Batch D, com contadores autorizados e instante de referência. A interface não combina caches para reconstruir saldos ou regras entre domínios. A experiência usa três projeções independentes — comercial/staging, física/logística/patrimonial e econômica — e nenhuma movimenta automaticamente outra.

A logística-alvo reconhece Miami como base operacional permanente com responsável próprio e posições operacionais temporárias vinculadas a viagem ou operação, encerradas por sugestão automática com confirmação manual e preservadas no histórico. O papel do viajante é contextual: partindo de Miami, retira a mala pronta e transporta; fora de Miami, pode assumir temporariamente recebimento, conferência e preparação somente na própria posição. Base como entidade, posições temporárias, autorização contextual e vínculo `Viajante`–`Usuario` permanecem gaps de backend.

Decisões aprovadas incluem rateio proporcional ao valor líquido com `ROUND_HALF_UP`, reembolso pré-materialização fora da quantidade elegível, compensação auditável pós-materialização, câmbio manual V1, bloqueio da mala acima de 23 kg, reserva persistente como regra-alvo, RBAC econômico no backend e o termo `CAPITAL COMPROMETIDO NO CICLO OPERACIONAL` antes da entrada definitiva.

Continuam abertas e bloqueiam somente seus batches: vigência de cotação (`E-2`), visibilidade de cancelados/reembolsados (`E-3`), competência de encargos tardios (`E-4`), aprovador de perda/ajuste/compensação (`E-5`), nomes de novas entidades físicas, solução definitiva de fornecedor e política de anexos.

### 12.2 Buyer purchase ingestion e tracking

- Dronz e Gooder utilizam Amazon, eBay e outros marketplaces como compradores. O fluxo principal importa compras realizadas, não vendas recebidas por contas seller.
- O contrato buyer é independente da fonte; Amazon Business, eBay, e-mail, invoice, CSV e entrada manual são origens possíveis e preservadas como evidências.
- A Amazon Business Reporting API `2025-06-09` é uma fonte buyer empresarial oficial com pedidos, itens e remessas; não deve ser confundida com SP-API seller. Seu estado é `PENDENTE_DE_ONBOARDING_EXTERNO`, não cancelado, e sua ativação depende de onboarding e papéis concedidos pela Amazon Business.
- Enquanto o onboarding Amazon estiver pendente, e-mails autorizados de confirmação, atualização, cancelamento, reembolso, remessa, tracking e invoice serão a fonte inicial Amazon. Nenhum e-mail cria operação automaticamente.
- A primeira integração estruturada validada é eBay Buyer. O gate comprovou OAuth Production e Trading API `GetOrders` com `OrderRole=Buyer`; o adapter foi implementado no B11 e sua ativação real depende de configuração segura e homologação da conta.
- A futura Amazon Business API deverá reconciliar por `(provider, externalAccountId, normalizedExternalOrderId)` com compras já sustentadas por e-mail, adicionando evidência sem duplicar ou apagar o histórico.
- A V1 Amazon usa uma conta Amazon Business `SHARED`, Amazon.com/EUA e USD, mantendo arquitetura multi-conta. Marco é o responsável administrativo pela conexão.
- O backfill inicial Amazon é configurável e começa em 15 dias; toda compra histórica entra em staging/revisão e nunca cria operação, estoque ou logística automaticamente.
- Sincronização manual autorizada é obrigatória; a automática é configurável, inicialmente recomendada a cada quatro horas.
- Capabilities desejadas são ativadas progressivamente: pedidos, itens, remessas, itens de remessa, Package Tracking, documentos e reconciliação. Ausência de uma capability não é simulada nem bloqueia as autorizadas.
- Anselmo, Brunno e Marco podem receber permissões por perfil/vínculo para revisão e aprovação; nomes não integram regras hardcoded. A decisão de atribuição e a configuração como compradores internos permanecem abertas.
- eBay buyer purchase ingestion foi comprovada em Production por `GetOrders` com `OrderRole=Buyer`. O recorte real de 30 dias retornou pedidos, linhas, cancelamentos, refunds e tracking, inclusive múltiplos códigos por pedido. `GetMyeBayBuying` permanece auxiliar e não é a chamada principal escolhida.
- Gmail e Outlook são evidências independentes, com OAuth, escopo mínimo, leitura seletiva, retenção e privacidade definidos antes da implementação.
- Toda detecção automática exige reconciliação e aprovação humana antes de atribuição ou materialização.
- O fluxo normativo é fonte → evidência imutável → normalização → reconciliação → candidato → aprovação humana → `CompraImportada` → atribuição → materialização explícita.
- A identidade forte usa provider, conta externa e Order ID normalizado. Correlação heurística não consolida compras sem decisão humana.
- Alterações externas são `EventoCompraExterna`; a visão corrente é `ProjecaoCompraExterna` reconstruível. Esse recorte não cria event sourcing genérico.
- `ConfiancaConciliacao` é score explicável e versionado de 0 a 100, classificado como alta, média ou baixa. Serve para priorização e apresentação; nunca aprova, atribui, resolve conflito ou materializa.
- `dataPedidoExterno` define a competência mensal principal; outras datas permanecem dimensões distintas.
- O tracking automático vem depois das fontes de ingestão e da consolidação de envios/pacotes.
- O motor de tracking é independente do marketplace, e-mail ou documento.
- Uma ordem pode existir sem tracking e continuar válida na staging.
- Tracking pode surgir ou ser atualizado em sincronização posterior.
- Um pedido pode possuir múltiplos envios, cada envio múltiplos pacotes e cada pacote um ou mais códigos ao longo do histórico.
- Troca, correção ou inclusão posterior de código não apaga eventos anteriores.
- O fluxo deve aceitar fallback manual auditável para compras manuais, providers sem suporte ou indisponibilidade da integração.
- Nenhuma dessas decisões declara as integrações ou o tracking implementados na baseline atual.
- O painel mensal é prioridade operacional do Batch 13, depois da ingestão multicanal, e usa read model derivado dos registros aprovados; não possui base paralela própria.
- A planilha histórica só será aposentada após importação, reconciliação, comparação de totais, operação paralela e aceite operacional.

## 13. Riscos residuais conhecidos

- A reconstrução de UX está parcialmente implementada: `FIX-0`, `UX-0` e a fila de Compras (`UX-1B` a `UX-1E`) estão no `main`; Base Miami, Envios, Paraguai/Brasil, Estoque e demais áreas (`UX-4` a `UX-9`) seguem contratadas e exigem autorização por batch.
- `FIX-1`/`FIX-2` (branch `claude/integrity-rbac`): movimentação de estoque, pagamentos, estornos, câmbio e custos passaram a usar `idempotentMutation` com bloqueio de linha e auditoria; pagamento em moeda diferente da do pedido é rejeitado; os módulos operacionais legados exigem capacidades próprias (seção de autorização de `domain-contracts.md`). Logística, recebimento e busca por número omitem valores de item e produto (F-10); demais read models com valores exigem capacidade financeira, de pedidos ou de estoque. A cotação registra fonte e margem informadas (F-5/X-08), sem acréscimo default.
- Batch B (UX-4, branch `claude/batch-b-positions`): `Local`, `PosicaoOperacional` (Base Miami permanente criada pela migration; histórico ligado a ela), `ResponsabilidadeContextual` (D-8/D-9/D-12), destino do pedido (D-15), recebimento só no destino e em posição ativa (D-16), encerramento manual sem pendências (D-10), reabertura de mala com motivo antes da saída (D-14), reserva persistente com responsável consumida no fechamento (F-8) e disponibilidade por posição × item × loja (DEC-DOM-007). Destino por pacote individual depende da consolidação de pacotes (Batch 14). Tela `/posicoes`.
- Batch C (UX-5, branch `claude/batch-c-shipments`): viagem com modalidade `MALA_VIAJANTE` ou `CAIXA_AEREA` (transportadora), volume com tipo `MALA`/`CAIXA` — mala mantém 23 kg, caixa só tem limite se informado; entrega do volume (`CHECKED_IN`) registra handoff com quem entregou, quem recebeu e instante, e caixa exige referência do recibo (D-13); `GrupoFisico` reúne as partes Dronz/Gooder de um mesmo volume físico com limite de peso sobre o total, composição exige acesso às duas lojas e a parte alheia aparece restrita (D-11). Anexos de evidência dependem de D-6.
- Batch D (UX-6/UX-7, branch `claude/batch-d-receiving-home`): quantidade rejeitada passa a ser parte da recebida em toda a API (antes a conferência as tratava como disjuntas e a entrada as subtraía, impedindo a entrada de unidades boas); entrada definitiva parcial das unidades aptas com o restante pendente, sobra/item incorreto/divergência genérica bloqueando só o próprio item, entradas sucessivas acumuladas na entrada ativa da mala (X-07, DEC-DOM-003); condição do item no recebimento em dimensões separadas, com registro em nome de terceiro restrito (D-4); compensação patrimonial proposta e aplicada só com aval de outro usuário (`CORRECAO_PATRIMONIAL_APROVAR`, D-17/X-06); Home `/` calculada no backend por permissão, com instante de referência e definição de cada contador (F-6/F-12).
- Batch 11 (branch `claude/batch-11-ebay-adapter`): `EbayBuyerAdapter` sobre Trading API `GetOrders` buyer com OAuth refresh, cursor incremental por janelas de modificação com sobreposição, parser XML seguro e tradução de erros; desligado por padrão (`MARKETPLACE_EBAY_BUYER_ENABLED`). Ativação real depende da credencial em secret manager (seção 19 de `EBAY_BUYER_SPECIFICATION_V1.md`).
- Batch 13 (branch `claude/batch-13-monthly-panel`): `GET /imported-purchases/monthly` e `/monthly.csv` derivados das compras importadas (competência `dataPedido` em America/Sao_Paulo, X-13); por moeda: bruto, cancelado, reembolsado, líquido, valor e unidades por loja (preço × quantidade atribuída), pendente de loja, materializado e "não rateado" (total externo − linhas); candidatos não aprovados e compras sem data ficam fora dos totais e aparecem à parte; CSV com colunas estáveis e neutralização de fórmula. Tela `/compras/painel-mensal`. A migração da planilha histórica (MIG-01) aguarda a planilha real para mapear colunas e fórmulas.
- Batch 14 (branch `claude/batch-14-tracking`): tracking manual auditável por pedido operacional (`POST /purchase-orders/:id/trackings`), correção que inativa o código anterior e o liga ao novo, busca por código completo ou últimos dígitos restrita à loja ativa (`GET /purchase-orders/tracking/lookup`, leitura de etiqueta em `/posicoes`) e códigos esperados na disponibilidade da posição. Tracking nunca confirma recebimento, checkpoint ou estoque. Batch 15 (motor de eventos de transportadora e alertas de entrega) depende de integração com APIs de transportadoras e credenciais próprias; até lá, valem o tracking do marketplace e o manual.
- Batch 16 (branch `claude/batch-16-finance`): obrigação do pedido com estado agregado PENDING/PARTIAL/PAID/REFUNDED/CANCELLED (`GET /finance/orders/:id/obligation`); reembolso não reabre dívida e só marca REFUNDED no estorno integral. Contas financeiras (cartão = conta CARTAO só com últimos 4 dígitos), faturas por período com regra de dia inexistente (último dia do mês), lançamentos/parcelas limitados ao pagamento CREDIT_CARD de origem, fechamento e pagamento parcial de fatura (excedente rejeitado). Transações-fonte manuais versionadas por hash (replay idempotente, conteúdo novo gera versão), conciliação sempre humana com sugestão por moeda/valor/±3 dias, bloqueio de moeda/valor divergente e de pagamento já conciliado. Despesas com impacto e origem vinculada única (compra/pagamento/fatura não viram despesa de resultado). Capacidades FINANCEIRO_REEMBOLSAR, _CONCILIAR, _DESPESAS e _FATURAS. Integração PayPal continua NOT_CONFIGURED; parâmetros X-08 com vigência ficam para B17 (taxas de venda).
- Batch 17 (branch `claude/batch-17-sales`): `Venda`/`VendaItem`/`BaixaVenda`/`RecebivelVenda`. Rascunho não move estoque; confirmação trava os saldos por produto, exige lotes explícitos que cubram cada item (sugestão FIFO por entrada e ID em `GET /sales/:id/lot-suggestion`), baixa só o disponível Brasil (físico − reservado), cria EXIT/SALE, snapshot do custo do lote (X-10-LOTE-v1: custo rateado ou preço do item de compra, convertido pelo câmbio do custo do pedido quando a moeda difere) e auditoria na mesma transação. Lucro/margem só com custo conhecido na moeda da venda e só para quem tem FINANCEIRO_VISUALIZAR, inclusive na confirmação e no replay. Taxa, NF e frete são valores informados (sem percentual presumido, X-08). Recebimentos parciais preservam antes/depois e data efetiva de cada parcela no AuditLog. Criar venda e registrar recebimento exigem `idempotency-key`; a UI mantém chave, payload e data depois de falha de rede. Fontes do B16 não possuem natureza de recebimento de venda: sua associação permanece explicitamente bloqueada (`sale_receipt_source_not_supported`) até contrato compatível. Saída genérica de estoque com motivo SALE passa a ser recusada. ENTRY guarda `pedidoCompraItemId` (backfill quando inequívoco). Se o saldo dos lotes não fechar com o físico após perdas/saídas/ajustes, sugestão e confirmação são bloqueadas (`stock_lots_require_reconciliation`), sem presumir custo de origem. A sugestão também desconta as reservas. Reconciliação de lotes legados, devolução física/correção de venda confirmada (VENDA_CORRIGIR, DEVOLUCAO_CONFERIR) e integração seller ficam para contrato próprio.
- Batch 18 (branch `claude/batch-18-analytics`): read models derivados (sem ledger paralelo) em `GET /analytics/indicators` e `/indicators.csv` (ANALYTICS_EXPORTAR), versão `B18-v1` com definições (código, fonte, fórmula), parâmetros e instante de corte: COMPRAS_PEDIDOS, COMPRAS_VALOR, LEAD_TIME_COMPRA_ENTRADA, ESTOQUE_BR, VENDAS_POR_CANAL, MARGEM_REALIZADA (só vendas com custo conhecido; as demais contadas à parte), FLUXO_FINANCEIRO. Cada recebimento é obtido do AuditLog, pela diferença antes/depois e pela data efetiva da parcela. Indicador sem dados retorna SEM_AMOSTRA. Dashboard separa totais por moeda; valores, preços e custos exigem FINANCEIRO_VISUALIZAR, inclusive nos objetos aninhados dos relatórios de estoque/movimentos. Datas de calendário dos indicadores são interpretadas em America/Sao_Paulo; timestamps explícitos preservam o instante. Markup converte o custo pelo câmbio registrado antes de comparar com o preço BRL. PDF e metas dependem de aprovação específica.
- `DECISOES_PRODUTO_2026-10-17.md` registra a aprovação das propostas D-1…D-17 e X-01…X-15 (exceto X-02 e DEC-DOM-001, superadas por F-2/F-1) e a ordem logística primeiro.
- A Home usa o read model implementado `BE-HOME`; cada contador declara domínio, definição e instante de referência. Homologação operacional real continua necessária.
- Identidade física unitária, compensação pós-materialização, anexos de evidência (D-6) e destino por pacote individual são gaps de backend ou schema, não capacidades atuais.
- As três projeções do contrato de UX não podem ser colapsadas no frontend. Materialização comercial não prova localização física e reembolso econômico não move mercadoria automaticamente.

- A API lista contas externas autorizadas em `/imported-purchases/accounts`; merchants são identificados pelos read models e criação contextual, sem inventar opções.
- A fundação técnica do Batch 8 foi ampliada pelo adapter eBay Buyer do B11. Amazon SP-API e eBay Sell Fulfillment continuam seller-side; o adapter Amazon Business permanece dependente de onboarding próprio.
- O sistema legado citado pelo Product Owner não está disponível nos repositórios acessíveis. Isso deixou de bloquear o eBay: keyset, OAuth, refresh, chamada `GetOrders`, schema version, quota e tracking foram comprovados diretamente no gate. Permanecem abertas frequência operacional, sobreposição, secret manager de produção e validação de paginação real com mais de uma página.
- Para a futura retomada da Amazon Business API, permanecem externos/abertos: onboarding, papel Amazon Business Analytics, papéis de Package Tracking/Document/Reconciliation, IDs e campos reais, rate limits, referência segura de secrets, tolerância monetária e escopo final de atribuição dos operadores. Esses itens não bloqueiam eBay, e-mail, conciliação ou painel mensal.
- O Gate 9.1 confirmou apenas capacidades documentadas: o onboarding Amazon Business não foi iniciado, nenhum papel ou credential foi comprovado e nenhuma chamada real foi executada. `ORDERS` e `ORDER_ITEMS` são o núcleo mínimo; remessas, tracking, documentos, reconciliação e User Management são progressivos e não bloqueiam esse núcleo quando indisponíveis.
- O Gate 9.2 fornece o runbook operacional e permanece válido para a futura retomada Amazon. Somente o adapter Amazon fica bloqueado até Analytics, LWA, consentimento, secret manager e acesso produtivo sanitizado a pedidos e itens.
- Para ativação das fontes permanecem necessárias configuração segura da conexão eBay, caixas/OAuth/retenção de e-mail e a planilha histórica real. Score X-03, tolerância X-01 e calendário X-13 já foram decididos; não reabri-los como bloqueios. Fechamento mensal oficial exige contrato próprio caso seja solicitado.
- Na continuação local do Batch 10, a sincronização registra evidências versionadas e candidatos sem importar a compra. Aprovação/rejeição humana versionada, auditada e idempotente foi implementada; nova evidência após aprovação mantém a compra intacta e marca o candidato com divergência. Conflitos de evidência são persistidos por tipo, com referência às versões comparadas e consulta paginada/auditada; vínculos conflitantes legados são preservados sem inferir resolução. Compras importadas com a mesma identidade são vinculadas ao candidato sem aprovação retroativa e não podem ser atribuídas nem materializadas enquanto a revisão estiver pendente. Falha de evidência mantém o cursor no início da página para replay seguro. Concluído depois (branch `claude/batch-10-reconciliation`): resolução humana de divergência por par de evidências (`ACEITAR_EVIDENCIA`/`MANTER_REFERENCIA`, ou `CIENTE` em compra já aprovada) com motivo auditado (X-01); confiança X-03 (`25I+25Q+15M+15V+10E+10T`, faixas ALTA/MÉDIA/BAIXA, sem efeito em ações); entrada de evidência de e-mail/documento/manual (`POST /integrations/marketplaces/buyer-evidence`, permissão `BUYER_INGESTION_REGISTRAR`) com prioridade da API, comparação só dos campos trazidos pela fonte parcial e fila `AGUARDANDO_IDENTIFICACAO` para evidência sem Order ID; tela `/compras/revisao`. A ingestão automática de caixa de e-mail (Batch 12) segue dependente de X-12.
- O futuro tracking precisa normalizar múltiplos pacotes/códigos e eventos fora de ordem sem acoplamento ao provider; a baseline atual não possui esse motor.
- Contratos antigos de Relatórios ainda usam estruturas genéricas em alguns pontos; sua evolução exige batch próprio para não alterar respostas existentes.
- Existem casts legados em rotas e analytics da API; removê-los exige tipagem dos contratos afetados e testes específicos.
- A janela “quinta-feira de manhã” continua sem limites horários normativos e não deve gerar bloqueio horário inventado.
- Upgrades major de Prisma, Vite ou Vitest permanecem fora do escopo e exigem validação dedicada.

## 14. Baseline de continuidade

Ao iniciar uma nova tarefa:

1. ler `AGENTS.md` e este documento;
2. confirmar branch, HEAD, working tree e remoto;
3. localizar o contrato normativo do módulo;
4. validar baseline antes de editar;
5. implementar um batch por commit;
6. executar testes proporcionais ao risco;
7. não fazer deploy ou iniciar o próximo módulo sem autorização explícita.

## 15. Convenções documentais

- Este arquivo resume; contratos específicos definem detalhes e não devem ser copiados integralmente para cá.
- Documentos de batch registram o que foi implementado naquele batch e permanecem históricos quando o trabalho seguinte os supera.
- Documentos iniciais V1 e investigações devem indicar explicitamente quando foram superados.
- Toda afirmação de implementação exige evidência no código, migration ou teste da baseline.
- Roadmap, limitação e decisão aprovada devem permanecer separados para não transformar planejamento em estado atual.
- Retries de Vendas preservam na sessão do navegador apenas chave idempotente e instante, sob hash de usuário/loja/URL/conteúdo; nenhum valor financeiro ou token é persistido. A recuperação resiste à navegação e à recarga na mesma sessão; sucesso remove a tentativa.
