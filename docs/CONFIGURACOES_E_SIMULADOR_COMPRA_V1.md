# Configurações econômicas e Simulador de compra — V1

Estado: implementado na branch `claude/economic-settings-simulator` (a partir de `b047258`). Fonte das decisões: `DECISOES_PRODUTO_2026-10-19.md` (OP-02, OP-03, OP-04, OP-06) e `domain-contracts.md` (Financeiro). Este documento separa o que está implementado do que ainda depende de confirmação.

## 1. Escopo implementado

- **Configurações econômicas** (`/configuracoes`; API `/economic-settings`): parâmetros de estimativa por loja, versionados. Cada gravação cria uma versão nova (`ParametroEconomico.versao`); as anteriores ficam intactas. Gravação auditada (`SAVE_ECONOMIC_SETTINGS`) e idempotente (`Idempotency-Key`).
- **Câmbio**: reutiliza `CotacaoCambio` (referência `valorMercado`, acréscimo `margem`, operacional `valor = referência + acréscimo`). A tela mostra moedas, referência, acréscimo, operacional, fonte, instante e condição (vigente, antiga após 7 dias, indisponível). Registro manual pelo endpoint existente `/finance/exchange-rates` e captura PTAX sob demanda (seção 4).
- **Simulador de compra** (`/compras/simulador`; API `/purchase-simulations`): projeção por produto do catálogo da loja (busca por nome, com código, categoria e peso para distinguir variantes) ou item ainda sem cadastro; cálculo no backend a cada alteração; salvar e reabrir simulações com a entrada resolvida e o resultado como snapshot. Simular não cria compra, pagamento, venda, estoque nem movimento logístico (coberto por teste).
- **Fórmula protegida**: `calcSimulacao` corresponde a `calcularSimulacao` (`modules/simulation/simulation.service.ts`, simulação de viagem). Não foi alterada nem reutilizada: a projeção de compra é a função nova `projectPurchase` (`modules/purchase-simulation/purchase-projection.ts`). `calcPurchaseItem` do Bolt não foi copiado.

## 2. Permissões (reutilizadas, sem papéis novos)

| Ação | Permissão |
|---|---|
| Ler parâmetros e cotação vigente | `FINANCEIRO_VISUALIZAR` ou `SIMULACAO_VISUALIZAR` |
| Gravar parâmetros, capturar PTAX, registrar cotação | `FINANCEIRO_REGISTRAR` |
| Calcular, listar e abrir simulações | `SIMULACAO_VISUALIZAR` ou `SIMULACAO_GERENCIAR` |
| Salvar simulação | `SIMULACAO_GERENCIAR` |
| Buscar produto | `CATALOGO_VISUALIZAR` (sem ela, a tela pede o nome do item) |

Tudo é escopado por `x-store-id`: produto, cotação, versão de parâmetros e simulação de outra loja respondem 404.

## 3. Fórmulas e unidades

Resultado em BRL. Decimal no backend, precisão total no cálculo; arredondamento `HALF_UP` só na saída (dinheiro 2 casas, cotação 6, percentuais 2, peso 3). Totais = valor unitário em precisão total × quantidade.

```text
câmbio_operacional = referência + acréscimo            (USD→BRL, acréscimo somado uma única vez)
conv(v, moeda)     = v                  se BRL
                   = v × câmbio_operacional  se USD    (sem cotação: valor não calculável, nunca zero)

compra_u           = conv(preço_compra_u, moeda_compra)
frete_u            = conv(frete_por_kg × peso_u, moeda_do_frete)   (a moeda do frete é declarada)
encargos_compra_u  = Σ { % × compra_u | conv(valor_u) | conv(valor_total) ÷ qtd }
custo_u            = compra_u + frete_u + encargos_compra_u

taxa_marketplace_u = venda_bruta_u × taxa%            (zero só se "sem taxa de canal" for escolhido)
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
alerta    = markup% < limite configurado (padrão do contrato: 25%)
```

Preço de venda zero é "a definir": sem markup, margem nem divisão por zero. Custo ou encargo indispensável ausente deixa o resultado `INCOMPLETO`, com a lista de pendências; o custo continua visível quando calculável.

O defeito do protótipo (tela em R$/kg, cálculo em US$/kg) não se repete: o frete sempre carrega a moeda, e R$/kg não é convertido.

## 4. Fonte do câmbio

Investigada e comprovada em 19/10/2026: API pública de dados abertos do Banco Central, serviço PTAX (Olinda), sem cadastro, credencial ou cobrança. Fornece compra e venda e boletins de abertura, intermediários e fechamento, só em dias úteis (o fechamento sai por volta das 13h de Brasília).

Implementado: captura **sob demanda** da PTAX de **venda** do boletim de **fechamento** mais recente dos últimos 10 dias, gravada como `CotacaoCambio` com fonte `BCB PTAX venda - boletim de fechamento`, instante do boletim e o acréscimo vigente da loja. O mesmo boletim não é registrado duas vezes. Falha da fonte ou ausência de fechamento não grava nada.

PTAX é taxa de referência calculada pelo Banco Central; não é o dólar comercial nem a taxa cobrada por cartão ou remessa. A cotação estimada não comprova a taxa efetivamente paga, e uma compra histórica não deve receber a cotação de hoje.

## 5. Parâmetros que dependem de confirmação

- **Modalidade da referência cambial**: PTAX venda de fechamento foi a fonte implementada; confirmar se é a desejada, ou se a referência deve ser o dólar comercial (que exige outra fonte, ainda não escolhida).
- **Captura automática agendada**: hoje a captura é manual (botão). Agendamento depende da confirmação acima.
- **Base de incidência da nota fiscal de saída**: o PO informou 5%, sem a base. Enquanto não for definida, a configuração fica "a definir" e o simulador exige escolher a base ou informar o valor estimado.
- **Plano parcelado**: referência de 16% informada com 2 parcelas e uso frequente de 12. A taxa é cadastrada por canal, modalidade e quantidade de parcelas; não há tabela oficial de tarifas no sistema.
- **Taxa à vista de 12%** e **acréscimo de R$ 0,20**: referências do PO, aplicadas só depois de gravadas por um usuário.
- **Frete por kg**: valor e moeda ainda não informados pelo PO.

## 6. Estimado e realizado

O simulador produz apenas `natureza: "ESTIMATIVA"`. A venda realizada (futura importação) deve preservar os valores finais da fonte. Valor recebido do Mercado Livre/ERP que já chega líquido das taxas do canal **não** pode sofrer novo desconto da taxa projetada; a nota fiscal não é aplicada sobre o líquido por conveniência. Projeção e realizado ficam em contratos e telas separados.

## 7. Fora desta entrega

Importação do catálogo Bolt/Excel (OP-06), importação de vendas, integração Tiny/ERP, simulador de viagem, mudanças em Vendas e reconstrução das demais telas. No banco de preview desta branch (`dg_sim_preview`) foram cadastrados, pela API de Produtos, alguns itens do catálogo do Bolt da Gooder (sem peso nem preço) para testar a busca; não fazem parte de migration nem de seed.
