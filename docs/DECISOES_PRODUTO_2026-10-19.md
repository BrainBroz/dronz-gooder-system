# Direção operacional e econômica aprovada — 2026-10-19

## Autoridade e estado

Fonte: decisões expressas pelo Product Owner em 2026-10-19, após avaliação do preview da branch `claude/ui-bolt-etapa1`, HEAD `e4e243b`.

O visual da Etapa 1 foi aprovado. Esse aceite não declara concluídas as jornadas internas, as importações ou as integrações. Este documento registra requisitos aprovados para as próximas entregas; não declara novas capacidades implementadas. Complementa as decisões de 2026-10-17 e 2026-10-18 e os contratos existentes, preservando isolamento por loja, auditoria, idempotência e entrada definitiva de estoque. Em aspectos econômicos explicitamente revistos aqui, a nova decisão substitui a orientação anterior somente na futura implementação; valores e eventos históricos não são recalculados silenciosamente.

O Bolt é a referência principal de organização e aparência. Seu código de demonstração não é fonte de autorização, fórmulas oficiais, saldos ou histórico realizado.

## Decisões aprovadas

### OP-01 — Jornada principal de Compras

- A área principal responde: o que foi comprado, quando, para qual loja, de quem, quanto custou, preço de venda projetado, resultado estimado e localização/situação comprovada.
- Oferecer todas as compras e agrupamento por mês de competência, com detalhe dos pedidos e itens. O agrupamento mensal é uma apresentação comercial, não um lote patrimonial nem uma remessa física.
- Revisão de importações é uma tarefa secundária. Exibir linguagem operacional: identificar produto, definir loja e quantidade, revisar divergência e registrar pedido. Os contratos de mapping, atribuição e materialização permanecem no backend.
- Remover da experiência principal repetições de contadores e promessas como "Disponível na fase econômica". Capacidade ausente é informada no seu contexto, sem fingir valor ou operação disponível.

### OP-02 — Duas fases econômicas independentes

| Fase | Finalidade | Fonte e tratamento |
| --- | --- | --- |
| Estimativa | Decidir a compra e projetar o resultado por produto, compra e mês | Preço de venda esperado, câmbio de referência e parâmetros identificados; alterações de promoção ou preço atualizam a projeção com rastreabilidade |
| Realizado | Apurar o resultado da venda efetivamente ocorrida | Valores finais confirmados, provenientes de entrada controlada, planilha ou futura integração ERP/Tiny; não substituir pela projeção |

- Preço projetado e venda final são campos/conceitos distintos. Promoções, descontos e encargos efetivos podem produzir resultado diferente do estimado.
- Dashboards, relatórios e detalhes rotulam explicitamente estimado e realizado e respeitam o mesmo período, moeda e escopo de loja.
- Compra, estoque, venda e recebimento financeiro continuam fatos diferentes; uma projeção não confirma nenhum deles. Resultado de venda e liquidação financeira também não são sinônimos.
- Apresentar a composição: compra, câmbio, frete, encargos de compra, custos da venda, nota, receita líquida, resultado e definição de markup/margem. Não reutilizar o mesmo nome para indicadores com bases diferentes.
- Custo ou encargo indispensável ausente deixa o resultado incompleto/não calculável, com motivo. Ausência não equivale a zero.

### OP-03 — Venda recebida líquida das taxas do canal

O PO informou que a fonte Mercado Livre/ERP/planilha fornecerá o valor final já descontado das taxas do Mercado Livre, ainda faltando descontar a nota fiscal.

- Representar explicitamente a natureza do valor recebido: bruto ou líquido do canal, com fonte e quais encargos já foram descontados.
- Na modalidade descrita pelo PO, não descontar novamente a taxa projetada de marketplace. A taxa estimada de 16% não é aplicada ao valor que já chega líquido dessa taxa.
- Encargos adicionais só são descontados se ainda não estiverem incluídos na fonte e sua natureza estiver comprovada. Não presumir o tratamento de frete, estorno, reembolso ou desconto só pelo nome de uma coluna.
- Resultado realizado, quando completo: valor líquido do canal menos nota fiscal, demais encargos ainda não deduzidos e custo efetivo das unidades vendidas. Cálculo autoritativo no backend, com a origem de cada componente.
- Preservar o bruto quando fornecido; não reconstruí-lo por inversão de uma taxa presumida. Sem bruto/base fiscal suficiente, não calcular a nota sobre o líquido por conveniência: indicar a pendência até obter o valor/base correto.
- A implementação exige adaptar/validar o contrato atual de Vendas: hoje `saleView` recebe preço bruto e desconta os encargos informados. Não enviar o líquido como se fosse bruto e reaplicar taxas.

### OP-04 — Parâmetros econômicos e câmbio

- Referência de taxa parcelada informada pelo PO: 16%. O PO mencionou parcelamento em duas vezes e uso frequente de doze vezes. Quantidade de parcelas e taxa são parâmetros explícitos; a confirmação não autoriza tratar 16% como tarifa universal para qualquer plano ou canal. A matriz por plano será validada com a fonte antes de sua ativação.
- Nota fiscal de saída: referência de 5%, substituindo os 8% do protótipo para a futura parametrização. A base de incidência deve estar explícita; não presumir que é o líquido recebido do marketplace. Dados efetivos importados prevalecem sobre estimativa quando comprovados.
- Referência à vista de 12% e acréscimo cambial operacional de R$ 0,20 foram informados pelo PO na descrição da jornada. São parâmetros de projeção, não encargos realizados inferidos.
- Implementar cotação automática com fonte, tipo de cotação, par USD→BRL e instante; mostrar referência e acréscimo separadamente e somar o acréscimo uma única vez. O registro manual continua como fallback identificado.
- Câmbio associado à compra deve distinguir referência estimada da taxa efetivamente paga. Ingestão tardia não pode usar a cotação de hoje fingindo ser a da data da compra. Sem fonte histórica, sinalizar a falta.
- Alterar a configuração não reescreve o custo de compras ou vendas antigas. Cada operação preserva os parâmetros e a cotação usados.
- Custo por kg deve declarar sua moeda. O Bolt rotula R$/kg, mas `calcPurchaseItem` o usa como US$/kg: essa inconsistência não será portada.
- Fonte cambial, modalidade comercial/compra/venda e matriz completa de taxas dependem de especificação técnica e prova das fontes; não inferir regras tributárias ou tarifas oficiais destes percentuais operacionais.

### OP-05 — Importação de vendas históricas

- Permitir importar Excel de meses passados; ERP/Tiny são fontes futuras adicionais, não pré-requisitos para a importação manual controlada.
- O arquivo real orienta o mapeamento explícito de abas, colunas, moeda, datas, loja, produto/variante, quantidade, identidade da venda e natureza dos valores. Não afirmar que o sistema aprende a semântica correta apenas pelo nome da coluna.
- Fluxo: selecionar arquivo → mapear/conferir campos → preview validado → resolver pendências → comparar totais por mês/loja/moeda → confirmar importação → consultar resultado e rejeições.
- Preservar origem, referência da linha, campos originais necessários, hash, ator, instante e decisões de conciliação, sem armazenar segredos ou dados pessoais desnecessários.
- Reimportar o mesmo conteúdo não duplica vendas; payload divergente para a mesma identidade gera conflito/revisão, não sobrescrita silenciosa. Ausência de ID estável exige estratégia explícita de identificação e decisão humana para duplicidades suspeitas; índice da linha ou título não é identidade de negócio.
- Importar uma venda antiga não executa automaticamente a confirmação operacional atual, não cria saída no estoque de hoje e não recria entrada histórica. Vínculo com estoque/custo legado exige reconciliação própria e auditável.
- Venda histórica sem custo comprovado pode compor o histórico de vendas/receitas confirmadas, mas seu lucro fica indisponível e identificado como custo pendente. Não herdar o custo atual do produto.
- Cancelamentos, devoluções, reembolsos e estornos mantêm evidências e tratamento separado. Não somar cancelado ao realizado nem apagar o evento original.

### OP-06 — Catálogo a partir do Bolt ou Excel

- O PO reconhece a base de produtos fornecida no Bolt como material real de seu catálogo. Ela pode ser uma fonte inicial, assim como uma planilha própria.
- Separar cadastro de produtos dos saldos, preços e históricos existentes no protótipo. Aprovar a importação do catálogo não aprova transformar todos os seus números em estoque ou fato financeiro.
- Preservar identificação externa/legada quando disponível e vínculo com a loja. Não cruzar catálogos ou permissões de lojas indevidamente.
- Tratar diferenças de grafia e abreviações como sugestões de correspondência revisáveis. Cor, capacidade, tamanho, modelo, geração e outras variantes relevantes não podem desaparecer na normalização.
- Conservar nome original e aliases aprovados para busca; não fundir produtos apenas por semelhança textual nem deduzir uma variante sem evidência. Não implementar matching por IA sem escopo próprio.
- Preview deve separar produtos novos, correspondências confirmadas, variantes distintas e conflitos. Confirmação é explícita e reimportação idempotente.
- Ao lançar ou revisar uma compra, digitar parte do nome (por exemplo "Mac") deve oferecer os produtos existentes autorizados, mostrando diferenças suficientes para escolher a variante correta. Cadastro novo é contextual e não a rotina obrigatória.

### OP-07 — Operação, dashboard e relatórios

- A organização-alvo conserva a familiaridade do Bolt: Compras mensais, simuladores, Miami/disponibilidade, montagem de caixas, remessas, viajantes, estoque Brasil, Produtos, Financeiro e Relatórios.
- Montagem de caixa é uma tela de trabalho: itens disponíveis por posição e loja → selecionar quantidade → reservar/compor caixa → acompanhar peso/pendências → fechar e entregar. Reutilizar os controles existentes, sem exigir que o operador compreenda as tabelas Viagem/Mala/Volume.
- Visão Todos exige agregação autorizada no backend, sem expor outra loja a quem não possui acesso. Consolidar não mistura os estoques nem soma moedas diferentes sem conversão definida.
- Dashboard deve reunir indicadores de compra, projeção, vendas realizadas, estoque e logística com período e definições claros. Seções técnicas de revisão ficam contextualizadas.
- A ativação de eBay, e-mail, ERP/Tiny e transportadoras permanece separada; os fluxos manuais e a importação controlada precisam funcionar antes dela.

## Sequência de entrega

| Frente | Entrega verificável | Dependências |
| --- | --- | --- |
| D1 — contratos econômicos e configurações | Valores bruto/líquido, taxas incluídas, projeção/realizado e parâmetros inequívocos; preservação de snapshots | Decisões acima; validar parcelas, base fiscal e unidade do frete antes de ativar cálculo |
| D2 — catálogo e simuladores | Busca por produto/variante, importação revisável do cadastro, simulação de compra e tela de simulação de viagem | D1; arquivos reais para validar importação; reutilizar e testar fórmulas oficiais |
| D3 — compras mensais | Todas as compras, agrupamento mensal, detalhe econômico e físico e revisão contextual | D1/D2; read models por loja e globais autorizados |
| D4 — operação física | Miami, montagem de caixas, remessas, viajantes e estoque Brasil em telas dedicadas | Reutilização do domínio já implementado; dados rastreáveis |
| D5 — histórico de vendas e resultado | Importação Excel, conciliação de produtos/custos, resultado realizado sem taxa duplicada e relatórios | D1/D2; amostra real das vendas; sem efeitos automáticos no estoque atual |
| D6 — visão gerencial integrada | Dashboard/relatórios por mês e Todos/Dronz/Gooder, estimado separado do realizado | Read models reais de D3/D4/D5; autorização e moedas explícitas |

São frentes de escopo, não uma declaração de implementação. A especificação de cada entrega deve mostrar dados, ações, erros e aceite no navegador. Não há autorização implícita de push, merge ou alteração do banco operacional neste registro.

## Provas mínimas para as próximas implementações

1. Venda importada já líquida não sofre novo desconto de marketplace; nota e custo aparecem separados.
2. Alterar a projeção não altera venda realizada, e mudar taxas atuais não recalcula snapshots históricos.
3. Importação repetida não duplica; conflito e linha inválida aparecem no preview com decisão rastreável.
4. Venda antiga importada não gera movimento no estoque atual; custo histórico ausente não produz lucro fictício.
5. Grafias diferentes podem apontar ao mesmo cadastro por decisão humana; variantes realmente diferentes permanecem distinguíveis.
6. Compra por mês conserva competência e todas as parcelas das lojas sem duplicar pedido, quantidade ou valor.
7. Todos/Dronz/Gooder respeita a identidade, o período e a moeda em indicadores, tabelas e exportações.
8. Sem fonte, cotação ou permissão, a UI mostra a condição real e não substitui a ausência por um número de demonstração.

## Dependências para homologação

Uma amostra da planilha de vendas e da planilha de produtos, com suas colunas e moedas, será necessária antes de fechar o mapeamento e homologar os importadores. A arquitetura do fluxo de preview e validação pode ser preparada sem inventar essas colunas. Nenhuma credencial deve ser enviada em planilha ou incluída na documentação.
