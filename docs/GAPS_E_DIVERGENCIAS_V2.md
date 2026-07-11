# Gaps e Divergências — Base para a V2

Este documento mapeia, contra o `schema.prisma` real do repositório (commit `5132e8a`), os itens ausentes e divergentes identificados na comparação entre o briefing original e o histórico do projeto SGE. Serve de base para `tasks/CODEX_TASK_002_EXPANSAO.md`.

Confirmado com o dono do produto:

- **Módulo de Vendas fica para uma versão futura, fora do escopo desta fase.** Isso inclui `Venda`, canais de venda e o percentual de NF de saída (só é relevante junto com Vendas).
- Repositório é a fonte de verdade a partir de agora — este documento substitui análises anteriores feitas apenas sobre o briefing em Markdown.

---

## 1. Confirmado no código (sem ação necessária)

- **Miami não gera estoque.** `Estoque` só é referenciado a partir de `RecebimentoItem`/`MovimentacaoEstoque`, e `PedidoCompraStatus` passa por `RECEIVED_MIAMI` sem nenhuma tabela de estoque associada até `ARRIVED_BRAZIL`/`Recebimento`. Bate com a decisão registrada — não é mais uma divergência, é o modelo vigente.
- **IDs históricos de produto:** `Produto.codigo` é `Int @unique`, compatível com a faixa 101–147 (Dronz) / 201–243 (Gooder) / 301+ (novos), mas essa faixa não está validada em código (nenhuma constraint de range). Se isso ainda importa, precisa de validação explícita no service de criação de produto — hoje qualquer inteiro livre é aceito.

## 2. Ausente — para incluir na V2 (fora de Vendas)

### 2.1 Simulador de Viagem

Não existe nenhum model equivalente no schema. Precisa ser uma feature **desconectada de dados operacionais reais** — não deve escrever em `PedidoCompra`, `Estoque` ou `MovimentacaoEstoque`.

Models novos sugeridos (seguindo a convenção de nomes em português já usada no schema):

```prisma
model SimulacaoViagem {
  id          String   @id @default(cuid())
  lojaId      String
  nome        String
  criadoPorId String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  loja        Loja                     @relation(fields: [lojaId], references: [id], onDelete: Cascade)
  criadoPor   Usuario                  @relation(fields: [criadoPorId], references: [id], onDelete: Restrict)
  itens       SimulacaoViagemItem[]
  custos      SimulacaoViagemCusto?
  parametros  SimulacaoViagemParametro?

  @@unique([id, lojaId])
  @@index([lojaId])
}

model SimulacaoViagemItem {
  id                  String   @id @default(cuid())
  lojaId              String
  simulacaoViagemId   String
  nomeItem            String
  categoriaId         String?
  custoUnitario       Decimal  @db.Decimal(12, 2)
  quantidade          Int
  precoVendaUnitario  Decimal  @db.Decimal(12, 2)
  pesoUnitarioKg      Decimal  @db.Decimal(10, 3)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  simulacao SimulacaoViagem @relation(fields: [simulacaoViagemId, lojaId], references: [id, lojaId], onDelete: Cascade)

  @@index([lojaId, simulacaoViagemId])
}

model SimulacaoViagemCusto {
  id                String   @id @default(cuid())
  lojaId            String
  simulacaoViagemId String   @unique
  comissao          Decimal  @default(0) @db.Decimal(12, 2)
  passagens         Decimal  @default(0) @db.Decimal(12, 2)
  hotel             Decimal  @default(0) @db.Decimal(12, 2)
  carro             Decimal  @default(0) @db.Decimal(12, 2)
  alimentacao       Decimal  @default(0) @db.Decimal(12, 2)
  gasolina          Decimal  @default(0) @db.Decimal(12, 2)
  diversos          Decimal  @default(0) @db.Decimal(12, 2)

  simulacao SimulacaoViagem @relation(fields: [simulacaoViagemId, lojaId], references: [id, lojaId], onDelete: Cascade)

  @@unique([id, lojaId])
}

model SimulacaoViagemParametro {
  id                    String   @id @default(cuid())
  lojaId                String
  simulacaoViagemId     String   @unique
  custoEnvioPorKgUsd    Decimal  @db.Decimal(12, 4)
  cotacaoDolar          Decimal  @db.Decimal(18, 6)

  simulacao SimulacaoViagem @relation(fields: [simulacaoViagemId, lojaId], references: [id, lojaId], onDelete: Cascade)

  @@unique([id, lojaId])
}
```

Cálculos (todos no service, nunca no frontend — mesma filosofia do `CustoPedido` já implementado):

```text
coeficiente = custoEnvioPorKgUsd × cotacaoDolar
freteUnitarioItem = coeficiente × pesoUnitarioKg
freteTotalItem = freteUnitarioItem × quantidade
custoTotalItem = custoUnitario × quantidade
projecaoVendaTotalItem = precoVendaUnitario × quantidade
projecaoLucroItem = projecaoVendaTotalItem − custoTotalItem − freteTotalItem
```

#### 2.1.1 Nova Regra Oficial de Tributação — Decisão PO 11 julho 2026

**Regra oficial de risco tributário:**

```
cotaTotalIsentaUsd = quantidadeViajantes × 1000
excedenteTributavelUsd = max(valorBensConsideradoUsd − cotaTotalIsentaUsd, 0)
tributacaoPrevistaUsd = excedenteTributavelUsd × 0.75
tributacaoPrevistaBrl = tributacaoPrevistaUsd × cotacaoDolar
```

**Três estados tributários:**

1. **SEM_RISCO** (padrão):
   - `riscoEfetivado = false`
   - `tributacaoEfetivadaBrl = 0`
   - `lucroFinal = lucroProjetado − custosOperacionaisViagem`

2. **SIMULACAO** (cálculo estimado):
   - `riscoEfetivado = false`
   - `tributacaoEfetivadaBrl = 0`
   - `lucroPrevistoComRisco = lucroProjetado − custosOperacionaisViagem − tributacaoPrevistaBrl`

3. **EFETIVADA** (entrada manual):
   - `riscoEfetivado = true`
   - `tributacaoEfetivadaBrl = entrada manual do usuário`
   - `lucroFinalReal = lucroProjetado − custosOperacionaisViagem − tributacaoEfetivadaBrl`

**Características:**
- Alíquota fixa: 75%
- Base: valor de bens considerado em USD, convertido após cálculo
- Cota: isenta US$ 1.000 **por pessoa, por viagem**
- Não é automática no cenário padrão
- Permite simulação opcional
- Permite registro manual de tributação efetiva

**Caso de teste de referência** (usar em teste de integração):

3 itens (Mac Studio, Macbook Pro, Power Beats Pro) → custo total R$ 34.150, venda projetada R$ 50.000, lucro projetado R$ 15.850. Custos de viagem R$ 2.500, custo envio US$ 46,17/kg, cotação R$ 5,70 → coeficiente R$ 263,16/kg → **lucro líquido esperado R$ 13.350 (36,43%)** — **este é o cenário SEM_RISCO** (riscoEfetivado = false, tributacao = 0).

### 2.2 Despesas internas (`Despesa`)

Não existe hoje — `Pagamento` só cobre pagamento a fornecedor via `pedidoCompraId`. Faltam despesas que não estão ligadas a nenhum pedido (pró-labore, aluguel, publicidade, reinvestimento).

```prisma
enum DespesaCategoria {
  PROLABORE
  OPERACIONAL
  REINVESTIMENTO
}

model Despesa {
  id           String           @id @default(cuid())
  lojaId       String
  categoria    DespesaCategoria
  descricao    String
  valor        Decimal          @db.Decimal(12, 2)
  dataDespesa  DateTime
  observacoes  String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  loja Loja @relation(fields: [lojaId], references: [id], onDelete: Restrict)

  @@unique([id, lojaId])
  @@index([lojaId, categoria])
  @@index([lojaId, dataDespesa])
}
```

Entra no dashboard existente (`docs` menciona "financeiro manual, dashboard e relatórios isolados por loja") como mais um agregado por categoria/período — sem exigir nenhuma mudança nos módulos já implementados.

### 2.3 Condição do produto no recebimento

`RecebimentoItem` hoje tem `quantidadeEsperada`, `quantidadeRecebida`, `quantidadeRejeitada` — falta condição física do item recebido.

```prisma
enum CondicaoProduto {
  NEW
  NEW_TERCEIRO
  USED
  USED_NO_CABLES
  OPEN_BOX
}
```

Adicionar `condicao CondicaoProduto?` em `RecebimentoItem`. Campo opcional para não quebrar dados já existentes de recebimentos anteriores.

### 2.4 Regra do dólar (mercado + R$ 0,20) — CONFIRMADO

**Confirmado com o dono do produto: a margem é sempre R$ 0,20, fixa.** Não varia por pedido nem por loja.

`CotacaoCambio` hoje só guarda `valor` final. Para deixar a regra explícita e auditável, sem esconder a lógica dentro de um valor já calculado:

```prisma
model CotacaoCambio {
  ...
  valorMercado  Decimal  @db.Decimal(18, 6)
  margem        Decimal  @default(0.20) @db.Decimal(18, 6)
  // valor (existente) passa a ser o resultado: valorMercado + margem
  ...
}
```

O campo `margem` continua existindo na tabela (não vira constante hardcoded no código) para manter histórico e auditoria — mas o valor default é sempre `0.20`, e a tela de cadastro de cotação não precisa expor esse campo como editável, já que a regra é fixa. Se algum dia a regra mudar, ajusta-se o default e/ou os registros futuros, sem quebrar o histórico de cotações antigas (que continuam com a margem que valia na época).

### 2.5 Papel `checkpoint_miami` — CONFIRMADO

**Confirmado com o dono do produto:** o papel é necessário. Escopo é **só visibilidade do lado Miami do fluxo logístico** — o que está a caminho de Miami, o que já chegou, o que já saiu de Miami rumo ao Brasil. Nenhum dado financeiro, nenhum preço de venda, nenhum markup, nenhum dashboard geral.

O seed atual (`apps/api/prisma/seed.ts`) só cria `SUPER_ADMIN` e `SYSTEM_ADMIN`. A estrutura `Perfil` + `Permissao` + `PerfilPermissao` já suporta o novo papel sem migration de schema.

#### Permissões do perfil

```text
Perfil { code: "CHECKPOINT_MIAMI" }

Permissao:
  MIAMI_PEDIDOS_LER            // ver PedidoCompra + PedidoCompraItem, só campos logísticos
  MIAMI_RECEBIMENTO_CONFIRMAR  // criar RecebimentoMiami
  MIAMI_LOGISTICA_LER          // ver Viagem, Mala, VolumeLogistico, AlocacaoMala (o que está saindo)
```

Sem nenhuma das permissões de: `FINANCEIRO_LER`, `DASHBOARD_LER`, `PAGAMENTO_LER`, `CUSTO_PEDIDO_LER`, `PRODUTO_PRECO_LER`.

#### Regra importante: isso não é só rota bloqueada, é campo escondido

`PedidoCompra` e `PedidoCompraItem` misturam dado logístico (produto, quantidade, status) com dado financeiro (`precoUnitario`, `descontoItem`, `totalItem`, `descontoPedido`, `frete`, `imposto`, `subtotal`, `total`). Não basta bloquear a rota de financeiro — é preciso que o **mesmo endpoint** de pedido, quando acessado por `CHECKPOINT_MIAMI`, devolva um DTO reduzido, sem os campos monetários.

Sugestão de implementação: um serializer/view separado para esse perfil (ex.: `toMiamiView(pedidoCompra)`), não um `if (role === ...)` espalhado pelos controllers — mantém a mesma disciplina de "services concentram regra de negócio" já usada no resto do projeto.

**Assumido, a confirmar com o dono do produto:** o perfil `CHECKPOINT_MIAMI` nunca vê valor em dinheiro nos pedidos — nem preço unitário, nem total. Só produto, quantidade, peso, status e tracking. Se em algum caso o valor precisar aparecer (ex.: para o operador de Miami avaliar se um item parece divergente no despacho), isso precisa ser dito explicitamente, porque a implementação padrão vai esconder o valor por completo.

## 3. Fora de escopo nesta fase (confirmado)

- `Venda`, canais de venda, percentual de NF de saída — versão futura.
- Localizações de compra estruturadas (MIA/PETIT/Thali NY/Brunno CA) — baixa prioridade, pode ser resolvido com `Fornecedor.nomeFantasia` ou `observacoes` por enquanto, sem migration nova.
- Integrações eBay/Amazon/Tiny/Bling — já documentado em `README.md` como não implementado.

---

*Gerado a partir do commit `5132e8a` do repositório `BrainBroz/dronz-gooder-system`. Todos os itens de escopo desta fase (seção 2) foram confirmados com o dono do produto — não há mais pendências de decisão para o Simulador de Viagem, Despesas internas, condição do produto, regra do dólar ou perfil `CHECKPOINT_MIAMI`.*
