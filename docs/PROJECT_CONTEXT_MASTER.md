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

Não implementado:

- ingestão automática de compras realizadas por contas buyer;
- adapters seller Amazon/eBay, adiados até existir necessidade específica;
- tracking automático;
- integrações PayPal, bancárias ou de cartão;
- e-mail, OCR operacional e QR Code;
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

As auditorias independentes dos Batches 7 e 8 foram aprovadas. A baseline funcional mais recente é `8644188`; os Batches 8.1, 8.2 e 9 alteram somente documentação e não modificam comportamento. O Batch 8.2 supera apenas a conclusão incorreta de que não havia fonte oficial para compras buyer do eBay. O Batch 9 supera o roadmap provider-first e define primeiro o contrato multicanal comum.

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

Próximos módulos só podem iniciar em batches aprovados e independentes:

1. Gate eBay Buyer — concluído; OAuth, `GetOrders`, conta autorizada, campos, tracking, paginação do recorte e quota comprovados;
2. Batch 10 — pipeline comum de evidências, conciliação e aprovação;
3. Batch 11 — adapter eBay Buyer;
4. Batch 12 — ingestão autorizada por e-mail Amazon/eBay e reconciliação multicanal;
5. Batch 13 — painel mensal e migração da planilha histórica;
6. Batch 14 — consolidação de remessas, pacotes e tracking;
7. Batch 15 — motor de tracking e alertas;
8. Batches 16–18 — Financeiro/conciliação, Vendas/baixa patrimonial e Analytics;
9. Amazon Business API — retomada em batch próprio após aprovação do onboarding externo.

Cada módulo deve preservar os contratos existentes, isolamento por loja, auditoria e migrations incrementais. Este roadmap não declara esses itens implementados nem autoriza iniciá-los automaticamente.

### 12.1 Buyer purchase ingestion e tracking

- Dronz e Gooder utilizam Amazon, eBay e outros marketplaces como compradores. O fluxo principal importa compras realizadas, não vendas recebidas por contas seller.
- O contrato buyer é independente da fonte; Amazon Business, eBay, e-mail, invoice, CSV e entrada manual são origens possíveis e preservadas como evidências.
- A Amazon Business Reporting API `2025-06-09` é uma fonte buyer empresarial oficial com pedidos, itens e remessas; não deve ser confundida com SP-API seller. Seu estado é `PENDENTE_DE_ONBOARDING_EXTERNO`, não cancelado, e sua ativação depende de onboarding e papéis concedidos pela Amazon Business.
- Enquanto o onboarding Amazon estiver pendente, e-mails autorizados de confirmação, atualização, cancelamento, reembolso, remessa, tracking e invoice serão a fonte inicial Amazon. Nenhum e-mail cria operação automaticamente.
- A primeira integração estruturada validada é eBay Buyer. O gate comprovou OAuth Production e Trading API `GetOrders` com `OrderRole=Buyer`; o adapter produtivo ainda não foi implementado.
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

- A API V1 não lista contas externas ou merchants; a UI aceita IDs conhecidos e não inventa opções.
- A fundação técnica do Batch 8 permanece útil, mas ainda não contém adapter real. Amazon SP-API e eBay Sell Fulfillment continuam seller-side. Amazon Business Reporting API e Trading API `GetOrders` exigem adapters próprios.
- O sistema legado citado pelo Product Owner não está disponível nos repositórios acessíveis. Isso deixou de bloquear o eBay: keyset, OAuth, refresh, chamada `GetOrders`, schema version, quota e tracking foram comprovados diretamente no gate. Permanecem abertas frequência operacional, sobreposição, secret manager de produção e validação de paginação real com mais de uma página.
- Para a futura retomada da Amazon Business API, permanecem externos/abertos: onboarding, papel Amazon Business Analytics, papéis de Package Tracking/Document/Reconciliation, IDs e campos reais, rate limits, referência segura de secrets, tolerância monetária e escopo final de atribuição dos operadores. Esses itens não bloqueiam eBay, e-mail, conciliação ou painel mensal.
- O Gate 9.1 confirmou apenas capacidades documentadas: o onboarding Amazon Business não foi iniciado, nenhum papel ou credential foi comprovado e nenhuma chamada real foi executada. `ORDERS` e `ORDER_ITEMS` são o núcleo mínimo; remessas, tracking, documentos, reconciliação e User Management são progressivos e não bloqueiam esse núcleo quando indisponíveis.
- O Gate 9.2 fornece o runbook operacional e permanece válido para a futura retomada Amazon. Somente o adapter Amazon fica bloqueado até Analytics, LWA, consentimento, secret manager e acesso produtivo sanitizado a pedidos e itens.
- Para os Batches 11–13, permanecem abertas as decisões de contas eBay, caixas autorizadas, retenção de e-mail, pesos/faixas de confiança, tolerância monetária, rateio de encargos, arredondamento, eventual fechamento mensal e planilha histórica. Cada uma bloqueia apenas a implementação que dependa diretamente dela.
- O serviço atual trata mudança incompatível no payload de uma compra já importada como conflito. O contrato buyer determina evidências versionadas e reconciliação, mas essa evolução ainda não está implementada.
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
