# Contratos normativos do domínio

**Aprovado em:** 2026-07-11  
**Escopo:** compras, logística internacional, recebimento, estoque, financeiro, dashboard e relatórios.

Este documento é fonte normativa. Toda entidade operacional possui `lojaId` diretamente ou herda um vínculo validável. O backend valida usuário ativo, vínculo explícito com a loja e nunca confia apenas no `lojaId` do frontend. Dronz e Gooder não compartilham dados operacionais. IDs técnicos usam o padrão Prisma atual; IDs históricos de Produtos não são reutilizados. Valores monetários usam `Decimal`; datas são persistidas em UTC.

## Fornecedores

`Fornecedor`: id, lojaId, nome, nomeFantasia?, site?, email?, telefone?, pais?, moedaPadrao?, observacoes?, ativo, createdAt, updatedAt. Nome é obrigatório. Não há unicidade global por nome. Inativos não aparecem por padrão em novos pedidos, mas permanecem no histórico. Exclusão física é bloqueada quando existirem pedidos.

## Pedidos de compra

`PedidoCompra`: id, lojaId, fornecedorId, numeroPedido, dataCompra, moeda ISO 4217, status, descontoPedido, frete, imposto, subtotal, total, observacoes?, canceladoEm?, createdAt, updatedAt. A moeda padrão de desenvolvimento é USD. `numeroPedido` é único por lojaId + fornecedorId + numeroPedido.

Status: `DRAFT`, `PLACED`, `CONFIRMED`, `PARTIALLY_RECEIVED_MIAMI`, `RECEIVED_MIAMI`, `ALLOCATED_TO_TRIP`, `IN_TRANSIT_BRAZIL`, `ARRIVED_BRAZIL`, `COMPLETED`, `CANCELLED`.

Transições: DRAFT→PLACED/CANCELLED; PLACED→CONFIRMED/CANCELLED; CONFIRMED→PARTIALLY_RECEIVED_MIAMI/RECEIVED_MIAMI/CANCELLED; PARTIALLY_RECEIVED_MIAMI→RECEIVED_MIAMI; RECEIVED_MIAMI→ALLOCATED_TO_TRIP; ALLOCATED_TO_TRIP→IN_TRANSIT_BRAZIL; IN_TRANSIT_BRAZIL→ARRIVED_BRAZIL; ARRIVED_BRAZIL→COMPLETED. CANCELLED e COMPLETED são finais. Cancelamento é proibido após entrada real em estoque. Exclusão física só é permitida para DRAFT sem relações downstream.

`PedidoCompraItem`: id, pedidoCompraId, lojaId, produtoId, quantidade inteira positiva, precoUnitario, descontoItem não negativo, totalItem, observacoes?, createdAt, updatedAt. Produto e pedido devem ser da mesma loja e um Produto não se repete no mesmo pedido.

```text
totalBrutoItem = quantidade × precoUnitario
totalItem = max(0, totalBrutoItem - descontoItem)
subtotal = soma(totalItem)
totalPedido = max(0, subtotal - descontoPedido + frete + imposto)
```

O backend sempre recalcula. Recebimento Miami controla quantidade comprada, recebida e pendente por item; recebido nunca supera comprado. Confirmação registra data e usuário. Recebimento parcial define PARTIALLY_RECEIVED_MIAMI; conclusão integral define RECEIVED_MIAMI.

## Logística internacional

Timezone Miami: `America/New_York`. Exibição Brasil: `America/Sao_Paulo`. Deadline semanal: terça-feira 14:00 em Miami. Envio planejado: quinta-feira, período `MANHA`, sem inventar horário. Confirmação Miami ocorre em até 24 horas do recebimento físico.

`Viajante`: id, lojaId, nome, email?, telefone?, documento?, observacoes?, ativo, timestamps. Documento é sensível, não é identificador público nem conteúdo de logs.

`Viagem`: id, lojaId, viajanteId, origem, destino, partidaEm, chegadaPrevistaEm, chegadaRealEm?, status, observacoes?, timestamps. Status: `PLANNED`, `OPEN_FOR_ALLOCATION`, `CLOSED_FOR_ALLOCATION`, `IN_TRANSIT`, `ARRIVED_BRAZIL`, `CANCELLED`. Transições: PLANNED→OPEN_FOR_ALLOCATION; OPEN_FOR_ALLOCATION→CLOSED_FOR_ALLOCATION/CANCELLED; CLOSED_FOR_ALLOCATION→IN_TRANSIT/CANCELLED; IN_TRANSIT→ARRIVED_BRAZIL. Estados finais: ARRIVED_BRAZIL e CANCELLED.

`Mala`: id, lojaId, viagemId, codigo, limitePesoKg (padrão 23), status, observacoes?, timestamps. Status: `PLANNING`, `CLOSED`, `CHECKED_IN`, `ARRIVED_BRAZIL`, `RECEIVED`, `CANCELLED`.

Volumes logísticos registram pesoConteudoKg, taraKg (padrão 0,5 por caixa) e pesoTotalKg. Tara não é aplicada por unidade nem uma única vez por pedido com múltiplas caixas. Peso da mala soma produtos alocados e taras. Acima de 23 kg é proibido. Peso ausente permite planejamento, mas bloqueia fechamento. Mala, viagem, viajante e itens respeitam a mesma loja.

Chegada ao Brasil exige viagem ARRIVED_BRAZIL, mala ARRIVED_BRAZIL ou RECEIVED e data real. Miami, alocação, mala fechada ou viagem em trânsito não geram estoque.

## Recebimento e estoque

Status de recebimento: `PENDING`, `IN_PROGRESS`, `PARTIALLY_COMPLETED`, `COMPLETED`, `REJECTED`.

Movimentos: `ENTRY`, `RESERVE`, `RELEASE_RESERVATION`, `EXIT`, `ADJUSTMENT_POSITIVE`, `ADJUSTMENT_NEGATIVE`, `RETURN_ENTRY`, `RETURN_EXIT`. Motivos: `PURCHASE_RECEIPT`, `SALE`, `MANUAL_CORRECTION`, `DAMAGE`, `LOSS`, `RETURN`, `RESERVATION`, `RESERVATION_RELEASE`.

`quantidadeDisponivel = quantidadeFisica - quantidadeReservada`. Saldo físico e disponível nunca ficam negativos. Reserva não muda físico; baixa reduz físico; liberação reduz reservado. Entrada exige recebimento válido após chegada ao Brasil. Ajustes exigem motivo e observação. Operações usam transação Prisma. Movimentos confirmados não são editados nem apagados. Recebimento parcial é permitido e cada confirmação gera ENTRY.

## Financeiro

Câmbio é manual neste ciclo e registra valor, moedas ISO de origem/destino, data e responsável. Dinheiro usa Decimal e apresentação com 2 casas; cotação admite 6 casas; arredondamento comercial `HALF_UP`.

Pagamento: id, lojaId, pedidoCompraId, formaPagamento, moeda, valor, status, pagoEm?, referencia?, observacoes?, timestamps. Status: `PENDING`, `PARTIAL`, `PAID`, `REFUNDED`, `CANCELLED`. Formas: `CREDIT_CARD`, `PAYPAL`, `BANK_TRANSFER`, `CASH`, `OTHER`. PAYPAL é apenas classificação manual.

Custos: subtotal, desconto, frete, imposto, IOF configurável (percentual e valor, inclusive zero), taxas, custo adicional manual e câmbio. Custos globais são rateados proporcionalmente ao valor líquido; diferença de centavos vai ao último item e a soma rateada equivale ao total. Pagamentos parciais são aceitos; soma menor define PARTIAL, igual define PAID e maior é rejeitada. Reembolso preserva o pagamento original e registra estorno.

```text
markup% = ((precoVenda - custoTotalUnitario) / custoTotalUnitario) × 100
margem% = ((precoVenda - custoTotalUnitario) / precoVenda) × 100
```

Markup mínimo: 25%. Venda zero é “A definir” e não produz markup/margem. Não dividir por zero. `calcSimulacao` é protegida e deve ser reutilizada, se localizada como fonte oficial, sem alteração.

## Dashboard e relatórios

Indicadores: pedidos por status e valor/período; pedidos aguardando ou parcialmente recebidos em Miami; itens alocáveis/em trânsito; viagens abertas; malas em planejamento e pesos; recebimentos pendentes; estoque disponível/zerado/reservado e seu valor; pagamentos pendentes/total pago; custo médio; Produtos abaixo do markup; alertas de deadline. Filtros: loja, período e status aplicável. Somente dados reais.

Relatórios oficiais: Pedidos de Compra, Itens Comprados, Logística por Viagem, Peso por Mala, Recebimentos, Posição e Movimentações de Estoque, Custos por Pedido, Pagamentos, Markup e Margem. Tabelas/filtros bastam; CSV pode ser nativo. PDF e Excel exigem autorização.

## Autorização e decisões futuras

Neste ciclo vale o modelo atual: usuário autenticado e ativo, vínculo explícito com loja e SUPER_ADMIN limitado às lojas vinculadas. Não criar RBAC novo. Integrações PayPal, bancos, cartões, e-mail, companhias aéreas, tracking automático, PDF e Excel permanecem futuras.
