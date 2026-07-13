# Compras Unificadas — Frontend V1

Implementação técnica concluída e aprovada no Batch 6, commit `968b2bf`, subordinada ao `AGENTS.md`, ao contrato `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md` e ao backend descrito em `COMPRAS_UNIFICADAS_BACKEND_V1.md`. Gate: **APROVADO**.

## Escopo

A rota `/compras` apresenta a staging global de compras externas. A rota `/pedidos` continua separada e passa a ser identificada como **Pedidos Operacionais**. A interface não altera estoque, logística, checkpoints, financeiro ou pedidos já materializados.

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
- nenhum select ou dado fictício é criado;
- a limitação é informada na interface.

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

Integração real com providers, sincronização automática, listagem de contas/merchants, matching automático, Dashboard, Relatórios, UI-3C e qualquer mutação de estoque, logística ou financeiro. Tracking futuro será consumido por domínio independente e não será inferido pelo frontend de Compras Unificadas.
