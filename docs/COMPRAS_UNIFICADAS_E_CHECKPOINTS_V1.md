# Compras Unificadas e Checkpoints V1

**Status:** contrato normativo candidato à implementação

**Data:** 2026-07-12

**Escopo de implementação associado:** Batches 3 a 6
**Fontes confrontadas:** `AGENTS.md`, `docs/domain-contracts.md`, documentos históricos, schema Prisma, API e testes existentes.

## 1. Propósito, precedência e limites

Este documento congela o modelo-alvo de Compras Unificadas e da UI-3C. Ele não declara que o modelo-alvo já está implementado. Quando houver conflito:

1. regras expressamente confirmadas neste documento;
2. `AGENTS.md`;
3. `docs/domain-contracts.md`, exceto nos pontos que este contrato altera explicitamente;
4. código e schema atuais, como evidência do comportamento existente;
5. documentos históricos.

Decisões técnicas e P-01 a P-07 estão fechadas. P-08 permanece pendência exclusiva do Product Owner, não bloqueadora para o Batch 3, conforme a seção 35.

Fora deste contrato: Vendas, tracking automático, integrações de pagamento, e-mail, QR Code, PDF e alterações em `calcSimulacao`.

## 2. Regra central confirmada

Compras externas entram em uma staging unificada, inicialmente sem loja. Cada linha pode ser atribuída, por quantidade, à Dronz, à Gooder ou permanecer pendente. Somente a materialização explícita cria pedidos operacionais; cada pedido operacional possui exatamente uma `lojaId`. A partir daí, logística, recebimento, estoque e financeiro são absolutamente isolados por loja.

Consequências:

- `CompraImportada` não é `PedidoCompra`;
- uma compra pode abastecer duas lojas;
- uma linha com várias unidades pode ser dividida;
- staging global não usa `x-store-id` como autorização;
- pedidos materializados nunca são globais;
- nenhuma leitura operacional revela a parcela da outra loja.

## 3. Glossário normativo

| Termo | Definição única |
|---|---|
| Compra Externa | Transação observada fora do sistema, identificada por plataforma, conta externa e ID externo. |
| Compra Importada | Representação persistida da Compra Externa na staging. Pode não possuir loja. |
| Staging | Contexto global e controlado de importação, deduplicação, revisão, mapping, atribuição e materialização. |
| Plataforma | Canal onde a compra ocorreu, distinto do merchant. |
| Conta Externa | Conta não secreta usada em uma plataforma; pode ser compartilhada entre Dronz e Gooder. |
| Merchant Externo | Vendedor observado na compra/plataforma. Não pertence a uma loja. |
| Item/Linha Externa | Linha comprada na plataforma, antes de qualquer Produto interno. |
| Atribuição | Reserva lógica de quantidade de uma Linha Externa para uma loja. Não cria pedido. |
| Quantidade Pendente | Quantidade elegível ainda não atribuída. |
| Mapping | Associação revisável entre entidade externa e entidade operacional de uma loja. |
| Materialização | Ação explícita e idempotente que cria o pedido operacional de uma loja. |
| Pedido Operacional | `PedidoCompra` tenantado, usado nos fluxos posteriores. |
| Fornecedor Interno | Cadastro operacional pertencente a uma loja. |
| Produto Interno | Produto pertencente a uma loja e usado em pedido, logística e estoque. |
| Checkpoint | Evento imutável que confirma uma transição física autorizada, com pré-condições, ator e horário. |
| Evento Corretivo | Novo evento auditável que corrige outro sem apagá-lo. |
| Auditoria | Registro imutável de ator, ação, contexto, antes/depois e correlação. |
| Loja | Tenant operacional. Inicialmente Dronz ou Gooder. |

Relações que nunca são sinônimas:

```text
Compra Importada != Pedido Operacional
Merchant Externo != Fornecedor Interno
Item Externo != Produto Interno
Atribuição != Materialização
Checkpoint != simples alteração de status
```

## 4. Estado atual versus modelo-alvo

O schema atual contém `CompraImportada`, `CompraImportadaItem` e `AtribuicaoItem`, porém:

- não há rota operacional de criação/listagem da staging;
- a unicidade atual é `fornecedorId + numeroPedido`, sem plataforma ou conta;
- `CompraImportadaItem` não possui `externalLineId`, preço ou identidade do produto externo;
- a API de triagem está sob `/purchase-orders`, exige `x-store-id` e atribui `PedidoCompraItem` já pertencente à mesma loja;
- a FK composta impede atribuir um item Dronz à Gooder;
- os testes atuais comprovam isolamento, não split cross-store da staging;
- não existe materialização idempotente da staging.

Essas estruturas serão migradas incrementalmente no Batch 5. Não devem ser confundidas com o contrato-alvo.

## 5. Identidade da compra externa

Identidade normativa:

```text
plataforma + contaExternaId + externalOrderIdNormalizado
```

Constraint-alvo conceitual:

```text
UNIQUE (plataforma, contaExternaId, externalOrderIdNormalizado)
```

`numeroPedido` isolado é insuficiente porque merchants, plataformas e contas distintas reutilizam números.

### 5.1 Preservação e normalização

- persistir `externalOrderIdOriginal` exatamente como recebido;
- derivar `externalOrderIdNormalizado` apenas removendo espaços nas extremidades e aplicando normalização Unicode NFC;
- não remover espaços internos, pontuação, zeros à esquerda nem alterar caixa;
- a comparação é case-sensitive;
- o original é exibido e auditado;
- correção de identidade é operação privilegiada, auditada e sujeita a nova checagem de unicidade;
- reimportação da mesma identidade atualiza somente campos permitidos e preserva histórico.

### 5.2 Ausência de ID confiável

- importação integrada sem `externalOrderId` é rejeitada e mantida como erro de importação, sem criar compra incompleta;
- importação manual usa `plataforma=MANUAL`, origem/conta manual explícita, ID técnico interno e uma referência digitada pelo usuário;
- a referência é exibível e pesquisável, mas não é globalmente única;
- idempotência usa chave técnica própria e nunca depende somente da referência informada;
- o sistema não gera silenciosamente um número aleatório que pareça proveniente de uma plataforma externa.

## 6. Plataformas

Enum inicial, baseado nas referências já encontradas:

```text
AMAZON
EBAY
WALMART
BEST_BUY
APPLE
OUTRA
MANUAL
```

- `OUTRA` exige `plataformaDescricao` não vazia;
- `MANUAL` identifica entrada manual sem afirmar origem externa;
- plataforma é marketplace/canal; merchant é o vendedor;
- compra direta da Apple usa plataforma `APPLE` e merchant observado;
- adicionar enum exige migration; dados não reconhecidos entram como `OUTRA`, preservando descrição original.

## 7. Conta Externa

Entidade conceitual `ContaExterna`:

| Campo | Regra |
|---|---|
| id | ID técnico seguro |
| plataforma | enum obrigatório |
| nomeExibicao | obrigatório e administrável |
| identificadorExterno | não secreto; único por plataforma quando informado |
| status | `ATIVA` ou `INATIVA` |
| origemIntegracao | `MANUAL`, `IMPORTACAO_ARQUIVO`, `API` ou `OUTRA` |
| metadata | allowlist não sensível |
| timestamps | UTC |

A conta pode ser compartilhada pelas duas lojas porque pertence à staging global. Desativação bloqueia novas importações, mas preserva compras históricas. Senhas, cookies, refresh tokens, API keys e tokens OAuth nunca pertencem a essa entidade; futura integração deverá usar armazenamento de segredos próprio e apenas referenciar a conta.

Visualização e administração exigem permissões globais distintas.

## 8. Merchant externo e fornecedor interno

`MerchantExterno` pertence à staging e possui: ID, plataforma, `externalMerchantId?`, nome original, nome normalizado para busca, contatos públicos opcionais, status, timestamps e aliases auditados.

Identidade preferencial: `plataforma + externalMerchantId`. Sem ID, usa-se registro revisável criado a partir do nome original; matching por nome nunca funde automaticamente merchants.

`MapeamentoMerchantFornecedor` contém merchant, loja, fornecedor interno, status, confiança/origem, revisor e timestamps. Regras:

- `UNIQUE (merchantExternoId, lojaId)` para mapping ativo;
- o mesmo merchant pode mapear para fornecedores diferentes por loja;
- sugestão automática não ativa mapping;
- revisão humana é obrigatória antes da primeira materialização;
- mapping ausente bloqueia a loja correspondente;
- mudança afeta apenas futuras materializações; pedidos existentes preservam fornecedor original;
- histórico é auditado, não sobrescrito sem trilha;
- fusão de merchants preserva aliases, mappings e referências históricas.

## 9. Identidade da linha externa

Identidade preferencial:

```text
CompraImportada + externalLineId
```

`externalLineId` original é preservado e case-sensitive. Constraint: `UNIQUE (compraImportadaId, externalLineIdNormalizado)`.

### 9.1 Fallback oficial

Quando a plataforma não fornece ID:

1. calcular fingerprint versionado de campos estáveis disponíveis: SKU externo, GTIN, variante, preço unitário, moeda e identificador de oferta;
2. se duas linhas produzirem o mesmo fingerprint, acrescentar um discriminador persistido na primeira importação;
3. gravar `identityStrategy` e `identityVersion`;
4. reimportações reconciliam pelo fingerprint e pelo discriminador persistido, nunca apenas pela posição visual.

Linhas ambíguas ficam `COM_DIVERGENCIA` e exigem revisão; não são fundidas silenciosamente.

### 9.2 Conteúdos especiais

- mesma SKU em linhas distintas permanece distinta;
- variação, cor, capacidade e modelo participam do fingerprint quando disponíveis;
- kit é uma linha externa até existir decomposição explicitamente fornecida/revisada;
- descontos, frete, imposto e taxas pertencem ao cabeçalho ou a componentes financeiros, não viram Produto;
- brinde pode ter preço zero, mas ainda exige identidade e quantidade;
- cancelamento/devolução altera elegibilidade, não apaga a linha;
- alteração de quantidade após materialização gera divergência e não reduz silenciosamente o pedido.

A staging preserva moeda e valores originais. A materialização consolida o pedido operacional em USD, conforme `AGENTS.md`, usando cotação auditável quando a origem não for USD. Nunca se substitui o valor original; origem, taxa, instante e resultado em USD permanecem rastreáveis.

## 10. Quantidades

Produtos físicos usam unidade inteira. Quantidades decimais estão fora deste contrato.

Para cada linha:

```text
quantidadeImportada >= 0
quantidadeCancelada >= 0
quantidadeReembolsada >= 0
quantidadeImportadaElegivel = quantidadeImportada - quantidadeCancelada - quantidadeReembolsada

quantidadeAtribuidaDronz
+ quantidadeAtribuidaGooder
+ quantidadePendente
= quantidadeImportadaElegivel

quantidadePendente >= 0
quantidadeMaterializadaLoja <= quantidadeAtribuidaLoja
```

- atribuições são inteiras positivas;
- cancelamento total produz elegível zero;
- recebimento parcial não altera a atribuição; é estado downstream;
- redução da quantidade elegível abaixo do já materializado cria divergência crítica;
- antes da materialização, redução exige ajuste transacional das atribuições ou revisão;
- após materialização e antes de downstream, correção ocorre por cancelamento/ajuste operacional transacional e auditado;
- após qualquer efeito downstream, correção ocorre somente por evento corretivo e compensação, nunca por exclusão ou edição silenciosa do pedido.

## 11. Atribuição

Chave lógica: `linhaExternaId + lojaId`. Uma linha tem no máximo uma atribuição ativa por loja, atualizável transacionalmente.

- atribuir não materializa;
- saldo pode permanecer pendente;
- Dronz e Gooder podem coexistir na mesma linha;
- toda mudança registra antes/depois, ator e correlation ID;
- validação e gravação ocorrem na mesma transação;
- controle de concorrência usa versão otimista da linha (`version` incremental) e update condicional;
- conflito de versão retorna `409 concurrent_modification` com estado atual.

Exemplo válido:

```text
Importada: 10
Dronz: 4
Gooder: 3
Pendente: 3
```

Exemplo inválido:

```text
Importada: 10
Dronz: 6
Gooder: 5
Resultado: rejeição integral; nenhuma atribuição é alterada.
```

Concorrência: A lê saldo 10 e atribui 6; B, com a versão antiga, tenta 5. O primeiro commit incrementa a versão; o segundo recebe 409, relê saldo 4 e não duplica quantidade.

Permissões separadas: revisar, atribuir e materializar. A mesma pessoa pode executar atribuição e materialização somente se possuir ambas; segregação obrigatória de pessoas não foi confirmada.

Após materialização, a atribuição daquela loja fica bloqueada. Antes de qualquer efeito downstream, cancelamento ou redução do pedido operacional pode ocorrer transacionalmente, com auditoria. Após recebimento, logística, checkpoint, estoque ou outro efeito downstream, exclusão simples é proibida: a correção exige evento corretivo e movimentos compensatórios, preservando pedido e histórico.

## 12. Mapping de produto

`MapeamentoItemProduto` relaciona linha externa, loja e Produto interno:

- `UNIQUE (linhaExternaId, lojaId)` para mapping ativo;
- um item pode mapear para Produtos diferentes em Dronz e Gooder;
- SKU, GTIN/UPC/EAN, nome, modelo, variante, cor e capacidade podem gerar sugestão;
- sugestão contém confiança e justificativa, mas não é aprovação;
- primeira materialização exige revisão humana;
- produto não é criado automaticamente;
- mapping ausente bloqueia a parcela da loja;
- mudança posterior não altera itens já materializados;
- mappings inativos permanecem no histórico.

## 13. Estado da Compra Importada

Persistir apenas fatos/flags irredutíveis:

```text
IMPORTADA
EM_REVISAO
CANCELADA
COM_DIVERGENCIA
```

Estados de progresso são derivados para evitar inconsistência:

```text
PENDENTE_ATRIBUICAO
PARCIALMENTE_ATRIBUIDA
ATRIBUIDA
PRONTA_PARA_MATERIALIZAR
PARCIALMENTE_MATERIALIZADA
MATERIALIZADA
```

| Estado apresentado | Condição derivada | Ações principais |
|---|---|---|
| IMPORTADA | criada, ainda não aberta | iniciar revisão |
| EM_REVISAO | revisão aberta | mapear, atribuir, corrigir dados permitidos |
| PENDENTE_ATRIBUICAO | elegível > 0 e atribuído = 0 | atribuir |
| PARCIALMENTE_ATRIBUIDA | 0 < atribuído < elegível | atribuir/revisar |
| ATRIBUIDA | pendente = 0 e sem materialização completa | mapear/materializar |
| PRONTA_PARA_MATERIALIZAR | parcela possui mappings e revisão concluída | materializar |
| PARCIALMENTE_MATERIALIZADA | ao menos uma loja materializada e há outra parcela não materializada | concluir loja restante |
| MATERIALIZADA | toda quantidade atribuída elegível foi materializada | consultar histórico |
| COM_DIVERGENCIA | identidade/quantidade/mapping exige decisão | corrigir; materialização bloqueada |
| CANCELADA | cancelamento pré-materialização | somente consulta/correção autorizada |

`COM_DIVERGENCIA` e `CANCELADA` prevalecem sobre estados derivados. Uma compra pode permanecer parcialmente atribuída indefinidamente. A parcela pronta de uma loja pode ser materializada mesmo que outra loja ainda tenha pendências ou restem quantidades não atribuídas; a compra permanece apresentada como parcialmente processada.

## 14. Materialização

Materialização é comando explícito por `compraImportadaId + lojaId`.

Pré-condições:

- usuário com permissão global de materializar e acesso operacional à loja destino;
- compra revisada, não cancelada e sem divergência bloqueadora;
- atribuição positiva para a loja;
- merchant e todos os Produtos mapeados para a loja;
- versão esperada da compra/linhas;
- nenhuma materialização anterior para a mesma compra e loja.

Idempotência:

```text
UNIQUE (compraImportadaId, lojaId)
idempotencyKey = materialize:{compraImportadaId}:{lojaId}
```

A operação ocorre em uma transação serializável curta: valida versões, cria ou retorna vínculo existente, cria um `PedidoCompra`, cria itens com quantidades daquela loja, grava referências linha→item, auditoria e resultado. Falha faz rollback integral.

### 14.1 Cenários

- Somente Dronz: um pedido Dronz.
- Dronz e Gooder: um pedido por loja, ambos ligados à mesma compra; consultas operacionais nunca cruzam.
- Repetição: retorna o mesmo pedido e não cria itens.
- Mapping ausente: retorna 409 e não cria pedido parcial acidental.
- Timeout após commit: retry com mesma chave retorna o resultado persistido.

Materialização é independente por loja: uma loja pronta não aguarda a outra nem o fim do saldo pendente. A operação permanece idempotente por compra+loja e a UI deve indicar explicitamente o processamento parcial.

## 15. Isolamento e autorização

### 15.1 Staging global

- não recebe nem confia em `x-store-id` para definir visibilidade;
- exige JWT e permissão global específica;
- respostas podem mostrar atribuições Dronz/Gooder apenas a perfis globais autorizados;
- mapping/materialização para uma loja também exige vínculo do usuário com a loja destino;
- logs de staging não são acessíveis por rotas operacionais comuns.

### 15.2 Operação por loja

- exige JWT, `x-store-id`, vínculo e permissão;
- toda query inclui `lojaId` no banco;
- ID pertencente a outra loja responde 404, sem confirmação de existência;
- pedido materializado só expõe sua própria loja e referências externas mínimas necessárias;
- um usuário de uma única loja não recebe a parcela atribuída à outra.

A staging global completa é acessível somente por `SUPER_ADMIN` ou pelo perfil global dedicado a Compras Unificadas, ambos com permissões globais específicas. Usuários comuns restritos a uma loja não acessam a staging completa; após atribuição/materialização, veem apenas os dados operacionais autorizados da própria loja.

## 16. Máquina normativa UI-3C

Fonte única: backend. Cada recurso retorna estado, ações permitidas, bloqueios e histórico. Fluxo-base:

```text
Pedido operacional CONFIRMED
→ recebimentos Miami (parciais até completos)
→ alocação e fechamento logístico
→ checkpoint Paraguai, quando aplicável
→ chegada Brasil
→ abertura de recebimento
→ conferência de itens
→ entrada definitiva
→ movimento de estoque ENTRY
```

Estado comercial de `PedidoCompra`, estado logístico de `Viagem/Mala`, estado de conferência de `Recebimento` e eventos de checkpoint são dimensões distintas; nenhum substitui o outro.

| Etapa | Estado anterior mínimo | Evento/estado posterior | Bloqueios e idempotência |
|---|---|---|---|
| Miami parcial | pedido `CONFIRMED` ou parcial; saldo > 0 | `RecebimentoMiami`; pedido parcial | excesso, loja/permissão, key com payload diferente |
| Miami completo | todos os itens integralmente confirmados | pedido `RECEIVED_MIAMI` | confirmação repetida retorna evento; não soma novamente |
| Consolidação | Miami completo; viagem aberta; mala em planejamento | alocação e depois mala fechada | peso ausente/excedido, item de outra loja |
| Paraguai | rota declara Paraguai obrigatório; mala/viagem em estado permitido | `CheckpointParaguai` válido ou divergente | duplicidade, divergência bloqueadora |
| Brasil | viagem chegada; mala associada; checkpoint anterior aplicável | `CheckpointBrasil` | fora de ordem, cross-store, duplicidade |
| Recebimento | Brasil válido | `Recebimento` aberto | um ativo por viagem+mala+loja |
| Conferência | recebimento aberto; item elegível | confirmação imutável; progresso atualizado | quantidade inválida, item externo, replay divergente |
| Entrada definitiva | Brasil e conferência concluídos; quantidade apta | `EstoqueEntrada COMPLETED` + `ENTRY` | unique viagem+mala+loja; replay retorna resultado |

Cada comando recebe idempotency key. Repetição com o mesmo payload retorna o primeiro resultado; mesma key com payload diferente retorna 409. Evento divergente não é considerado transição válida até resolução conforme a política daquela etapa.

## 17. Miami

Entidade: `RecebimentoMiami`, por item operacional e confirmação parcial.

Pré-condições: pedido `CONFIRMED` ou `PARTIALLY_RECEIVED_MIAMI`, item da loja, quantidade positiva que não exceda pendente, permissão de confirmação.

Resultados:

- parcial → pedido `PARTIALLY_RECEIVED_MIAMI`;
- total de todos os itens → `RECEIVED_MIAMI`;
- nunca cria estoque;
- divergências: `CORRETO`, `FALTANTE`, `QUANTIDADE_DIVERGENTE`, `DANIFICADO`, `DESCONHECIDO`, `TRACKING_NAO_LOCALIZADO`;
- ausência total é registrada como divergência própria, sem inventar quantidade positiva;
- observação/evidência é obrigatória para divergência diferente de `CORRETO`.

Prazo de 24 horas: indicador/alerta, não bloqueio. Calculado desde o recebimento físico informado, em `America/New_York`, persistindo instantes em UTC. Correção é evento novo e recalcula projeções sem apagar a confirmação.

Peso de mala continua sendo calculado pelo backend a partir de alocação e tara; Miami não altera fórmula localmente.

## 18. Paraguai

Entidade: `CheckpointParaguai`, por mala e viagem. Confirma presença/condição no checkpoint intermediário; não cria estoque.

Pré-condições propostas: viagem e mala da loja, rota marcada como aplicável ao Paraguai, estado logístico anterior permitido, permissão específica, ausência de confirmação válida anterior.

Divergências atuais preservadas: `CORRETO`, `MALA_AUSENTE`, `VOLUME_AUSENTE`, `ITEM_NAO_LOCALIZADO`, `QUANTIDADE_DIVERGENTE`, `AVARIA`, `ITEM_EXTRA`, `CHECKPOINT_PARCIAL`.

Cada rota declara seus checkpoints obrigatórios. Checkpoint Paraguai válido libera a próxima transição somente nas rotas que o exigem. Nas demais, Paraguai é `NAO_APLICAVEL`, nunca `PENDENTE`. Divergência bloqueadora mantém a ação seguinte indisponível até resolução/correção.

## 19. Brasil

Entidade: `CheckpointBrasil`, por mala e viagem. Caracteriza chegada física ao Brasil, exige viagem `ARRIVED_BRAZIL`, mala associada e permissão.

Divergências: `CORRETO`, `MALA_AUSENTE`, `ITEM_NAO_LOCALIZADO`, `QUANTIDADE_DIVERGENTE`, `AVARIA`, `ITEM_EXTRA`, `REGISTRO_ADUANEIRO_DIVERGENTE`, `LACRE_ROMPIDO`.

O evento registra ator e instante UTC, habilita recebimento quando não bloqueado e nunca cria estoque. Chegada ao Brasil não equivale a entrada definitiva.

## 20. Recebimento e entrada definitiva

Sequência obrigatória:

1. chegada ao Brasil confirmada;
2. abertura única do recebimento para viagem+mala;
3. conferência individual ou lote explícito;
4. registro de recebida, rejeitada e divergências;
5. conclusão da conferência;
6. entrada definitiva explícita e idempotente;
7. criação transacional de `ENTRY` e atualização do estoque real.

Regras:

- esperado vem das alocações materializadas da mesma loja;
- `recebida + rejeitada <= esperada`, salvo fluxo separado de item extra;
- faltante permanece pendente ou fecha com divergência autorizada;
- excesso/item inesperado não entra automaticamente no estoque;
- avaria/rejeição não compõe quantidade apta;
- entrada definitiva exige chegada ao Brasil, todos os checkpoints declarados obrigatórios pela rota e conferência concluída;
- quantidade apta = recebida − rejeitada − já incorporada;
- repetição retorna a mesma `EstoqueEntrada` concluída;
- estoque só muda aqui, nunca em Miami, Paraguai, Brasil ou mera abertura de recebimento;
- após entrada definitiva não há reabertura nem edição silenciosa: somente evento corretivo autorizado e movimento compensatório auditável.

O comportamento atual que cria `ENTRY` durante confirmação de item conflita com esta regra-alvo e deverá ser migrado no Batch 3, com teste de não duplicação.

## 21. Eventos corretivos

Evento confirmado é imutável. `EventoCorretivo` conceitual contém:

- ID e correlation ID;
- tipo e entidade/evento original;
- usuário, loja e permissão usada;
- motivo obrigatório;
- payload anterior e corrigido;
- timestamp UTC;
- impacto/reprocessamento e status.

Somente `CHECKPOINT_CORRIGIR` permite solicitar correção. Campos de identidade, loja e ator original nunca são editados. Correção pode invalidar uma projeção e gerar nova transição, mas preserva os eventos originais. Se houver checkpoint posterior, recebimento ou estoque consumado, a correção não é automática: o fluxo é bloqueado, registra-se evento corretivo com motivo, e qualquer saldo consumado muda somente por movimento compensatório auditável.

## 22. Permissões e RBAC

Estado atual: somente `SYSTEM_ADMIN` existe no seed e as rotas comerciais validam autenticação/vínculo, sem autorização por código. Fica aprovada a matriz granular abaixo para staging, mappings e checkpoints. Ela supera a regra de `docs/domain-contracts.md` que impedia novos códigos de permissão exclusivamente nesses fluxos; não autoriza criação indiscriminada de permissões fora deste contrato.

Matriz-alvo:

| Permissão | Escopo | Operação |
|---|---|---|
| COMPRAS_IMPORTADAS_VISUALIZAR | global | listar/detalhar staging |
| COMPRAS_IMPORTADAS_IMPORTAR | global | importar/reimportar |
| COMPRAS_IMPORTADAS_REVISAR | global | revisar/corrigir staging |
| COMPRAS_IMPORTADAS_ATRIBUIR | global + vínculo destino | atribuir/desatribuir |
| COMPRAS_IMPORTADAS_MATERIALIZAR | global + vínculo destino | materializar |
| CONTA_EXTERNA_GERENCIAR | global | administrar contas não secretas |
| MAPPING_FORNECEDOR_GERENCIAR | global + vínculo destino | mapear merchant |
| MAPPING_PRODUTO_GERENCIAR | global + vínculo destino | mapear item |
| MIAMI_RECEBIMENTO_VISUALIZAR | loja | read model/histórico Miami |
| MIAMI_RECEBIMENTO_CONFIRMAR | loja | confirmar Miami |
| PARAGUAI_CHECKPOINT_VISUALIZAR | loja | read model/histórico Paraguai |
| PARAGUAI_CHECKPOINT_CONFIRMAR | loja | confirmar Paraguai |
| BRASIL_CHECKPOINT_VISUALIZAR | loja | read model/histórico Brasil |
| BRASIL_CHECKPOINT_CONFIRMAR | loja | confirmar Brasil |
| RECEBIMENTO_VISUALIZAR | loja | ver conferência |
| RECEBIMENTO_CONFIRMAR | loja | abrir/confirmar itens |
| ENTRADA_DEFINITIVA_VISUALIZAR | loja | ver elegibilidade/histórico |
| ENTRADA_DEFINITIVA_CONFIRMAR | loja | incorporar estoque |
| CHECKPOINT_CORRIGIR | loja | evento corretivo |

`SYSTEM_ADMIN` não é depreciada; permanece administrativa. Nenhuma permissão granular existente pode ser reutilizada porque elas não existem. Perfil sugerido já confirmado em gaps: `CHECKPOINT_MIAMI`, limitado às permissões Miami e DTO sem valores financeiros. Perfis Paraguai/Brasil/Recebimento dependem de definição operacional futura, sem necessidade de novos códigos além da matriz.

## 23. Auditoria

Eventos obrigatórios da staging: importação, reimportação, deduplicação, edição, identidade corrigida, merchant alterado/fundido, mappings sugeridos/aprovados/alterados, atribuição/desatribuição, materialização iniciada/concluída/falha, cancelamento e correção.

Eventos UI-3C: Miami, Paraguai, Brasil, abertura de recebimento, confirmação de item, divergência, entrada definitiva, idempotent replay e correção.

Campos mínimos:

```text
actorUserId
lojaId?                  # nulo apenas em ação puramente global
entity / entityId
action
occurredAt UTC
before? / after?
reason?
source
correlationId
idempotencyKey?
permissionCode
```

Nunca registrar senhas, tokens, cookies, documentos completos de viajantes, payloads secretos ou dados de cartão. Dados pessoais devem ser minimizados. O `AuditLog` atual é insuficiente para todos os campos e deverá ser evoluído, sem criar sistema paralelo.

## 24. Timezone e deadlines

Decisão técnica:

- persistência e ordenação em UTC;
- regras Miami em `America/New_York`;
- regras operacionais Brasil e exibição padrão em `America/Sao_Paulo`;
- offsets e DST são resolvidos por timezone IANA, não por UTC fixo.

Regras confirmadas:

- deadline semanal: terça-feira 14:00 em Miami;
- confirmação Miami em até 24 horas, como alerta;
- envio planejado quinta-feira, período `MANHA`.

“Quinta-feira de manhã” permanece um período, não um horário inventado. Para alertas computáveis que exigem instante final, P-08 define o limite. Até lá, o backend pode filtrar por `periodoEnvio=MANHA`, mas não declarar atraso por hora.

## 25. Relatórios e filtros

| Tipo | Objetivo | Status aplicáveis | Período | Loja/moeda |
|---|---|---|---|---|
| purchase-orders | pedidos operacionais | `PedidoCompraStatus` | dataCompra | loja; moeda do pedido |
| purchase-items | itens materializados | status do pedido | dataCompra | loja; moeda do pedido |
| logistics | viagens e alocações | `ViagemStatus` | partida/chegada | loja; sem moeda |
| suitcase-weight | peso de malas | `MalaStatus` | viagem | loja; kg |
| receiving | conferências | `RecebimentoStatus` | início/conclusão | loja; sem moeda |
| inventory | posição atual | ativo/zerado/reservado | snapshot, sem período obrigatório | loja; valor com moeda declarada |
| movements | movimentos | tipo e motivo | createdAt | loja; unidades |
| costs | custos por pedido | status do pedido/custo | dataCompra | loja; moeda explícita |
| payments | pagamentos | `PagamentoStatus` | pagoEm/createdAt | loja; moeda explícita |
| markup | margem por Produto | abaixo/acima/indefinido | snapshot ou período de custo | loja; moeda explícita |

Cada endpoint deve publicar contrato tipado com filtros suportados, colunas, formatos, enums e moeda. Status inválido para o tipo retorna 400. Ordenação usa allowlist e desempate por ID. Staging unificada terá relatórios próprios no futuro; não se mistura aos dez operacionais por loja.

## 26. Exportação

Prioridade: CSV; PDF fica fora deste ciclo.

CSV:

- respeita filtros, loja e autorização atuais;
- UTF-8 com BOM quando necessário para compatibilidade; delimitador `;` no locale pt-BR;
- cabeçalhos estáveis e versionados;
- datas ISO 8601 com timezone indicado;
- valores numéricos brutos em colunas próprias e moeda em coluna separada;
- prefixa células iniciadas por `=`, `+`, `-`, `@`, tab ou CR com apóstrofo;
- nome `dronz-gooder_<tipo>_<loja>_<data-utc>.csv`;
- exportação síncrona com limite documentado/paginação; acima do limite retorna 413 e futura operação assíncrona será outro batch.

## 27. Invariantes

1. Compra importada pode existir sem loja.
2. Pedido operacional nunca existe sem loja.
3. Uma atribuição pertence a exatamente uma linha e uma loja.
4. Quantidade atribuída é inteira positiva.
5. Soma atribuída não supera quantidade elegível.
6. Quantidade pendente nunca é negativa.
7. Cancelamento/reembolso não apaga histórico.
8. Materialização não duplica pedido.
9. Materialização não duplica item.
10. Materialização é atômica por compra+loja.
11. Pedido Dronz não é legível pela Gooder.
12. Pedido Gooder não é legível pela Dronz.
13. Merchant externo não é fornecedor interno.
14. Item externo não é Produto interno.
15. Mapping é por loja e mapping ausente bloqueia a parcela.
16. Frontend não decide transições.
17. Checkpoint inválido não avança estado.
18. Checkpoint confirmado é imutável.
19. Entrada definitiva exige chegada ao Brasil.
20. Estoque real muda somente na entrada definitiva válida.
21. Toda correção preserva o evento original.
22. Toda mutação crítica é transacional e auditável.
23. Toda API operacional valida JWT, vínculo, permissão e loja.
24. Staging global exige permissão global própria.
25. IDs de outra loja não confirmam existência.
26. Retry idempotente não duplica efeito.
27. Quantidade recebida/rejeitada/incorporada conserva o total conferido.
28. Dados monetários declaram moeda e usam Decimal.
29. Datas persistem em UTC.
30. Nenhum token/segredo pertence à Conta Externa.

## 28. Concorrência e idempotência

| Cenário | Controle | Resposta |
|---|---|---|
| importação duplicada | unique identidade + upsert transacional | registro existente/200; conflito de conteúdo vira divergência |
| duas atribuições | versão otimista e update condicional | uma vence; outra 409 com versão atual |
| duas materializações | unique compra+loja + transação serializável | mesmo pedido; sem duplicação |
| dupla confirmação checkpoint | unique lógico do evento ativo + idempotency key | replay retorna evento; payload diferente 409 |
| dupla entrada definitiva | unique viagem+mala+loja + consulta antes do saldo | retorna entrada concluída existente |
| retry após timeout | idempotency key persistida com resultado | mesmo resultado |
| resposta perdida | consulta por chave | mesmo resultado |
| correção concorrente | versão do evento/projeção | 409 |
| mapping alterado durante materialização | snapshot/version check | rollback e 409 |

Transações críticas usam isolamento `Serializable` com retry limitado apenas para falhas de serialização conhecidas. O cliente não repete automaticamente mutações sem a mesma idempotency key.

## 29. Estratégia de migração do Batch 5

1. inventariar contagens, nulos, duplicidades e vínculos atuais;
2. adicionar estruturas novas e constraints inicialmente não destrutivas;
3. classificar legado:
   - migrável: identidade externa comprovada;
   - fallback: número/fornecedor conhecidos, mas plataforma/conta ausentes;
   - revisão: ambiguidade, item sem identidade ou origem;
   - incompatível: relações impossíveis de conservar;
4. criar conta/plataforma `LEGACY_REVIEW` somente como estado técnico explícito, nunca fingindo Amazon/eBay;
5. backfill de compras, linhas e vínculos em transação/lotes;
6. comparar contagens, quantidades e materializações;
7. ativar shadow read do novo modelo para administradores;
8. ativar novo fluxo após métricas sem divergência crítica;
9. congelar escrita no legado;
10. remover estruturas antigas apenas em migration posterior e com autorização.

`CompraImportada.lojaId`, `fornecedorId`, `quantidade` agregada, `AtribuicaoItem` ambígua e `statusAtribuicao` atual exigem relatório de conversão. Pedidos atuais permanecem operacionais e podem receber vínculo legado; não serão rematerializados. Nenhum dado é descartado silenciosamente. Rollback reativa leitura/escrita legada enquanto novas tabelas permanecem preservadas para diagnóstico.

## 30. Contratos conceituais de API — staging

Todas as rotas abaixo exigem JWT e permissão global. Rotas com `{lojaId}` também exigem vínculo à loja.

| Método/rota sugerida | Finalidade | Input/saída | Idempotência/erros |
|---|---|---|---|
| POST `/imported-purchases` | importar/manual | identidade, cabeçalho, linhas → compra | key de importação; 409 identidade incompatível |
| GET `/imported-purchases` | listar | filtros globais → página | leitura |
| GET `/imported-purchases/:id` | detalhar | ID → compra, linhas, mappings, atribuições | 404 seguro |
| PATCH `/imported-purchases/:id/review` | abrir/concluir revisão | versão, decisão → estado | 409 versão |
| PATCH `/imported-purchases/:id` | corrigir campos permitidos | patch estrito + versão | auditoria; 409 identidade |
| PUT `/imported-purchases/:id/lines/:lineId/assignments/:lojaId` | atribuir | quantidade, versão | idempotente por estado desejado; 409 saldo |
| DELETE rota anterior | desatribuir | versão, motivo | bloqueada se materializada |
| PUT `/external-merchants/:id/mappings/:lojaId` | mapping fornecedor | fornecedorId, versão | 409 inválido/cross-store |
| PUT `/external-lines/:id/product-mappings/:lojaId` | mapping Produto | produtoId, versão | 409 inválido/cross-store |
| POST `/imported-purchases/:id/materializations/:lojaId` | materializar | idempotency key, versão | 200 existente/201 criado/409 pré-condição |
| GET mesma rota | resultado | vínculo/pedido/status | leitura |
| GET `/imported-purchases/:id/history` | auditoria | cursor → eventos | global |

Filtros de listagem: todas, Dronz, Gooder, pendentes, parcialmente atribuídas, prontas, materializadas, plataforma, conta, período, merchant e externalOrderId. “Todas” é staging global, não bypass de tenant operacional.

## 31. Contratos conceituais de API — UI-3C

Todas exigem JWT, `x-store-id`, vínculo e permissão específica.

| Método/rota sugerida | Finalidade | Contrato essencial |
|---|---|---|
| GET `/logistics/checkpoints/miami/candidates` | candidatos Miami | estado, itens, pendente, ações/bloqueios |
| GET `/logistics/checkpoints/miami/:id` | detalhe/histórico | DTO logístico sem valores proibidos |
| POST `/logistics/checkpoints/miami` | confirmar | item, quantidade, divergência, evidence?, key |
| GET `/logistics/checkpoints/paraguay/candidates` | candidatos | aplicabilidade, mala, viagem, ações |
| POST `/logistics/checkpoints/paraguay` | confirmar | mala, divergência, motivo/evidência, key |
| GET `/logistics/checkpoints/brazil/candidates` | candidatos | chegada e bloqueios |
| POST `/logistics/checkpoints/brazil` | confirmar | mala, divergência, key |
| GET `/receiving/candidates` | elegíveis | viagem, mala, itens e ações |
| GET `/receiving/:id` | conferência/histórico | progresso e divergências |
| POST `/receiving` | abrir | viagem, mala, key |
| POST `/receiving/:id/items/:itemId/confirmations` | confirmar item | recebida/rejeitada/divergência, key |
| GET `/receiving/definitive-entry/candidates` | elegíveis | quantidades aptas e bloqueios |
| POST `/receiving/definitive-entry` | incorporar | viagem, mala, key, confirmação |
| POST `/checkpoint-events/:id/corrections` | corrigir | motivo, patch permitido, versão |

GETs retornam ações permitidas; frontend não deriva máquina de estados. Erros de domínio: 400 payload, 401 token, 403 permissão, 404 tenant-safe, 409 transição/concorrência/idempotency mismatch, 422 divergência não resolvida.

## 32. Fluxos textuais

```text
COMPRA EXTERNA
Importação
→ deduplicação por plataforma+conta+externalOrderId
→ revisão
→ mapping de merchant por loja
→ mapping de Produto por loja
→ atribuição linha+quantidade+loja
→ revisão final
→ materialização explícita Dronz e/ou Gooder
→ Pedidos Operacionais separados
→ logística tenantada
```

```text
UI-3C
Pedido Operacional confirmado
→ recebimento Miami
→ consolidação/alocação em mala
→ checkpoint Paraguai quando aplicável
→ chegada Brasil
→ abertura de recebimento
→ conferência de itens
→ entrada definitiva
→ movimento ENTRY
→ estoque real
```

## 33. Cenários de aceite

1. Dada compra totalmente Dronz, materialização cria somente pedido Dronz.
2. Dada compra totalmente Gooder, cria somente pedido Gooder.
3. Dada compra dividida, cria um pedido por loja.
4. Linha de 10 atribuída 4/3 mantém 3 pendentes.
5. Quantidade pendente não impede salvar atribuição parcial.
6. Atribuição 6/5 sobre 10 rejeita integralmente a segunda operação.
7. Reimportação da mesma identidade não duplica compra.
8. Mesmo externalOrderId em contas diferentes cria compras distintas.
9. Mesmo externalOrderId em plataformas diferentes cria compras distintas.
10. Merchant sem mapping bloqueia a loja.
11. Item sem mapping de Produto bloqueia a loja.
12. Repetir materialização retorna o mesmo pedido.
13. Falha ao criar item reverte pedido e auditoria transacionais.
14. Gooder consultando pedido Dronz recebe 404.
15. Checkpoint fora de ordem recebe conflito e não cria evento.
16. Usuário sem permissão recebe 403 mesmo vinculado à loja.
17. Dupla confirmação com a mesma key retorna o mesmo evento; payload diferente conflita.
18. Evento corretivo preserva o original e registra antes/depois.
19. Entrada definitiva antes do Brasil é bloqueada e não altera estoque.
20. Entrada definitiva repetida não duplica `ENTRY`.
21. Conta inativa preserva histórico e bloqueia nova importação.
22. Linha ambígua por fallback fica em divergência.
23. Mapping alterado durante materialização causa rollback.
24. Usuário de uma loja não vê atribuição da outra no contexto operacional.
25. CSV neutraliza fórmula maliciosa e preserva moeda.

## 34. Riscos e critérios de aceite dos próximos batches

Riscos principais: migração de atribuições ambíguas, implementação ainda inexistente da autorização global, duplicação de estoque entre confirmação e entrada definitiva e checkpoints ainda sem read models/RBAC. A aplicabilidade do Paraguai está resolvida por rota; o Batch 3 deverá migrar a exigência universal atual sem perder histórico.

P-03 e P-05 estão fechadas e não bloqueiam mais o Batch 3. P-01, P-02, P-06 e P-07 estão fechadas e não bloqueiam o desenho do Batch 5. Critério comum: schema/migrations reproduzíveis, contratos tenant-safe, auditoria, idempotência, concorrência e testes PostgreSQL reais.

## 35. Decisões de produto aprovadas

| ID | Decisão normativa | Impacto de implementação | Status |
|---|---|---|---|
| P-01 | Staging completa somente para `SUPER_ADMIN` e perfil global dedicado a Compras Unificadas, com permissões globais; usuários comuns veem apenas operação da loja autorizada. | RBAC global no Batch 5/6 | APROVADA |
| P-02 | Materialização independente por loja pronta, mesmo com outra loja incompleta ou saldo pendente; UI apresenta processamento parcial. | estados e idempotência no Batch 5/6 | APROVADA |
| P-03 | Cada rota declara checkpoints obrigatórios; Paraguai é exigido somente quando aplicável e, nas demais rotas, fica `NAO_APLICAVEL`. | máquina UI-3C no Batch 3/4 | APROVADA |
| P-04 | Após entrada definitiva, correção somente por evento corretivo e movimento compensatório, com motivo, permissão e histórico imutável. | correções no Batch 3/4 | APROVADA |
| P-05 | RBAC granular aprovado para staging, mappings, Miami, Paraguai, Brasil, recebimento, entrada definitiva e correções. | supera a proibição anterior somente nesses fluxos | APROVADA |
| P-06 | Compra manual usa ID técnico, `MANUAL`, origem/conta manual, referência pesquisável não globalmente única e chave técnica de idempotência. | identidade no Batch 5/6 | APROVADA |
| P-07 | Antes de downstream, cancelamento/ajuste transacional auditado; depois, somente correção e compensação sem apagar histórico. | lifecycle no Batch 5/6 | APROVADA |
| P-08 | “Quinta-feira de manhã” permanece janela não computável até o Product Owner definir início, fim, timezone e efeito de alerta ou bloqueio. | bloqueia somente alerta horário correspondente no Batch 7 | PENDENTE NÃO BLOQUEADORA PARA BATCH 3 |

Quantidade inteira está fechada tecnicamente para Produtos físicos. Fallback de linha externa está fechado por fingerprint versionado com revisão de ambiguidades. Nenhuma decisão técnica essencial permanece aberta.

## 36. Resolução explícita de conflitos

1. `AGENTS.md` diz que toda entidade comercial preserva `lojaId`; a staging é exceção funcional confirmada: entidades globais não possuem loja, mas atribuições e operação preservam destino. O princípio de isolamento continua absoluto após materialização.
2. `domain-contracts.md` permite `ENTRY` a cada confirmação de recebimento; este contrato exige estoque apenas na entrada definitiva. O Batch 3 deve consolidar uma única fonte de entrada para impedir duplicidade.
3. `domain-contracts.md` proíbe RBAC novo; P-05 supera essa regra exclusivamente para as permissões granulares listadas neste contrato.
4. Código atual exige Paraguai em toda entrada definitiva; P-03 determina que a exigência seja derivada dos checkpoints obrigatórios da rota, usando `NAO_APLICAVEL` fora dela.
5. `FLUXOS_OPERACIONAIS_V1.md` chama compras/logística de futuras; é histórico da fundação e está superado pelo código e `domain-contracts.md`.
6. `GAPS_E_DIVERGENCIAS_V2.md` confirma perfil Miami e ocultação financeira; isso foi incorporado à matriz-alvo.

## 37. Lacunas do briefing fora dos Batches 3–7

O briefing-fonte integral não foi localizado no repositório, no histórico pesquisável nem nos arquivos fornecidos. A única fonte disponível é uma enumeração resumida de temas no pedido de revisão. Por isso, a cobertura detalhada está em `docs/MATRIZ_COBERTURA_BRIEFING_V1.md`; itens sem requisito verificável permanecem `NÃO LOCALIZADO` e não são incorporados por suposição.

| Batch futuro proposto | Objetivo | Dependências | Risco | Prioridade | Aceite mínimo |
|---|---|---|---|---|---|
| Integrações de compras | Conectores de plataforma/conta e ingestão automatizada | contrato do Batch 5, arquitetura de segredos | alto | posterior | importação idempotente, auditada e sem segredo em domínio |
| Documentos e evidências | Armazenar comprovantes e evidências com autorização | storage S3, política de retenção | médio | posterior | upload tenant-safe, metadados e auditoria |
| Pagamentos e conciliação | Evoluir pagamentos manuais para integrações aprovadas | arquitetura financeira e providers | alto | posterior | reconciliação idempotente e segregada por loja |
| Tracking automático e alertas | Consumir eventos de transportadoras e gerar alertas | contas externas, timezone e P-08 quando aplicável | alto | posterior | eventos fora de ordem tratados e alertas auditáveis |
| Responsabilidades operacionais | Vincular papéis a atividades sem hardcode de pessoas | definição formal do Product Owner | médio | posterior | RBAC por função, nenhuma regra baseada em nome pessoal |

## 38. Status do contrato

Parte técnica: completa e pronta para implementação.

P-01 a P-07 estão aprovadas e incorporadas. P-08 permanece decisão exclusiva do Product Owner, mas não bloqueia o Batch 3 nem qualquer endpoint que não calcule atraso por horário de quinta-feira.

Gate documental: Batch 3 liberado. Batch 5 possui decisões essenciais fechadas, sujeito ao gate normal de conclusão dos Batches 3 e 4 e à estratégia segura de migration.
