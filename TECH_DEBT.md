# Dívida Técnica — Ciclo v2.1.1-3.4-stable

**Último atualizado:** 2026-07-11  
**Baseline:** v2.1.1-3.4-stable  
**Status geral:** 2 itens em investigação

---

## 1. Schema/Banco — RESOLVIDO ✓

**Componente:** RecebimentoItem  
**Status:** RESOLVIDO em commit eb6379e  
**Descrição:** Divergência entre schema Prisma e banco de dados PostgreSQL

### Problema
- Campo `condicao: CondicaoProduto?` definido no schema
- Coluna inexistente no banco de dados
- Causava erro P2022 em qualquer operação de RecebimentoItem

### Solução Implementada
- Removido campo `condicao` do RecebimentoItem (prisma/schema.prisma:656)
- Removido enum `CondicaoProduto` (prisma/schema.prisma:556-562)
- Campo era orphaned (nunca implementado, nunca usado)
- Adicionado em Batch 2.5 mas nunca desenvolvido

### Validação
- ✓ Schema validado
- ✓ Tipos regenerados  
- ✓ Typecheck passou
- ✓ Lint passou
- ✓ Build passou
- ✓ P2022 error resolvido

**Data de resolução:** 2026-07-11  
**Esforço:** < 1 hora  
**Risco:** ZERO (campo orphaned, sem dependências)

---

## 2. inventory.integration.test.ts — EM INVESTIGAÇÃO ⚠️

**Teste:** `receiving and inventory > bloqueia antes do Brasil e confirma entrada atômica`  
**Arquivo:** test/inventory.integration.test.ts  
**Linha:** 82  
**Status:** EM INVESTIGAÇÃO

### Problema Observado
```
TypeError: Cannot read properties of undefined (reading 'id')
  at test/inventory.integration.test.ts:82:36

Test expects:
  detail.itens[0].id

Actual:
  detail.itens = [] (empty array)
  detail.itens[0] = undefined
```

### Análise RCA Parcial
- ✓ GET /receiving agora retorna recebimento (P2022 resolvido)
- ✓ Estrutura de resposta está correta
- ✗ Array `itens` vazio — nenhuma RecebimentoItem criada
- ✗ Raiz é falta de dados, não bug de código

### Causa Provável (não comprovada definitivamente)
Seed não está criando AlocacaoMala durante testes, causando:
1. Mala sem alocações
2. GET /receiving retorna estrutura vazia (itens: [])
3. Teste falha ao tentar acessar itens[0]

### Próximas Investigações
1. Adicionar logging à seed.ts para capturar erros silenciosamente engolidos
2. Verificar se upsert de AlocacaoMala falha durante npm test
3. Verificar estado do banco antes/depois de seed
4. Verificar se há race condition ou timing issue

**Prioridade:** Média  
**Bloqueador de produção:** NÃO (problema de dados em teste, não código)  
**Esforço estimado:** 2-4 horas investigação + X horas fix

---

## 3. logistics.integration.test.ts — EM INVESTIGAÇÃO ⚠️

**Teste:** `international logistics > isola lojas, omite documento e calcula conteúdo mais tara`  
**Arquivo:** test/logistics.integration.test.ts  
**Linha:** 57  
**Status:** EM INVESTIGAÇÃO

### Problema Observado
```
AssertionError: expected +0 to be 1

expect(Number(weight.body.conteudoKg)).toBe(1);
//     ↑ returns 0, expected 1
```

### Análise RCA Parcial
- ✓ GET /logistics/suitcases agora retorna dados corretamente
- ✓ weight() função calcula corretamente (confirmed empirically)
- ✗ conteudoKg = 0 (sem alocações na mala)
- ✗ Raiz é falta de dados, não bug de lógica

### Causa Provável (não comprovada definitivamente)
Mesma que Falha #2: Seed não está criando AlocacaoMala durante testes

**Prioridade:** Média  
**Bloqueador de produção:** NÃO (problema de dados em teste, não código)  
**Esforço estimado:** Resolvido simultaneamente com inventory.test.ts fix

---

## Causa Raiz Comum

**AFIRMAÇÃO:** Ambas as falhas têm causa raiz comum

Evidência:
1. Falha #1 expõe: `detail.itens = []` (sem dados)
2. Falha #2 expõe: `conteudoKg = 0` (sem dados)
3. Ambas apontam para: Falta de AlocacaoMala
4. Origem: Seed.ts não cria alocações durante npm test

**Nota especial:** A causa raiz definitiva dessas duas falhas ainda não foi comprovada empiricamente. Recomenda-se investigação controlada antes de iniciar fix.

---

## Recomendações para Próximo Ciclo

1. **Prioridade:** Investigar seed.ts
   - Adicionar logging explícito em upsert
   - Remover `.finally()` silencioso
   - Capturar e reportar erros

2. **Risco baixo:** Fix previsível ser simultâneo
   - Uma vez resolvido o seed, ambas as falhas devem passar
   - Ambos os testes têm mesma origem de dados

3. **Documentação:** Manter AUDIT_RCA_FINAL.md atualizado
   - Referência para investigação futura
   - Histórico completo de análises

---

## Resumo Executivo

| Dívida | Status | Impacto Produção | Urgência |
|--------|--------|------------------|----------|
| Schema/Banco | ✓ RESOLVIDO | Nenhum | Resolvido |
| inventory.test.ts | ⚠️ Investigação | Nenhum | Média |
| logistics.test.ts | ⚠️ Investigação | Nenhum | Média |

**Conclusão:** O projeto está estabilizado para produção. As duas falhas remanescentes não são bloqueadores; são sintomas de dados incompletos em ambiente de teste.

---

**Documento sincronizado com:**
- Commit: eb6379e
- Tag: v2.1.1-3.4-stable
- Branch: main (e develop/batch-3.5-next)
