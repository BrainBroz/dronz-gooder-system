# Compras Unificadas — Frontend V1

Implementação técnica concluída e aprovada no Batch 6, commit `968b2bf`, subordinada ao `AGENTS.md`, ao contrato `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md` e ao backend descrito em `COMPRAS_UNIFICADAS_BACKEND_V1.md`. Gate: **APROVADO**.

## Escopo

A rota `/compras` apresenta a staging global de compras externas. A rota `/pedidos` continua separada e passa a ser identificada como **Pedidos Operacionais**. A fila de compras não altera estoque, logística, checkpoints, financeiro ou pedidos já materializados. A página separada de Pedidos Operacionais permite envio e confirmação usando exclusivamente as transições devolvidas pelo backend.

## Fonte de verdade

- `allowedActions` retornado pelo backend é a única fonte para ações contextuais.
- `blockedReasons`, progresso, estado, conflitos e histórico são exibidos sem reconstrução de regra no cliente.
- Permissões da sessão protegem o acesso geral e a criação de recursos que ainda não possuem um read model contextual.
- Toda mutação é revalidada pelo backend; a presença de botão não constitui autorização.

## Fluxos disponíveis

- visão geral e listagem paginada;
- filtros suportados pela API: estado, plataforma, conta, merchant, referência, período e loja;
- detalhe com itens, atribuições, mappings, materializações, conflitos e histórico;
- cadastro de conta externa e merchant;
- registro controlado de compra externa;
- compra manual em USD;
- atribuição quantitativa e remoção de atribuição;
- mapping de produto e fornecedor por loja;
- materialização independente por loja;
- resolução de conflito.

Todas as mutações usam uma chave de idempotência por tentativa. Operações por loja enviam `x-store-id` e somente utilizam lojas vinculadas à identidade carregada.

## Cache e isolamento

As queries de staging possuem namespace próprio. Detalhes usam o ID da compra; produtos e fornecedores usam `storeId`. Após uma mutação de compra, somente overview, listas e o detalhe afetado são invalidados; o histórico integra o detalhe oficial. Cadastro isolado de conta ou merchant não invalida a staging porque a API V1 não publica suas listagens. A troca de loja em formulários limpa seleções incompatíveis.

## Limitações contratuais mantidas

O backend V1 não oferece endpoints de listagem de contas externas ou merchants. Por isso:

- os cadastros existem e devolvem o ID criado;
- importação e compra manual aceitam IDs conhecidos;
- os campos de conta e merchant oferecem sugestões derivadas das compras já carregadas; na importação, as sugestões são filtradas pela plataforma selecionada;
- quando o ID não está nas sugestões, a interface permite informá-lo manualmente;
- a limitação de não haver uma listagem dedicada continua informada na interface.

Também não há endpoint exclusivo de pendências nem filtros derivados para “parcialmente atribuída” ou “materializada”. A UI usa apenas os filtros aceitos e mostra os progressos devolvidos pelo backend. Quantidade elegível ou pendente por item não é recalculada localmente.

## Normalização externa

O frontend transmite plataforma, conta, referência, IDs externos, Unicode e caixa conforme digitados. A normalização e deduplicação são responsabilidades do backend e estão implementadas no serviço de Compras Unificadas. O teste de regressão do frontend comprova a preservação do payload sem duplicar essa regra no cliente.

## Testes

Os testes comportamentais em jsdom cobrem:

- overview, lista, vazio, erro e retry;
- filtros e visão por loja;
- ausência de ação sem `allowedActions`;
- atribuição, mapping, materialização e conflito;
- header de loja, versões e idempotência;
- isolamento de produtos por loja;
- criação de conta e compra externa;
- preservação de Unicode e caixa;
- bloqueio sem permissão global e retirada de dados após perda de acesso.

## Fora de escopo

Ingestão automática por e-mail/documentos/CSV, APIs externas, listagem de contas/merchants, matching automático, Dashboard, Relatórios, UI-3C e qualquer mutação de estoque, logística ou financeiro. Tracking futuro será consumido por domínio independente da fonte e não será inferido pelo frontend de Compras Unificadas.

## Correção verificada na jornada local — 2026-10-16

O drawer novo havia omitido o mapping merchant–fornecedor existente no detalhe anterior. `SupplierMappingForm` agora é compartilhado pelas duas apresentações, visível somente com `SET_SUPPLIER_MAPPING` no read model. Reutiliza `GET /suppliers` com query key/header da loja e a mutação existente de mapping, que invalida overview, listas e detalhe. Trocar a loja limpa a seleção anterior; falha no catálogo impede envio e permite retry.

O diálogo de materialização lê o código `error` efetivamente enviado pela API. `supplier_mapping_required` orienta a configurar o vínculo; somente `concurrent_modification` dispara atualização do detalhe. O resumo confirmado usa as quantidades do pedido operacional retornado pela API, inclusive em retry que encontra materialização existente; não reutiliza a estimativa anterior ao envio. Se a resposta não trouxer itens verificáveis, informa que o resumo está indisponível. Sucesso mantém a confirmação aberta e desabilita novo envio; uma requisição pendente não aceita fechamento por ESC ou submissão duplicada.

Se a atribuição mudar com o diálogo aberto, o resumo acompanha o detalhe atualizado antes do envio. Após sucesso, os números são os do pedido operacional retornado, não a cópia antiga da abertura ou do formulário.

`fullyAssigned` permanece no painel Economia como “Itens totalmente atribuídos”. O card de atenção usa `awaitingMaterialization` como “Atribuídos não materializados” e convida a revisar, sem prometer elegibilidade; a API remove a ação de materializar quando não há atribuição pendente. A elegibilidade completa continua revalidada na mutação, sem inferir mappings de fornecedor ausentes do read model.

Oito regressões comportamentais foram acrescentadas em `purchase-mutations.behavior.test.tsx`: request de mapping e invalidações; troca de loja; ausência de ação sem autorização do read model; erro/retry do catálogo; erro de fornecedor; conflito de versão com refetch; sucesso com resumo removido do detalhe; bloqueio de ESC e duplo envio durante mutação. Os testes existentes foram preservados.

A prova manual materializou duas unidades fictícias pela UI. A página de Pedidos Operacionais passou a usar `allowedStatusTransitions` nas leituras e o endpoint de status já existente; o pedido avançou por `DRAFT → PLACED → CONFIRMED` e apareceu em Miami com duas unidades pendentes. Não houve confirmação de recebimento físico nem entrada em estoque. O fornecedor legado do seed agora é aceito pelo mapping após validação de loja; os limites da homologação estão em [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
