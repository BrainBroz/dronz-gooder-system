# Auditoria Técnica Final — Ciclo de Estabilização

**Data:** 11 de julho de 2026  
**Auditor:** Claude Code  
**Contexto:** Audit de Batch 2.1.1 e 3.4 + RCA de falhas remanescentes  
**Escopo:** Verificação de integridade de testes, dados, e schema

---

## Execução Sumária

| Item | Status | Observações |
|------|--------|-------------|
| Batch 2.1.1 — 10 testes | ✓ PASS | Todos passando |
| Batch 3.4 — 9 testes | ✓ PASS | Todos passando |
| Suite completa | 87/89 PASS | 2 falhas remanescentes investigadas |
| RCA Falha #1 | ✓ FECHADA | Causa raiz comprovada |
| RCA Falha #2 | ⚠️ INCONCLUSIVA | Causa não determinada; necessário trabalho futuro |

---

# FALHA #1: inventory.integration.test.ts linha 82

## Status: RCA FECHADA ✓

## Erro Observado

```
TypeError: Cannot read properties of undefined (reading 'itens')
  at test/inventory.integration.test.ts:82:27
```

**Causa Raiz Comprovada:**

Divergência entre schema Prisma e banco de dados PostgreSQL.

### Evidência #1: Schema Prisma

Arquivo: `apps/api/prisma/schema.prisma` linhas 646–667

```prisma
model RecebimentoItem {
  id                          String           @id @default(cuid())
  lojaId                      String
  recebimentoId               String
  pedidoCompraItemId          String
  produtoId                   String
  quantidadeEsperada          Int
  quantidadeRecebida          Int              @default(0)
  quantidadeRejeitada         Int              @default(0)
  quantidadeJaIncorporada     Int              @default(0)
  condicao                    CondicaoProduto?  ← CAMPO DEFINIDO
  observacoes                 String?
  createdAt                   DateTime         @default(now())
  updatedAt                   DateTime         @updatedAt
  ...
}
```

**Campo definido:** `condicao CondicaoProduto?` (linha 656)

### Evidência #2: Banco de Dados

Query executada:
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name='RecebimentoItem' 
ORDER BY ordinal_position
```

**Resultado (12 colunas):**
- id
- lojaId
- recebimentoId
- pedidoCompraItemId
- produtoId
- quantidadeEsperada
- quantidadeRecebida
- quantidadeRejeitada
- observacoes
- createdAt
- updatedAt
- quantidadeJaIncorporada

**Campo ausente:** `condicao` ❌

### Evidência #3: Enum Type

Query executada:
```sql
SELECT enumtypid, enumlabel FROM pg_enum 
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname='CondicaoProduto')
```

**Resultado:** Nenhum registro  
**Conclusão:** Enum `CondicaoProduto` não existe no banco ❌

### Evidência #4: Erro Prisma P2022

**Stacktrace capturado:**

```
PrismaClientKnownRequestError: 
Invalid `prisma.recebimentoItem.findMany()` invocation
The column `RecebimentoItem.condicao` does not exist in the current database.

code: P2022
meta: {
  modelName: "RecebimentoItem",
  column: "RecebimentoItem.condicao"
}
```

**Reprodução:**
```javascript
const items = await prisma.recebimentoItem.findMany({
  where: { lojaId: dronz.id }
});
// → Erro P2022 disparado
```

### Evidência #5: Migration Status

**Migrations que deveriam criar o campo:**
- ✗ Nenhuma migration cria coluna `condicao`
- ✗ Nenhuma migration cria enum `CondicaoProduto`

**Última migration:** `20260711340000_add_quantidade_ja_incorporada` (adiciona apenas `quantidadeJaIncorporada`)

## Impacto na Falha #1

1. **POST /receiving** (linha 73-76 do teste)
   - Sucede na criação do recebimento
   - Falha ao retornar resposta (tenta serializar RecebimentoItem com P2022)

2. **GET /receiving** (linha 79-80 do teste)
   - Falha com P2022 ao tentar carregar itens
   - `detail = undefined` (resposta não chega ao cliente)

3. **Resultado do teste**
   - `detail.itens[0].id` → undefined
   - `TypeError: Cannot read properties of undefined`

## Severidade

**ALTA** — Bloqueia entrada de dados (receiving), crítico para cadeia de suprimentos.

## Verificação

- ✓ Erro reproduzido manualmente
- ✓ Stacktrace coletado
- ✓ Schema Prisma verificado
- ✓ Banco de dados verificado
- ✓ Migration status verificado
- ✓ Impacto rastreado até o teste

**RCA ENCERRADA** — Evidência suficiente.

---

# FALHA #2: logistics.integration.test.ts linha 57

## Status: RCA AINDA INCONCLUSIVA ⚠️

## Erro Observado

```
AssertionError: expected +0 to be 1
  at test/logistics.integration.test.ts:57:44
  
expect(Number(weight.body.conteudoKg)).toBe(1);
//     ↑ retorna 0, esperava 1
```

## Investigação Realizada

### Questão #1: "A Falha #2 depende da Falha #1?"

**Resposta:** NÃO.

**Análise de fluxo de código:**

Fluxo de `logistics.integration.test.ts`:
```
beforeEach
  → prisma.recebimentoMiami.deleteMany()  ✓ Não toca RecebimentoItem
  → prisma.pedidoCompraItem.updateMany()  ✓ Não toca RecebimentoItem
  → prisma.pedidoCompra.updateMany()      ✓ Não toca RecebimentoItem

GET /logistics/travelers
  → logistics.service.ts travelers()      ✓ Não toca RecebimentoItem

GET /logistics/suitcases
  → logistics.service.ts suitcases()
    → prisma.mala.findMany({ include: { alocacoes } })  ✓ Não toca RecebimentoItem

GET /logistics/suitcases/{id}/weight
  → logistics.service.ts weight()
    → Calcula sum(alocacoes.pesoConteudoKg)  ✓ Não toca RecebimentoItem
```

**Conclusão:** logistics.test.ts não executa código que dispara P2022 (RecebimentoItem).

**Falha #2 é INDEPENDENTE de Falha #1.**

### Questão #2: "Por que conteudoKg retorna 0?"

**Hipótese A:** Alocações foram deletadas
- **Investigação:** beforeEach não deleta alocacoes ✓
- **Status:** Refutada

**Hipótese B:** Alocações nunca foram criadas
- **Investigação:** 
  - Seed roda sem erros visíveis
  - Seed funciona quando executada isoladamente ✓
  - Upsert de AlocacaoMala sucede manualmente ✓
  - Quando alocações existem, são retornadas corretamente ✓
- **Status:** Parcialmente suportada, mas causa desconhecida

**Hipótese C:** Há erro silencioso na seed
- **Investigação:**
  - seed.ts usa `.finally()` sem `.catch()` — erros seriam engolidos
  - Seed não registra logs de erro
  - Mas quando rodada diretamente, cria alocações com sucesso
- **Status:** Possível, mas não comprovada

## Evidências Coletadas

### ✓ Comprovado

- Seed **CONSEGUE** criar AlocacaoMala (teste manual com upsert: sucesso)
- Query **CONSEGUE** retornar alocacoes (include via Prisma: funciona)
- beforeEach **NÃO deleta** alocacoes (verificado em código)
- Peso está correto quando alocação existe: `pesoConteudoKg = 1` ✓
- **Falha #2 não dispara P2022** (não percorre RecebimentoItem)

### ✗ Não Comprovado

- Por quê seed não criava alocações originalmente durante `npm test`
- Se há erro implícito na seed que é engolido
- Se há race condition ou timing issue
- Se há estado de banco corrupto/inconsistente anterior

## Conclusão Explícita

**A causa raiz permanece desconhecida e deverá ser investigada em trabalho específico.**

**Não há evidência suficiente para concluir a RCA neste momento.**

### Recomendações para Investigação Futura

1. Adicionar logging na seed para capturar erros de upsert
2. Verificar se há erros silenciosamente engolidos pelo `.finally()`
3. Executar seed com try-catch explícito e reportar exceptions
4. Verificar estado do banco antes/depois de seed em ambiente de teste
5. Verificar se há constraint violations em FK de AlocacaoMala

---

# Dívida Técnica Registrada

## Prioridade ALTA

**Corrigir mismatch Schema × Banco (RecebimentoItem.condicao)**

- **ID:** TECH-DEBT-001
- **Componente:** prisma/schema.prisma + banco de dados
- **Ação:** 
  - Opção A: Remover campo `condicao` do schema (se não implementado)
  - Opção B: Criar migration que adiciona coluna ao banco (se campo é necessário)
- **Impacto:** Bloqueia módulo de recebimento e inventário
- **Esforço:** Baixo (< 1 hora)
- **Risco:** Baixo

## Prioridade MÉDIA

**Concluir RCA da Falha #2 — AlocacaoMala não criadas durante seed**

- **ID:** TECH-DEBT-002
- **Componente:** prisma/seed.ts + logistics module
- **Ação:**
  1. Adicionar logging em seed.ts para capturar erros
  2. Investigar por quê upsert de AlocacaoMala falha durante `npm test`
  3. Implementar correção baseada em causa raiz identificada
- **Impacto:** Afeta testes de logística
- **Esforço:** Médio (2-4 horas investigação + X horas correção)
- **Risco:** Médio
- **Pré-requisito:** Completar Falha #1 TECH-DEBT-001

---

# Ciclo de Auditoria

## Resumo Executivo

| Fase | Status | Data |
|------|--------|------|
| Auditoria Batch 2.1.1 | ✓ Completa | 11 jul 2026 |
| Auditoria Batch 3.4 | ✓ Completa | 11 jul 2026 |
| RCA Falha #1 | ✓ Encerrada | 11 jul 2026 |
| RCA Falha #2 | ⚠️ Inconclusiva | 11 jul 2026 |
| Documentação | ✓ Atualizada | 11 jul 2026 |

## Próximos Passos

1. **Imediato:** Corrigir Falha #1 (TECH-DEBT-001)
   - Decisão: Remover `condicao` do schema OU criar migration
   - Executar: Após aprovação de decisão
   - Validação: Re-rodar testes

2. **Curto prazo:** Investigar Falha #2 (TECH-DEBT-002)
   - Adicionar logging à seed
   - Identificar causa raiz
   - Implementar correção
   - Validar com testes

3. **Congelamento:** Após TECH-DEBT-001 estar corrigida, batches podem ser aprovados para produção

---

**Documento Assinado Digitalmente**

Ciclo de Auditoria Técnica Encerrado  
Status: Pronto para correção de dívida técnica  
Bloqueadores: 1 de Alta Prioridade (TECH-DEBT-001)

---
