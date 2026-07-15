# UX Operational Foundation V1

## 1. Finalidade e autoridade

Este documento é o contrato normativo para a futura reconstrução da experiência operacional do Dronz & Gooder System. Ele organiza a interface em torno da jornada de trabalho, preservando o backend, os contratos HTTP, o isolamento por loja, o RBAC, a auditoria, a idempotência e as fórmulas protegidas.

Este contrato não declara a nova interface implementada. Capacidades planejadas, gaps de backend e decisões ainda abertas são identificados explicitamente. `AGENTS.md`, os contratos de domínio e as regras implementadas continuam prevalecendo quando este documento não definir um aspecto.

## 2. Princípios permanentes

1. A interface é orientada por tarefas, pendências e jornadas, não por tabelas do banco.
2. O backend continua sendo a autoridade para estado, transições, autorização e cálculos de domínio.
3. Ações operacionais são apresentadas exclusivamente a partir de `allowedActions`; impedimentos vêm de `blockedReasons`.
4. A UI não reconstrói máquinas de estado, saldos, elegibilidade, rateios ou fórmulas protegidas.
5. Toda visão comercial ou econômica respeita `lojaId`, vínculo do usuário e RBAC; a visão global exige autorização global.
6. Cor nunca é a única forma de identificar Dronz, Gooder, pendência, divergência ou estado.
7. Métrica sem fonte suficiente é exibida como indisponível ou não calculável, nunca simulada.
8. Valores projetados e realizados permanecem separados.
9. O Modernize é somente referência visual. Não introduzir Next.js nem copiar código, assets ou arquivos sem licença confirmada.

## 3. Diagnóstico da experiência atual

A infraestrutura do frontend — React, Material UI, TanStack Query, autenticação, serviços HTTP, query keys e componentes compartilhados — é reaproveitável. A experiência atual, porém, é majoritariamente organizada como CRUD administrativo:

- o menu reproduz entidades em vez da jornada;
- formulários permanentes ocupam o espaço principal de telas de consulta;
- uma compra atravessa páginas desconectadas sem uma timeline comum;
- ações, bloqueios, histórico e divergências já retornados pelo backend ficam dispersos;
- Dashboard informa contagens, mas não prioriza trabalho;
- Pedidos Operacionais e Checkpoints aparecem como destinos independentes embora sejam etapas da operação;
- Categorias e Fornecedores recebem destaque incompatível com sua frequência operacional.

A reconstrução preservará infraestrutura e comportamento comprovado, mas substituirá progressivamente a organização funcional.

## 4. Classificação das telas atuais

| Tela atual | Decisão | Função futura |
|---|---|---|
| Login | manter praticamente igual | autenticação e recuperação de sessão |
| Dashboard | redesenhar completamente | Home operacional acionável e, progressivamente, econômica |
| Categorias | eliminar como página principal | filtro em Produtos e gestão em Administração |
| Produtos | redesenhar | catálogo, busca, ficha e mappings contextuais |
| Fornecedores | eliminar da jornada principal | entidade interna acessada sob demanda e em Administração |
| Compras Unificadas | redesenhar | fila, detalhe, revisão, mapping, atribuição e materialização |
| Pedidos Operacionais | fundir | etapa e vínculo no detalhe da compra/envio, com busca direta preservada |
| Checkpoints | fundir | ações e histórico na timeline de Envios e Logística |
| Logística | redesenhar | área `ENVIOS E LOGÍSTICA`, menu `LOGÍSTICA` |
| Estoque | redesenhar | posição patrimonial no Brasil e entrada definitiva |
| Financeiro | redesenhar em batch próprio | pagamentos, custos e câmbio com RBAC econômico |
| Relatórios | redesenhar em batch próprio | relatórios tipados e visão econômica autorizada |

## 5. Navegação-alvo

```text
Visão Geral
Compras
  Fila
  A caminho
  Recebimento
  Divergências
LOGÍSTICA                         título da área: ENVIOS E LOGÍSTICA
  Visão operacional
  Posições
  Preparação
  Transporte
  Histórico
Estoque
Produtos
Financeiro
Relatórios
Administração
  Usuários
  Integrações
  Configurações
  Categorias
  Fornecedores (técnico, quando autorizado)
```

O seletor de escopo `Todas / Dronz / Gooder` permanece visível quando a identidade possuir os acessos correspondentes. `Todas` não é bypass de tenancy: read models globais exigem RBAC global. Badges representam trabalho pendente definido pelo backend, nunca simples contagem local de registros.

Atalhos contextuais incluem busca por referência externa, pedido e tracking, deep links e ação primária por linha. Áreas e itens de menu são derivados de permissões, sem hardcode de nomes de pessoas ou papéis no cliente.

## 6. Fluxo operacional-alvo

| Etapa | Projeção principal | Experiência |
|---|---|---|
| evidência ou compra detectada | comercial | fila de Compras |
| revisão humana | comercial | detalhe da compra e evidências |
| aprovação, quando Buyer Ingestion existir | comercial | ação explícita e auditável |
| mapping de produto | comercial | drawer contextual por item e loja |
| atribuição Dronz/Gooder | comercial | split quantitativo e saldo pendente |
| materialização por loja | comercial | ação idempotente, resultado e vínculos |
| localização ainda não comprovada | física | ausência de evidência, não localização afirmada |
| recebimento/posição operacional | física | posição e conferência |
| preparação de volume | física | disponibilidade, reserva, peso e composição |
| transporte e checkpoints | física | timeline dependente da rota |
| chegada e recebimento no Brasil | física | conferência e divergências |
| entrada definitiva | física/patrimonial | confirmação idempotente e efeito explícito |
| estoque disponível/reservado | física/patrimonial | posição de estoque autorizada |
| custos, reembolsos e projeções | econômica | trilha paralela por moeda |

O fluxo físico não é uma sequência linear obrigatória: Paraguai é condicional, tracking pode surgir ou mudar posteriormente e reservas podem ser liberadas. Cada detalhe apresenta trilhas comercial, física e econômica separadas, além do histórico de auditoria.

### 6.1 Posições operacionais e papel contextual

**Base permanente Miami.** Miami é a base operacional permanente e principal. Ela possui responsável operacional próprio, que acompanha compras destinadas à base e seu tracking, recebe pacotes, confere produtos e quantidades, registra divergências, verifica condição física e funcionamento quando aplicável, organiza a disponibilidade operacional, seleciona itens, monta caixas e malas, calcula pesos, redistribui produtos entre volumes, fecha volumes, registra recibos e evidências, entrega caixas ao transportador e entrega malas prontas aos viajantes. Miami como entidade de base é gap de backend registrado na matriz de capacidades.

**Posições operacionais temporárias.** Compras podem ser direcionadas a endereços ligados a uma viagem (por exemplo Texas, Nova York ou Orlando). Nesses casos o sistema representa uma posição operacional temporária vinculada à operação/viagem, com responsável contextual, período ativo, compras destinadas, pacotes e tracking, itens a caminho, recebidos, conferidos, divergências, disponíveis, reservados, malas em preparação, peso acumulado e pendências. Uma posição temporária não é estoque permanente de nenhuma cidade e não cria patrimônio.

**Encerramento.** O encerramento de posição temporária usa **sugestão automática do sistema mais confirmação humana explícita**: quando todas as compras foram recebidas ou tratadas, os volumes fechados, a viagem concluída, os produtos chegaram ao Brasil e as pendências foram resolvidas, o sistema sugere o encerramento e o responsável confirma. A posição encerrada sai das operações ativas, permanece consultável no histórico e não apaga eventos; reabertura exige motivo e auditoria.

**Papel contextual do viajante.** A responsabilidade é contextual, temporária, vinculada à posição e/ou viagem, limitada por autorização e encerrada ao final da operação — nunca derivada de nome de pessoa nem de classificação permanente. Quando o viajante parte de Miami, ele não recebe compras, não administra disponibilidade e não prepara a mala: recebe a mala pronta e fechada pela base, confirma retirada, transporta e confirma chegada e ocorrências. Fora de Miami, o viajante pode assumir temporariamente recebimento, conferência, organização, preparação e fechamento da própria mala, somente para a sua posição, sem acesso a outras posições. A autorização considera permissão funcional, vínculo com loja, vínculo com posição e viagem/envio, período de validade e `allowedActions` do backend. Autorização contextual por posição/viagem/período é gap de backend, assim como o vínculo técnico entre `Viajante` e `Usuario`.

## 7. Três projeções ortogonais

### 7.1 Comercial e staging

Responde se a compra foi detectada, revisada, aprovada, mapeada, atribuída e materializada. Inclui saldo pendente, conflitos e classificações de legado. Materialização cria um `PedidoCompra`; não comprova existência ou localização física.

O estado `APROVADA` pertence ao contrato futuro de Buyer Ingestion e não deve ser descrito como implementado na staging atual.

### 7.2 Física, logística e patrimonial

Registra evidência de existência, posição, conferência, composição em volume, transporte, chegada, incorporação, disponibilidade, reserva e baixa. `Localização ainda não comprovada` representa ausência de evidência positiva.

A atribuição comercial e a materialização nunca servem como prova de localização. A identidade física unitária ainda é um gap; o modelo atual trabalha predominantemente com quantidades agregadas.

### 7.3 Econômica

É projeção derivada dos mesmos fatos, sempre por moeda: valor bruto, descontos, frete, impostos, taxas, cashback, reembolsos, valor líquido, capital comprometido, custos, potencial de venda e valores realizados futuros.

Não é um segundo ledger, segunda contabilidade nem fonte paralela de saldo. Antes da entrada definitiva, o termo aprovado é `CAPITAL COMPROMETIDO NO CICLO OPERACIONAL`, sem afirmação contábil ou fiscal. Após a entrada definitiva, o valor integra a posição patrimonial segundo as regras existentes.

## 8. Invariantes

### 8.1 Comercial

```text
Quantidade Dronz + Quantidade Gooder + Quantidade Pendente
= Quantidade Elegível
```

Na implementação atual, quantidade elegível subtrai quantidades canceladas e reembolsadas. Antes da materialização, quantidade reembolsada deixa de ser elegível e não pode ser materializada novamente.

### 8.2 Física

A mesma quantidade física não pode ocupar simultaneamente posições mutuamente exclusivas. A comprovação plena por unidade depende de evolução futura da identidade física. Nenhum evento comercial ou econômico move a posição física automaticamente.

### 8.3 Econômica

Por moeda e somente quando os componentes necessários estiverem disponíveis:

```text
bruto - descontos + frete + impostos + taxas - cashback - reembolsos
= valor líquido
```

### 8.4 Distribuição monetária

```text
Valor Dronz + Valor Gooder + Valor Pendente + Resíduo Controlado
= Valor Elegível para Distribuição
```

Moedas diferentes nunca são somadas diretamente. Consolidação exige cotação válida.

## 9. Decisões aprovadas F-1 a F-12

### F-1 — Reembolso e elegibilidade

- Antes da materialização, a quantidade reembolsada deixa de ser elegível, permanece no histórico e não pode ser materializada novamente.
- Depois da materialização, reembolso não altera quantidade física, não apaga pedido, estoque ou movimento e cria pendência de compensação auditável.
- Devolução, descarte ou ajuste físico exige operação separada e auditável.
- A compensação pós-materialização ainda é extensão futura do contrato e do backend.

### F-2 — Rateio

- Rateio proporcional ao valor líquido dos itens.
- Arredondamento `ROUND_HALF_UP`.
- Resíduo na linha de maior valor líquido; empate resolvido deterministicamente pelo ID.
- Aplica-se a desconto do pedido, frete, imposto, taxas, cashback e reembolso não vinculado diretamente a uma linha.
- Valor associado diretamente a um item permanece naquele item e não é rateado novamente.

### F-3 — Cashback

Cashback confirmado é registrado separadamente e reduz o custo econômico líquido. Cashback esperado ou pendente não reduz valor realizado. O valor original da compra nunca é sobrescrito.

### F-4 — Reembolso parcial

Usar primeiro o valor oficial da fonte. Sem valor oficial, não produzir realizado estimado; exibir `valor do reembolso não informado`. Estimativa, quando autorizada futuramente, é projeção identificada e nunca autoritativa.

### F-5 — Câmbio

A V1 usa cotação manual por usuário autorizado e registra moeda de origem e destino, valor, data e hora, responsável, fonte textual informada e margem. Integração automática poderá ser adicionada mantendo o manual como fallback. O schema atual ainda não persiste a fonte textual; isso exige migration aditiva futura.

### F-6 — Home V1

Prioriza ações pendentes, bloqueios, compras em revisão, itens sem mapping, saldo sem atribuição, materializações, recebimentos e entradas pendentes e divergências. Métricas exclusivas de Compras podem usar seu overview existente. Indicadores transversais dependem de `BE-HOME`.

### F-7 — Limite de 23 kg

Fechamento acima de 23 kg permanece bloqueado. A UX alerta antes do limite e apresenta peso, excesso e quantidade a retirar, apoiando redistribuição sem reproduzir ou alterar a fórmula protegida no frontend. Exceção futura exige contrato e permissão próprios.

### F-8 — Reserva e disponibilidade

A regra-alvo é reserva imediata e persistente no backend ao selecionar quantidade para um volume, com responsável e timestamp. A reserva impede alocação concorrente, é liberada ao remover e consumida ao fechar. A V1 não terá expiração automática. `disponível = quantidade física - quantidade reservada`. O domínio atual precisa ser ampliado para suportar todo esse contrato.

### F-9 — Economia antes da entrada definitiva

Usar `CAPITAL COMPROMETIDO NO CICLO OPERACIONAL`, sem classificar o valor como estoque patrimonial ou fazer afirmação contábil/fiscal antes da entrada definitiva.

### F-10 — Permissões econômicas

- `SUPER_ADMIN`: visão consolidada completa;
- perfil financeiro autorizado: valores e custos completos;
- gestor de loja: valores somente das lojas autorizadas;
- operador logístico: quantidades, etapas e ações sem custos restritos;
- usuário sem permissão econômica: a API não retorna campos financeiros.

Ocultar campos no frontend não substitui filtragem e autorização do backend. A filtragem por sensibilidade ainda exige extensão contratual e implementação futura.

### F-11 — Ortogonalidade

As projeções comercial, física e econômica são independentes. Evento de uma não move automaticamente outra. O fluxo físico é um grafo de transições autorizadas, não uma sequência fixa.

### F-12 — BE-HOME

O read model transversal futuro é calculado no backend, respeita identidade, permissões e loja, possui instante de referência e definições explícitas para contagens e bloqueios. Não cria segundo ledger e não é substituído por composição de caches no frontend.

## 10. Interações e apresentação

- Filas operacionais exibem ação principal, idade, responsável, bloqueio e próximo passo.
- Botão desabilitado sempre apresenta o motivo retornado pelo backend.
- Alterações destrutivas ou irreversíveis exigem confirmação proporcional ao risco.
- Histórico e auditoria aparecem em painel somente leitura no detalhe das entidades.
- Formulários raros deixam de ocupar permanentemente a tela e passam a drawers ou diálogos contextuais.
- Loading, vazio, erro, sucesso, conflito de versão e falta de permissão são estados obrigatórios.
- Dronz, Gooder e Pendente usam rótulo textual, ícone/chip e cor de apoio.
- Preço de venda zero é exibido como `A definir`.
- Item sem loja, mapping ou preço suficiente para uma projeção é exibido como `NÃO CALCULÁVEL`.

## 11. Home operacional e econômica

A primeira onda da Home usa somente read models próprios de cada domínio, sem reconciliar saldos transversalmente no cliente. A versão completa depende de `BE-HOME` para agregar Compras, Logística, Estoque e Financeiro com autorização e instante de referência consistentes.

Indicadores-alvo incluem pendências, bloqueios, itens sem mapping, saldos sem atribuição, materializações, recebimentos, entrada definitiva, divergências e, progressivamente, capital por etapa e por loja. Valores permanecem agrupados por moeda até existir cotação válida.

Wireframes e dados de design devem ser marcados como `DADOS MERAMENTE ILUSTRATIVOS — NÃO REPRESENTAM O SISTEMA`. Mocks permanentes não substituem read models.

## 12. Matriz de capacidades

| Capacidade | Classificação atual |
|---|---|
| staging global, atribuição quantitativa e materialização idempotente | implementada |
| `allowedActions`, `blockedReasons`, conflitos e histórico de Compras | implementada |
| read models e mutações UI-3C | implementada |
| valor bruto da staging agrupado por moeda | derivável com segurança |
| custos de pedido já materializado | derivável conforme dados persistidos |
| aprovação de Buyer Ingestion | contrato futuro |
| identidade física unitária | gap de backend |
| posição operacional genérica e Base Miami conforme UX-alvo | gap de backend |
| reserva persistente com ator e timestamp | gap de backend |
| compensação pós-materialização | gap de domínio e backend |
| fonte textual de cotação | gap de schema |
| filtragem de campos econômicos por permissão | gap de contrato e backend |
| overview transversal `BE-HOME` | gap de backend |
| capital consolidado por etapa | depende de posição, rateio e `BE-HOME` |
| venda e lucro realizados | módulo futuro de Vendas |

## 13. Contratos e APIs subutilizados

| Contrato | Uso futuro na experiência |
|---|---|
| `allowedActions` | fonte única dos botões operacionais |
| `blockedReasons` | motivos de bloqueio junto às ações |
| AuditLog e históricos | timeline e painel de auditoria |
| overview de Compras | fila, badges e Home da primeira onda |
| candidatos e progresso UI-3C | filas e timeline logística |
| atribuições quantitativas | split Dronz/Gooder/Pendente |
| mappings e conflitos | drawers contextuais e fila de pendências |
| materialização idempotente | ação explícita e resultado reutilizável |
| peso de mala | composição, alerta e bloqueio de 23 kg |

## 14. Decisões ainda abertas

| ID | Decisão | Bloqueia |
|---|---|---|
| E-2 | vigência da cotação e tratamento de cotação antiga | consolidação cambial por competência |
| E-3 | visibilidade de cancelados e reembolsados na visão ativa | UX da visão econômica |
| E-4 | competência de encargos lançados posteriormente | consolidação mensal de encargos |
| E-5 | perfil que aprova perda, ajuste ou compensação valorada | batch de compensações |
| UX-NAME | nomes definitivos de novas entidades físicas | schema e UI da Base Miami/Logística |
| SUPPLIER | solução estrutural definitiva do fornecedor interno | evolução do mapping e Administração |
| ATTACHMENTS | provider, retenção e política de anexos | evidências e anexos operacionais |

Essas decisões não bloqueiam o registro deste contrato. Cada uma bloqueia somente o batch indicado.

## 15. Gaps e conflitos com contratos atuais

1. A pendência de compensação pós-materialização é conceito novo e exige extensão normativa antes de implementação.
2. `CotacaoCambio` não possui campo de fonte textual; a decisão F-5 exige migration aditiva futura.
3. A reserva persistente com responsável e timestamp não é representada integralmente pelo modelo atual de alocação.
4. As APIs atuais autorizam por identidade e loja, mas ainda não filtram sistematicamente campos financeiros por sensibilidade.
5. A política de rateio e resíduo F-2 é regra normativa nova; qualquer implementação precisa de testes determinísticos.
6. A regra atual reduz elegibilidade por quantidade reembolsada antes da materialização. Depois dela, o efeito físico depende de operação corretiva separada.

Nenhum desses gaps autoriza solução local no frontend.

## 16. Estratégia incremental e rollback

Cada batch substitui uma área por vez. Rotas anteriores podem permanecer como redirect ou fallback temporário até a nova área possuir cobertura comportamental equivalente. Não haverá migração big bang.

### FIX-0 — corretivos objetivos

- validar alocação contra quantidade recebida e disponível;
- corrigir a divergência comprovada entre `valor` e `valorMercado` no fluxo de câmbio;
- tratar expiração de sessão de forma global;
- adicionar testes de regressão antes da alteração produtiva.

### UX-0 — preparação

- inventário final de páginas, componentes, contratos e screenshots;
- decisões visuais, acessibilidade e navegação;
- verificar dependência, licença, bundle e necessidade de ícones;
- estabelecer baseline de testes e estratégia de migração;
- usar feature flag somente se já existir mecanismo apropriado, sem introduzir dependência automaticamente.

### UX-1 a UX-3 — Compras e Home

- Home acionável em duas ondas;
- fila e detalhe de Compras;
- mapping, atribuição e materialização;
- preservar APIs e regras atuais;
- `BE-HOME` é dependência da visão transversal completa.

### UX-4 — Base Miami

- recebimento, conferência e posição operacional;
- condição física e verificação funcional são dimensões separadas;
- mudanças de domínio precedem campos de UI que delas dependam.

### UX-5 — Envios e Logística

- posições, volumes, preparação, transporte e timeline;
- Base Miami permanente e posições operacionais temporárias com encerramento por sugestão automática e confirmação manual;
- papel contextual do viajante conforme a seção 6.1, sem hardcode de pessoas;
- `CAIXA_FRETE_AEREO` é principal e `MALA_VIAJANTE` permanece modalidade real;
- limite de 23 kg preservado;
- migração do legado preserva histórico.

### UX-6 — Paraguai e Brasil

- filas de conferência orientadas a dispositivo móvel;
- transições e ações continuam determinadas pelo backend.

### UX-7 — Estoque

- entrada definitiva, posição patrimonial e disponibilidade;
- reserva persistente depende da extensão aprovada do backend.

### UX-8 e UX-9 — demais áreas

- Financeiro, Relatórios, Produtos e Administração;
- integrações exibem somente capacidades realmente disponíveis;
- remoção final das rotas e páginas superadas após aceite.

Cada batch define escopo, fora de escopo, dependências, critérios de aceite, testes, convivência e rollback. Reapontar a rota ao componente anterior é o rollback preferencial enquanto o legado estiver preservado.

## 17. Riscos

- confusão entre as três projeções: mitigar com trilhas e famílias visuais distintas;
- métricas parciais interpretadas como totais: rotular escopo, moeda e componentes ausentes;
- Home parcial antes de `BE-HOME`: declarar os domínios cobertos e o instante de referência;
- duplicação de regras no cliente: impedir qualquer fallback de elegibilidade, saldo ou transição;
- identidade física agregada: não prometer rastreabilidade unitária inexistente;
- mudança simultânea de rotas: migrar por área e preservar rollback;
- acesso econômico excessivo: implementar filtragem no backend antes da exposição;
- conflito concorrente de reserva: exigir transação e persistência antes da UX definitiva;
- integração visual baseada em template: não copiar código ou assets sem licença.

## 18. Critérios de aceite por batch

1. comportamento funcional e contratos HTTP preservados, salvo evolução explicitamente aprovada;
2. isolamento por loja e RBAC comprovados por testes;
3. nenhuma regra crítica calculada no frontend;
4. loading, vazio, erro, bloqueio, conflito e sucesso cobertos;
5. navegação responsiva e acessibilidade básica verificadas;
6. testes comportamentais proporcionais ao risco;
7. lint, typecheck, build, testes e `git diff --check` verdes;
8. commit isolado e rollback documentado;
9. nenhuma capacidade futura descrita como implementada.

## 19. Status

O contrato de UX está aprovado para registro documental. As decisões E-2 a E-5 e os gaps listados permanecem locais aos batches correspondentes. A reconstrução não começa automaticamente com este documento e exige autorização por batch.
