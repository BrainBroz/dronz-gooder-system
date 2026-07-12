# Matriz de Cobertura do Briefing V1

## 1. Escopo e fonte

Esta matriz complementa `COMPRAS_UNIFICADAS_E_CHECKPOINTS_V1.md` e compara a baseline conhecida com os temas atribuídos ao briefing “Sistema de Gestão de Compras e Logística”.

O briefing integral não foi localizado no repositório, no histórico pesquisável nem nos arquivos fornecidos. Foi localizada apenas uma enumeração resumida de temas no pedido de revisão. Consequentemente:

- nenhuma regra ausente foi inventada;
- nomes de pessoas citados no resumo não foram convertidos em permissões ou responsabilidades;
- `NÃO LOCALIZADO` significa que não há requisito verificável suficiente na fonte disponível;
- a matriz não declara incorporação integral do briefing;
- a ausência do arquivo-fonte é risco documental até que o Product Owner disponibilize uma versão canônica.

Classificações permitidas: `IMPLEMENTADO`, `PARCIAL`, `COBERTO PELO ROADMAP`, `FORA DO ROADMAP`, `BLOQUEADO`, `NÃO LOCALIZADO` e `NÃO APLICÁVEL`.

## 2. Matriz

| ID | Requisito do briefing | Situação atual | Batch previsto | Decisão necessária | Lacuna | Recomendação |
|---|---|---|---|---|---|---|
| B-01 | Compra nos EUA | PARCIAL | Batch 5/6 | nenhuma técnica | operação atual é pedido por loja, sem staging externa completa | implementar staging normativa sem presumir integração automática |
| B-02 | Plataformas e contas externas | COBERTO PELO ROADMAP | Batch 5/6 | lista final de plataformas pode evoluir | entidades-alvo ainda não existem | usar enum com `OUTRA`/`MANUAL` e conta sem segredos |
| B-03 | Recebimento em Miami | PARCIAL | Batch 3/4 | nenhuma | mutação existe, faltam read models/RBAC/histórico completos | concluir UI-3C conforme contrato |
| B-04 | Galpão nos EUA | NÃO LOCALIZADO | futuro | propriedade e operação do galpão | briefing integral ausente | modelar apenas como Localização até regra canônica existir |
| B-05 | Conferência | PARCIAL | Batch 3/4 | nenhuma | fluxo atual não cobre integralmente read model e correção | centralizar estado e auditoria no backend |
| B-06 | Divergências | PARCIAL | Batch 3/4 | nenhuma | resolução/correção ainda incompleta | implementar evento corretivo imutável |
| B-07 | Consolidação | PARCIAL | Batch 3/4 | nenhuma | UI operacional e histórico incompletos | preservar alocação física tenant-safe |
| B-08 | Malas | IMPLEMENTADO | Batch 3/4 para UI-3C | nenhuma | integração visual dos checkpoints ainda parcial | reutilizar modelo existente; não duplicar cálculo de peso |
| B-09 | Remessas | PARCIAL | fora do núcleo 3–7 | regras detalhadas do briefing não localizadas | contrato integral de consolidação/remessa não comprovado | manter modelo existente e abrir batch próprio se o briefing trouxer diferenças |
| B-10 | Viajantes | PARCIAL | fora do núcleo 3–7 | responsabilidades operacionais | fluxo completo não comprovado | batch futuro após fonte canônica |
| B-11 | Frete | PARCIAL | Batch 7 apenas para análise; operação futura | regra de rateio/provider | integração e conciliação não previstas | separar integração de frete em batch futuro |
| B-12 | Rota | PARCIAL | Batch 3/4 | nenhuma técnica | checkpoints obrigatórios por rota ainda não implementados | implementar P-03 |
| B-13 | Paraguai | PARCIAL | Batch 3/4 | nenhuma | código atual trata como universal | migrar para aplicabilidade por rota e `NAO_APLICAVEL` |
| B-14 | Chegada ao Brasil | PARCIAL | Batch 3/4 | nenhuma | read model, histórico e RBAC incompletos | concluir checkpoint Brasil |
| B-15 | Recebimento no Brasil | PARCIAL | Batch 3/4 | nenhuma | fluxo atual precisa separar conferência de entrada definitiva | aplicar fonte única de transição |
| B-16 | Estoque real | IMPLEMENTADO | Batch 3/4 para correção de integração | nenhuma | risco de `ENTRY` antes/duplicado no fluxo atual | garantir criação somente na entrada definitiva |
| B-17 | Venda | FORA DO ROADMAP | futuro | contrato de vendas | requisito detalhado ausente e Batches 3–7 não incluem vendas | definir batch de vendas separado |
| B-18 | Fornecedores internos | IMPLEMENTADO | Batch 5/6 para mapping | nenhuma | falta merchant externo→fornecedor por loja | adicionar mapping sem substituir CRUD atual |
| B-19 | Produtos internos | IMPLEMENTADO | Batch 5/6 para mapping | nenhuma | falta item externo→Produto por loja | adicionar mapping revisado, sem criação automática |
| B-20 | Pagamentos | PARCIAL | futuro | providers e conciliação | somente financeiro manual; integração não aprovada | batch separado de pagamentos/conciliação |
| B-21 | Custos em USD | IMPLEMENTADO | Batch 5/7 para preservação analítica | nenhuma | staging deve preservar origem e consolidação | manter USD como consolidação oficial |
| B-22 | Custos em BRL | PARCIAL | Batch 7 | nenhuma técnica | contratos analíticos e moeda precisam ser tipados | usar BRL apenas para conversão/relatórios |
| B-23 | Cotação cambial | PARCIAL | Batch 5/7 | origem automática não definida | operação atual é manual | persistir taxa, instante, origem e resultado; integração futura separada |
| B-24 | Lucratividade | PARCIAL | Batch 7 | definição final das métricas se ausente | relatórios atuais têm contratos implícitos | tipar métricas e preservar markup/cálculos protegidos |
| B-25 | Responsabilidades por ator | NÃO LOCALIZADO | futuro | Product Owner deve definir funções, não nomes | apenas nomes foram citados sem responsabilidades verificáveis | converter funções aprovadas em perfis; nunca hardcode de pessoa |
| B-26 | Auditoria | PARCIAL | Batch 3 e 5 | nenhuma | `AuditLog` atual é insuficiente para eventos completos | ampliar mecanismo existente, sem sistema paralelo |
| B-27 | Permissões | PARCIAL | Batch 3 e 5 | nenhuma | matriz granular aprovada, ainda não implementada | aplicar P-05 estritamente aos fluxos aprovados |
| B-28 | Documentos e comprovantes | FORA DO ROADMAP | futuro | retenção, tipos e visibilidade | nenhum contrato normativo completo | batch próprio após arquitetura de storage |
| B-29 | Alertas | PARCIAL | Batch 7 e futuro | P-08 apenas para horário de quinta | alertas operacionais incompletos | implementar somente alertas computáveis; manter P-08 pendente |
| B-30 | Deadlines | PARCIAL | Batch 7 | P-08 para quinta de manhã | início/fim/timezone/efeito não definidos | não declarar atraso horário até decisão |
| B-31 | Relatórios | PARCIAL | Batch 7 | nenhuma técnica | contratos/tipos/filtros/exportação incompletos | concluir relatórios tipados e CSV seguro |
| B-32 | Status operacionais | PARCIAL | Batch 3, 5 e 7 | nenhuma | estados atuais e alvo ainda precisam de migration | backend como fonte única; projeções derivadas |
| B-33 | Transporte por viajante | PARCIAL | futuro | fluxo, custódia e responsabilidade | resumo não contém regras verificáveis | detalhar em contrato separado antes de ampliar |
| B-34 | Transporte por frete | PARCIAL | futuro | provider, tracking, custos e SLA | integrações fora dos Batches 3–7 | batch separado de transporte/integrações |
| B-35 | Venda e baixa patrimonial | NÃO LOCALIZADO | futuro | contrato comercial e contábil | fluxo detalhado não disponível | não implementar até fonte normativa |
| B-36 | Atores Anselmo, Bruno, Marco, Jaime, Dalila e Rafael | NÃO LOCALIZADO | futuro | responsabilidades de cada função | somente nomes citados no resumo | solicitar briefing canônico; RBAC nunca depende de nome |

## 3. Lacunas fora dos Batches 3–7

Os seguintes temas não devem ser absorvidos silenciosamente pelos batches já aprovados:

1. vendas e baixa patrimonial;
2. integrações de pagamentos e conciliação;
3. tracking automático e integrações de transportadoras;
4. documentos, comprovantes e política de retenção;
5. operação detalhada de galpão;
6. responsabilidades específicas de pessoas/atores;
7. transporte por viajante ou frete além dos modelos já existentes.

Cada tema requer contrato próprio, dependências verificadas, testes tenant-safe e aprovação de negócio antes da implementação.

## 4. Decisão pendente não bloqueadora

P-08 permanece exclusiva do Product Owner: definir hora inicial, hora final, timezone e se “quinta-feira de manhã” produz alerta ou bloqueio. Até lá, o período pode ser armazenado/filtrado, mas nenhum atraso baseado em hora pode ser calculado. Essa pendência não bloqueia o Batch 3.
