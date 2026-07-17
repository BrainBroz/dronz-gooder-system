# Handoff de Pull Request

Copie este modelo para o corpo da PR ou para um arquivo de handoff versionado na branch. Ele é o contrato entre quem implementa, quem revisa e quem aprova; não substitui testes nem documentos normativos.

## Identificação

- Branch:
- Commit base:
- Commit final:
- Responsável pela implementação:
- Batch/tarefa:

## Entrega

- Objetivo concluído:
- Arquivos principais alterados:
- Migrações ou dados alterados: `não aplicável` ou lista
- Endpoints/contratos alterados: `não aplicável` ou lista
- Decisões técnicas tomadas:

## Validação executada

| Comando | Resultado | Observações |
| --- | --- | --- |
| `npm run lint` |  |  |
| `npm run typecheck` |  |  |
| `npm run build` |  |  |
| `npm test` |  |  |
| `git diff --check` |  |  |

## Riscos e limites

- Riscos reais remanescentes:
- Decisões que dependem do Product Owner:
- Itens deliberadamente fora do escopo:

## Revisão solicitada

- Codex — diff, testes, segurança, tenancy e compatibilidade:
- Gemini — contratos, arquitetura e documentos extensos (quando aplicável):
- Critério objetivo de aprovação:

## Resultado da revisão

Preenchido pelo revisor, sem reescrever o relato do implementador.

- Veredito: `APROVADO`, `APROVADO COM RESSALVAS` ou `CORREÇÕES OBRIGATÓRIAS`
- Achados:
- Próxima ação:
