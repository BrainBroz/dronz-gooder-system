# Configurações econômicas e Simulador de compra — V1

Estado: implementado na branch `claude/economic-settings-simulator` (a partir de `b047258`). Fonte das decisões: `DECISOES_PRODUTO_2026-10-19.md` (OP-02, OP-03, OP-04, OP-06) e `domain-contracts.md` (Financeiro). Este documento separa o que está implementado do que ainda depende de confirmação.

## 1. Escopo implementado

- **Configurações econômicas** (`/configuracoes`; API `/economic-settings`): parâmetros de estimativa por loja, versionados. Cada gravação cria uma versão nova (`ParametroEconomico.versao`); as anteriores ficam intactas. Gravação auditada (`SAVE_ECONOMIC_SETTINGS`) e idempotente (`Idempotency-Key`).
- **Câmbio**: reutiliza `CotacaoCambio` (referência `valorMercado`, acréscimo `margem`, operacional `valor = referência + acréscimo`). A tela mostra moedas, referência, acréscimo, operacional, fonte, instante e condição (vigente, antiga após 7 dias, indisponível). Registro manual pelo endpoint existente `/finance/exchange-rates` e captura automática do dólar comercial do dia (seção 4).
- **Simulador de compra** (`/compras/simulador`; API `/purchase-simulations`): projeção por produto do catálogo da loja (busca por nome, com código, categoria e peso para distinguir variantes) ou item ainda sem cadastro; cálculo no backend a cada alteração; salvar e reabrir simulações com a entrada resolvida e o resultado como snapshot (lista paginada, `page`/`limit` até 100). O formulário fixa a versão de parâmetros vigente ao abrir: limite de markup e taxas de marketplace oferecidas vêm só dessa versão, então a taxa enviada sempre pertence ao `parametroEconomicoId` gravado; uma versão nova vale para a próxima abertura. Com a nota em "% sobre uma base informada" e a base ainda vazia, a nota segue como pendente e o restante é calculado. Simular não cria compra, pagamento, venda, estoque nem movimento logístico (coberto por teste).
- **Fórmula protegida**: `calcSimulacao` corresponde a `calcularSimulacao` (`modules/simulation/simulation.service.ts`, simulação de viagem). Não foi alterada nem reutilizada: a projeção de compra é a função nova `projectPurchase` (`modules/purchase-simulation/purchase-projection.ts`). `calcPurchaseItem` do Bolt não foi copiado.

## 2. Permissões (reutilizadas, sem papéis novos)

| Ação | Permissão |
|---|---|
| Ler parâmetros e cotação vigente | `FINANCEIRO_VISUALIZAR` ou `SIMULACAO_VISUALIZAR` |
| Gravar parâmetros, capturar o dólar do dia, registrar cotação | `FINANCEIRO_REGISTRAR` |
| Calcular, listar e abrir simulações | `SIMULACAO_VISUALIZAR` ou `SIMULACAO_GERENCIAR` |
| Salvar simulação | `SIMULACAO_GERENCIAR` |
| Buscar produto | `CATALOGO_VISUALIZAR` (sem ela, a tela pede o nome do item) |

Tudo é escopado por `x-store-id`: produto, cotação, versão de parâmetros e simulação de outra loja respondem 404.

Idempotência: salvar simulação, gravar parâmetros e capturar o dólar aceitam `Idempotency-Key`. A repetição de um envio já gravado devolve o registro antes de consultar o estado atual (produto, cotação ou fonte externa). No `idempotentMutation` compartilhado, uma requisição idêntica que perde a corrida por conflito de serialização também recebe a resposta gravada, em vez de `409 concurrent_modification`; sem gravação concorrente idêntica, o 409 continua.

## 3. Fórmulas e unidades

Resultado em BRL. Decimal no backend, precisão total no cálculo; arredondamento `HALF_UP` só na saída (dinheiro 2 casas, cotação 6, percentuais 2, peso 3). Totais = valor unitário em precisão total × quantidade.

```text
câmbio_operacional = referência + acréscimo            (USD→BRL, acréscimo somado uma única vez)
                     (acréscimo não informado → pendência; zero só quando informado)
conv(v, moeda)     = v                  se BRL
                   = v × câmbio_operacional  se USD    (sem cotação: valor não calculável, nunca zero)

compra_u           = conv(preço_compra_u, moeda_compra)
frete_u            = conv(frete_por_kg × peso_u, moeda_do_frete)   (a moeda do frete é declarada)
encargos_compra_u  = Σ { % × compra_u | conv(valor_u) | conv(valor_total) ÷ qtd }
custo_u            = compra_u + frete_u + encargos_compra_u

taxa_marketplace_u = venda_bruta_u × taxa%            (zero só se "sem taxa de canal" for escolhido; taxa não informada → pendência)
nota_u             = venda_bruta_u × nota%            (base: preço de venda bruto)
                   | base_informada_u × nota%         (base informada)
                   | valor informado
                   | pendente                         (base não definida → resultado incompleto)
outros_venda_u     = Σ { % × venda_bruta_u | valor_u | valor_total ÷ qtd }
receita_líquida_u  = venda_bruta_u − (taxa_marketplace_u + nota_u + outros_venda_u)
lucro_u            = receita_líquida_u − custo_u

markup%   = (preço_venda − custo_u) ÷ custo_u × 100          (definição do contrato)
margem%   = (preço_venda − custo_u) ÷ preço_venda × 100      (definição do contrato)
resultado sobre a venda% = lucro_u ÷ venda_bruta_u × 100     (nome próprio, base diferente)
resultado sobre o custo% = lucro_u ÷ custo_u × 100
alerta    = markup% < limite configurado (≥ 25%: o piso do contrato não pode ser reduzido)
```

Preço de venda zero é "a definir": sem markup, margem nem divisão por zero. Custo ou encargo indispensável ausente deixa o resultado `INCOMPLETO`, com a lista de pendências; o custo continua visível quando calculável.

O defeito do protótipo (tela em R$/kg, cálculo em US$/kg) não se repete: o frete sempre carrega a moeda, e R$/kg não é convertido.

## 4. Fonte do câmbio

Decisão do PO em 20/10/2026: a referência é o **dólar comercial do dia**, mais R$ 0,20 (acréscimo), sempre. A PTAX do Banco Central foi a primeira fonte implementada (19/10) e foi substituída.

Fonte atual: gráfico público do Yahoo Finance (`USDBRL=X`), sem cadastro nem credencial, que traz a cotação de mercado do dólar comercial, a mesma que os sites de câmbio mostram. Não há ponta de venda separada: o valor é o preço de mercado. É um endpoint **não oficial**; se mudar ou bloquear, a captura falha com `dolar_indisponivel` e o registro manual continua disponível. A AwesomeAPI foi testada e respondeu 429 sem chave.

Implementado: ao abrir Configurações econômicas ou o Simulador de compra, se a cotação vigente não for de hoje (horário de Brasília) e o usuário puder registrar (`FINANCEIRO_REGISTRAR`), a tela pede `POST /economic-settings/exchange-rate/dolar`. Uma cotação por dia por loja, gravada como `CotacaoCambio` com fonte `Dólar comercial - Yahoo Finance (USD/BRL)` e o acréscimo vigente. Com `Idempotency-Key`, uma repetição devolve o registro já gravado antes de consultar a fonte; a mesma chave com outro conteúdo é conflito. Falha da fonte não grava nada. O botão "Atualizar dólar comercial do dia" tenta de novo.

A cotação estimada não comprova a taxa efetivamente paga, e uma compra histórica não deve receber a cotação de hoje. A ausência de acréscimo gravado bloqueia a captura (`acrescimo_cambial_nao_configurado`).

## 5. Parâmetros que dependem de confirmação

- **Referências do PO (20/10/2026)**, pré-preenchidas e aplicadas só depois de gravadas por um usuário: acréscimo R$ 0,20; nota fiscal 5% sobre a venda bruta; taxa de 16% no parcelado (Mercado Livre); frete US$ 90/kg, editável; alerta de markup 30% (o mínimo do contrato continua 25%). A taxa à vista de 12% ficou fora da simulação de compra por ora. Percentuais de taxa e nota servem só à projeção; o resultado real vem da venda registrada.
- **Número de parcelas do plano de 16%**: ainda não informado; a taxa exige escolher 2, 12 ou outra quantidade.
- A viagem (mala) tem outra lógica de cálculo e fica fora deste simulador.


## 5.1 Pendências da revisão local

As duas pendências registradas no encerramento do ciclo de revisão (`7787dc2`) foram resolvidas, com testes de regressão:

1. **Repetição após resposta perdida e atualização em segundo plano**: a gravação de parâmetros guarda a tentativa ainda não confirmada (conteúdo e chave). Repetir o mesmo conteúdo reutiliza a chave original mesmo depois de um refetch que mudou a versão de base, e o servidor devolve a versão já gravada. Depois de um sucesso confirmado, uma nova gravação volta a usar a chave por conteúdo e versão de base, distinguindo operação deliberada de repetição.
2. **Registro manual de cotação durante o envio**: os campos e o botão ficam desabilitados enquanto o registro está pendente e voltam a aceitar edição ao terminar.

## 6. Estimado e realizado

O simulador produz apenas `natureza: "ESTIMATIVA"`. A venda realizada (futura importação) deve preservar os valores finais da fonte. Valor recebido do Mercado Livre/ERP que já chega líquido das taxas do canal **não** pode sofrer novo desconto da taxa projetada; a nota fiscal não é aplicada sobre o líquido por conveniência. Projeção e realizado ficam em contratos e telas separados.

## 7. Fora desta entrega

Importação do catálogo Bolt/Excel (OP-06), importação de vendas, integração Tiny/ERP, simulador de viagem, mudanças em Vendas e reconstrução das demais telas. No banco de preview desta branch (`dg_sim_preview`) foram cadastrados, pela API de Produtos, alguns itens do catálogo do Bolt da Gooder (sem peso nem preço) para testar a busca; não fazem parte de migration nem de seed.
