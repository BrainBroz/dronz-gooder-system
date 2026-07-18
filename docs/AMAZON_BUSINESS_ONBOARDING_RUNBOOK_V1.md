# Runbook operacional de onboarding Amazon Business — V1

**Gate:** 9.2

**Data da consulta oficial:** 2026-07-13

**Responsável administrativo:** Marco

**Estado:** `PENDENTE_DE_ONBOARDING_EXTERNO`; runbook preservado para retomada futura

Este runbook transforma o diagnóstico do Gate 9.1 em um pacote operacional. Ele não autoriza integração, não contém credenciais e não substitui instruções recebidas diretamente da Amazon Business. Toda evidência fornecida ao projeto deve ser sanitizada. A espera externa não bloqueia o gate eBay, o pipeline comum, e-mail autorizado ou painel mensal; quando a API Amazon for autorizada, ela será incorporada como fonte adicional.

## 1. Contexto e objetivo

| Item | Decisão vigente |
| --- | --- |
| Conta inicial | uma Amazon Business, arquitetura futura multi-conta |
| Escopo | compartilhada entre Dronz e Gooder |
| Marketplace | Amazon.com / Estados Unidos |
| Região | North America / `US` |
| Moeda inicial | USD |
| Backfill | 15 dias configuráveis |
| Sincronização futura | manual + automática configurável; quatro horas é proposta inicial |
| Aprovação | humana e obrigatória |
| Materialização/estoque | nunca automáticos |

O objetivo mínimo é comprovar acesso produtivo a `ORDERS` e `ORDER_ITEMS` pelo Reporting API. `SHIPMENTS`, `SHIPMENT_ITEMS`, `PACKAGE_TRACKING`, `DOCUMENTS`, `RECONCILIATION` e `USER_MANAGEMENT` são progressivas e não bloqueiam o núcleo.

## 2. Pré-requisitos

- Marco deve confirmar que sua identidade é administradora da conta Amazon Business e das entidades legais relevantes.
- A conta deve operar em Amazon.com/US.
- Deve existir um e-mail corporativo para o developer profile e contatos Amazon.
- O caso de uso sanitizado da seção 4 deve estar aprovado internamente.
- Redirect URIs e ambiente de deploy podem permanecer pendentes até a etapa indicada; não usar domínio inventado.
- O secret manager deve ser escolhido antes da autorização produtiva.

Fontes oficiais revalidadas:

- [Onboarding overview](https://docs.business.amazon.com/docs/onboarding-overview);
- [Amazon Business API roles](https://docs.business.amazon.com/docs/amazon-business-roles);
- [App Center authorization workflow](https://docs.business.amazon.com/docs/app-center-authorization-workflow);
- [Third-party website authorization workflow](https://docs.business.amazon.com/docs/website-authorization-workflow);
- [Reporting API v2025-06-09](https://docs.business.amazon.com/docs/reporting-api-v2025-06-09-reference);
- [Reporting API static sandbox](https://docs.business.amazon.com/docs/reporting-api-static-sandbox-guide);
- [Rate limits](https://docs.business.amazon.com/docs/rate-limits-in-amazon-business-apis);
- [LWA client secret rotation](https://docs.business.amazon.com/docs/lwa-client-secret-rotation).

## 3. Checklist operacional do portal

Status permitidos: `PENDENTE`, `EM_ANDAMENTO`, `CONCLUIDO`, `BLOQUEADO`, `NAO_APLICAVEL`.

### AB-ONB-01 — Confirmar administrador

- **Ação:** confirmar que Marco é administrador da conta e das entidades legais necessárias ao consentimento.
- **Portal ou página oficial:** Amazon Business, gestão da conta.
- **Responsável:** Marco.
- **Informação necessária:** papel administrativo e escopo das entidades legais.
- **Evidência sanitizada a guardar:** captura mostrando apenas status/papel, com e-mail e IDs mascarados.
- **Dado que não deve ser compartilhado:** senha, cookies, endereço completo, dados comerciais.
- **Status:** `PENDENTE`.

### AB-ONB-02 — Confirmar organização

- **Ação:** inventariar organização, entidades legais e identificação não secreta.
- **Portal ou página oficial:** Amazon Business, Business Settings.
- **Responsável:** Marco.
- **Informação necessária:** estrutura da organização e entidades abrangidas.
- **Evidência sanitizada a guardar:** nomes funcionais e IDs parcialmente mascarados.
- **Dado que não deve ser compartilhado:** dados fiscais, endereço ou pagamento não necessários.
- **Status:** `PENDENTE`.

### AB-ONB-03 — Verificar região e marketplace

- **Ação:** confirmar operação Amazon.com, marketplace US e região NA.
- **Portal ou página oficial:** Amazon Business e [endpoints oficiais](https://docs.business.amazon.com/docs/ab-api-endpoints).
- **Responsável:** Marco.
- **Informação necessária:** marketplace e região ativos.
- **Evidência sanitizada a guardar:** região `US` e endpoint NA, sem Order IDs.
- **Dado que não deve ser compartilhado:** histórico de pedidos.
- **Status:** `PENDENTE`.

### AB-ONB-04 — Criar ou validar developer profile

- **Ação:** iniciar a solicitação e, após aprovação, criar/validar o perfil no SPP.
- **Portal ou página oficial:** [Onboarding overview](https://docs.business.amazon.com/docs/onboarding-overview) e Solution Provider Portal.
- **Responsável:** Marco.
- **Informação necessária:** dados corporativos, contato e caso de uso.
- **Evidência sanitizada a guardar:** status e data da solicitação/aprovação.
- **Dado que não deve ser compartilhado:** credenciais do portal.
- **Status:** `PENDENTE`.

### AB-ONB-05 — Confirmar programa correto

- **Ação:** confirmar Amazon Business APIs buyer/Reporting, não SP-API seller.
- **Portal ou página oficial:** onboarding e catálogo Amazon Business APIs.
- **Responsável:** Marco.
- **Informação necessária:** uso de Reporting API para compras realizadas.
- **Evidência sanitizada a guardar:** nome do produto/API indicado pela Amazon.
- **Dado que não deve ser compartilhado:** mensagens internas não necessárias.
- **Status:** `PENDENTE`.

### AB-ONB-06 — Solicitar onboarding

- **Ação:** enviar a solicitação de acesso com o texto sanitizado da seção 4.
- **Portal ou página oficial:** canal indicado no [Onboarding overview](https://docs.business.amazon.com/docs/onboarding-overview).
- **Responsável:** Marco.
- **Informação necessária:** contato, organização, indústria, tamanho, caso de uso e APIs solicitadas.
- **Evidência sanitizada a guardar:** protocolo/data e status.
- **Dado que não deve ser compartilhado:** conteúdo comercial além do necessário.
- **Status:** `PENDENTE`.

### AB-ONB-07 — Solicitar Amazon Business Analytics

- **Ação:** solicitar o papel que libera Reporting API.
- **Portal ou página oficial:** onboarding/DRAF e [API roles](https://docs.business.amazon.com/docs/amazon-business-roles).
- **Responsável:** Marco.
- **Informação necessária:** `ORDERS` e `ORDER_ITEMS` como núcleo mínimo.
- **Evidência sanitizada a guardar:** papel solicitado e posterior decisão.
- **Dado que não deve ser compartilhado:** tokens ou dados de pedidos.
- **Status:** `PENDENTE`.

### AB-ONB-08 — Solicitar papéis progressivos

- **Ação:** avaliar Amazon Business Order Placement, Business Purchase Reconciliation e User Management.
- **Portal ou página oficial:** [API roles](https://docs.business.amazon.com/docs/amazon-business-roles).
- **Responsável:** Marco, com validação técnica.
- **Informação necessária:** necessidade real de tracking, documentos, reconciliação e usuários.
- **Evidência sanitizada a guardar:** papel, status e capability correspondente.
- **Dado que não deve ser compartilhado:** justificativas comerciais sensíveis.
- **Status:** `PENDENTE`.

### AB-ONB-09 — Registrar contato técnico Amazon

- **Ação:** identificar o contato técnico atribuído pela Amazon.
- **Portal ou página oficial:** correspondência de onboarding/SPP.
- **Responsável:** Marco.
- **Informação necessária:** canal e escopo de suporte.
- **Evidência sanitizada a guardar:** nome funcional ou fila de suporte, sem conversa privada.
- **Dado que não deve ser compartilhado:** e-mail pessoal sem necessidade.
- **Status:** `PENDENTE`.

### AB-ONB-10 — Registrar contato administrativo

- **Ação:** confirmar Marco e um substituto autorizado.
- **Portal ou página oficial:** registro administrativo interno e SPP.
- **Responsável:** Marco.
- **Informação necessária:** responsabilidade por consentimento e revogação.
- **Evidência sanitizada a guardar:** função e status, não credencial.
- **Dado que não deve ser compartilhado:** telefone pessoal ou senha.
- **Status:** `PENDENTE`.

### AB-ONB-11 — Criar app client

- **Ação:** após autorização, criar app client sandbox/draft e posteriormente produção.
- **Portal ou página oficial:** SPP e [visualização da aplicação](https://docs.business.amazon.com/docs/viewing-your-application-information-and-credentials).
- **Responsável:** Marco com responsável técnico.
- **Informação necessária:** nome, tipo, papéis e URLs aprovadas.
- **Evidência sanitizada a guardar:** Application ID parcialmente mascarado e status.
- **Dado que não deve ser compartilhado:** client secret.
- **Status:** `PENDENTE`.

### AB-ONB-12 — Configurar redirect URI

- **Ação:** registrar URI exata do ambiente que executará OAuth.
- **Portal ou página oficial:** configuração do app client no SPP.
- **Responsável:** responsável técnico, com aprovação de Marco.
- **Informação necessária:** URI HTTPS real; desenvolvimento somente se aceito pela Amazon.
- **Evidência sanitizada a guardar:** host/rota aprovados, sem query ou code.
- **Dado que não deve ser compartilhado:** authorization code ou parâmetros de sessão.
- **Status:** `BLOQUEADO` até definição do ambiente.

### AB-ONB-13 — Configurar LWA

- **Ação:** obter client ID e guardar o client secret diretamente no cofre.
- **Portal ou página oficial:** SPP/LWA.
- **Responsável:** responsável técnico.
- **Informação necessária:** referência do segredo e política de acesso.
- **Evidência sanitizada a guardar:** client ID mascarado e nome opaco da referência.
- **Dado que não deve ser compartilhado:** client secret.
- **Status:** `PENDENTE`.

### AB-ONB-14 — Realizar consentimento administrativo

- **Ação:** iniciar OAuth com state seguro e consentir usando conta administradora Business.
- **Portal ou página oficial:** [authorization workflow](https://docs.business.amazon.com/docs/website-authorization-workflow).
- **Responsável:** Marco.
- **Informação necessária:** aplicação, papéis e entidade legal abrangida.
- **Evidência sanitizada a guardar:** status/data do consentimento.
- **Dado que não deve ser compartilhado:** authorization code, refresh/access token.
- **Status:** `PENDENTE`.

### AB-ONB-15 — Confirmar autorização da organização

- **Ação:** validar que o consentimento cobre as entidades necessárias e região US.
- **Portal ou página oficial:** Amazon Business consent/SPP.
- **Responsável:** Marco.
- **Informação necessária:** organização e escopo autorizado.
- **Evidência sanitizada a guardar:** status e IDs mascarados.
- **Dado que não deve ser compartilhado:** PII dos compradores.
- **Status:** `PENDENTE`.

### AB-ONB-16 — Definir revogação

- **Ação:** documentar quem revoga, como desabilita a conexão e como invalida acesso ao cofre.
- **Portal ou página oficial:** Amazon Business/SPP e secret manager escolhido.
- **Responsável:** Marco e responsável técnico.
- **Informação necessária:** sequência, contatos e SLA interno.
- **Evidência sanitizada a guardar:** data, ator e resultado da simulação documental.
- **Dado que não deve ser compartilhado:** valores revogados.
- **Status:** `PENDENTE`.

### AB-ONB-17 — Definir rotação

- **Ação:** criar alerta e procedimento para rotação do client secret.
- **Portal ou página oficial:** [LWA secret rotation](https://docs.business.amazon.com/docs/lwa-client-secret-rotation).
- **Responsável:** responsável técnico ainda a definir.
- **Informação necessária:** vencimento, janela de transição e responsável.
- **Evidência sanitizada a guardar:** datas e confirmação, sem secret.
- **Dado que não deve ser compartilhado:** secret antigo ou novo.
- **Status:** `PENDENTE`.

### AB-ONB-18 — Obter sandbox

- **Ação:** criar app sandbox e testar o fluxo LWA estático.
- **Portal ou página oficial:** [sandbox](https://docs.business.amazon.com/docs/amazon-business-api-sandbox) e [Reporting sandbox](https://docs.business.amazon.com/docs/reporting-api-static-sandbox-guide).
- **Responsável:** responsável técnico.
- **Informação necessária:** app sandbox, região NA e casos de teste oficiais.
- **Evidência sanitizada a guardar:** HTTP status, endpoint e campos, indicando `SANDBOX ESTATICO`.
- **Dado que não deve ser compartilhado:** credenciais/tokens sandbox.
- **Status:** `PENDENTE`.

### AB-ONB-19 — Preparar teste produtivo controlado

- **Ação:** executar a prova mínima da seção 9 sem persistir compras.
- **Portal ou página oficial:** Reporting API NA.
- **Responsável:** responsável técnico, autorizado por Marco.
- **Informação necessária:** janela curta, `region=US`, endpoints e sanitização.
- **Evidência sanitizada a guardar:** formulário da seção 10.
- **Dado que não deve ser compartilhado:** payload completo, PII, tokens e headers de autorização.
- **Status:** `PENDENTE`.

### AB-ONB-20 — Registrar suporte Amazon

- **Ação:** registrar canal para papéis, limites, incidentes e revogação urgente.
- **Portal ou página oficial:** SPP/Support e contato fornecido no onboarding.
- **Responsável:** Marco.
- **Informação necessária:** filas e finalidade de cada contato.
- **Evidência sanitizada a guardar:** referência do caso/protocolo.
- **Dado que não deve ser compartilhado:** conversa ou dados de conta desnecessários.
- **Status:** `PENDENTE`.

## 4. Descrição sanitizada para a Amazon

> Dronz & Gooder System é um sistema interno de gestão de compras e logística internacional. Dronz e Gooder utilizam uma conta Amazon Business compartilhada como compradores. A integração solicitada lerá pedidos e itens do Amazon Business Reporting API para uma staging global restrita, onde cada compra será reconciliada e obrigatoriamente aprovada por uma pessoa autorizada. Depois da aprovação, itens e quantidades poderão ser atribuídos a Dronz ou Gooder e materializados explicitamente nos fluxos internos. A ingestão não cria estoque, recebimento, logística ou materialização automaticamente. O acesso é protegido por autenticação e RBAC, todas as mutações relevantes são auditáveis e as operações de sincronização serão idempotentes. Credenciais permanecerão fora do banco em cofre de segredos com acesso mínimo, rotação e revogação. Dados serão usados somente na operação interna, com retenção mínima, sem revenda e sem exposição pública.

Informar no formulário somente o necessário. Não anexar pedidos reais, dados de pagamento, endereços ou credenciais.

## 5. Matriz de papéis a solicitar

| Capability interna | API/relatório oficial | Papel Amazon provável | Núcleo V1 | Pode esperar | Evidência necessária |
| --- | --- | --- | ---: | ---: | --- |
| `ORDERS` | `orderReports` | Amazon Business Analytics | Sim | Não | papel concedido + HTTP 200 produtivo |
| `ORDER_ITEMS` | `orderLineItemReports` | Amazon Business Analytics | Sim | Não | papel concedido + HTTP 200 produtivo |
| `SHIPMENTS` | `shipmentReports` | Amazon Business Analytics | Não | Sim | resposta produtiva e campos presentes |
| `SHIPMENT_ITEMS` | `shipmentLineItemReports` | Amazon Business Analytics | Não | Sim | resposta produtiva e paginação |
| `PACKAGE_TRACKING` | Package Tracking API | Amazon Business Order Placement | Não | Sim | papel, IDs de pacote e HTTP 200 |
| `DOCUMENTS` | Document API | Business Purchase Reconciliation | Não | Sim | papel e formato/escopo NA comprovados |
| `RECONCILIATION` | Reconciliation API | Business Purchase Reconciliation | Não | Sim | papel e transações sanitizadas |
| `USER_MANAGEMENT` | User Management API | User Management, processo offline | Não | Sim | papel concedido, Account Authority e grupo |

Para cada capability, manter estados separados: `DOCUMENTADO`, `SOLICITADO`, `CONCEDIDO`, `AUTORIZADO`, `TESTADO`. Nenhuma progressão é inferida; cada mudança exige evidência sanitizada.

## 6. Evidências sanitizadas

Pode ser fornecido ao projeto:

- captura do status de aprovação, com PII mascarada;
- Application ID parcialmente mascarado;
- papéis concedidos e datas;
- região, marketplace e capabilities;
- status do consentimento;
- nomes de campos presentes/ausentes;
- status HTTP, request ID mascarado e `x-amzn-RateLimit-Limit`;
- indicação de `nextPageToken`, sem seu valor;
- amostra estrutural substituindo valores por tipos ou placeholders.

Nunca fornecer:

- client secret;
- refresh/access token;
- authorization code;
- cookie, senha ou authorization header;
- payload comercial completo;
- PII não necessária.

As evidências devem ficar em repositório administrativo seguro. Somente documentação sanitizada pode entrar no Git.

## 7. Secret management

| Opção | Uso aceitável | Pontos obrigatórios |
| --- | --- | --- |
| Secret manager do provedor de hospedagem | homologação/produção quando o deploy for definido | IAM, logs, rotação, ambientes separados |
| AWS Secrets Manager | candidato | IAM mínimo, CloudTrail, rotação e recuperação |
| Google Secret Manager | candidato | IAM mínimo, audit logs, versões e ambientes |
| Azure Key Vault | candidato | RBAC/IAM, logs, versões e soft delete |
| variável de ambiente local | somente desenvolvimento | arquivo ignorado, máquina controlada e nunca compartilhado |

Critérios eliminatórios:

- segredo nunca no banco, Git, AuditLog, resposta HTTP ou log;
- segregação dev/homolog/prod;
- referência opaca persistível em `secretReference`;
- controle e logs de acesso;
- revogação e rotação;
- recuperação segura e responsável definido.

Fornecedor definitivo permanece decisão aberta até definição do ambiente de deploy. Não implementar criptografia própria.

## 8. OAuth, URLs e ambientes

O fluxo usa LWA authorization code com validação de `state`. O authorization code deve ser trocado imediatamente e nunca registrado. O refresh token vai diretamente ao secret manager; access tokens permanecem efêmeros.

| Ambiente | Login/redirect URI | Callback | Status |
| --- | --- | --- | --- |
| Desenvolvimento | `<DEFINIR_URI_LOCAL_ACEITA_PELA_AMAZON>` | `<DEFINIR_CALLBACK_LOCAL>` | aberto |
| Homologação | `<DEFINIR_URI_HTTPS_HOMOLOGACAO>` | `<DEFINIR_CALLBACK_HTTPS_HOMOLOGACAO>` | bloqueado pelo deploy |
| Produção | `<DEFINIR_URI_HTTPS_PRODUCAO>` | `<DEFINIR_CALLBACK_HTTPS_PRODUCAO>` | bloqueado pelo deploy |

Inventário adicional:

| Finalidade | Valor | Exposição | Status |
| --- | --- | --- | --- |
| endpoint interno de status da conexão | `<DEFINIR_ENDPOINT_INTERNO_STATUS>` | autenticado e sem secrets | aberto |
| origem pública de homologação | `<DEFINIR_ORIGEM_HTTPS_HOMOLOGACAO>` | HTTPS | aberto |
| origem pública de produção | `<DEFINIR_ORIGEM_HTTPS_PRODUCAO>` | HTTPS | aberto |
| landing/login URI exigida pelo fluxo escolhido | `<DEFINIR_LOGIN_URI>` | HTTPS, sem token na URL | aberto |

`localhost` nunca será registrado como produção. A URI configurada no SPP deve coincidir exatamente com a usada no OAuth.

## 9. Prova de acesso mínima antes do adapter Amazon

Executar fora do repositório, sem persistência no banco:

1. comprovar autorização LWA válida sem revelar tokens;
2. obter access token em memória;
3. consultar `/reports/2025-06-09/orderReports` com janela curta e `region=US`;
4. consultar `/reports/2025-06-09/orderLineItemReports` para a mesma janela;
5. quando houver `nextPageToken`, comprovar a segunda página com os mesmos filtros;
6. confirmar Order ID, data, status e moeda;
7. confirmar line item ID, quantidade e preço/moeda quando presentes;
8. inventariar comprador/grupo/aprovador somente quando retornados;
9. registrar HTTP status, request ID e rate limit sem tokens;
10. confirmar que stdout, stderr e ferramenta não gravaram segredo;
11. gerar apenas o formulário sanitizado da seção 10;
12. remover arquivos temporários e revogar qualquer token criado apenas para teste, quando aplicável.

Sandbox valida formato e autenticação de teste, mas não satisfaz o gate de acesso produtivo.

## 10. Formulário de prova sanitizada

```text
Data do teste:
Ambiente: SANDBOX_ESTATICO | PRODUCAO_CONTROLADA
Região:
Marketplace:
Application ID mascarado:
Papéis concedidos:
Capability testada:
Endpoint e versão:
Intervalo de datas, sem dados comerciais:
Status HTTP:
Request ID mascarado:
Rate limit observado:
Paginação: AUSENTE | PRESENTE_E_TESTADA
Campos presentes:
Campos ausentes:
PII encontrada: NAO | SIM, categorias sem valores
Persistência realizada: NAO
Logs revisados sem secrets: SIM | NAO
Resultado: APROVADO | FALHOU
Motivo, se falhou:
Responsável pelo teste:
```

Não anexar payload, token, header de autorização, Order ID completo ou dados pessoais.

## 11. Troubleshooting

| Sintoma | Verificação segura | Ação |
| --- | --- | --- |
| onboarding sem resposta | protocolo, data e canal oficial | contatar suporte/onboarding sem reenviar credenciais |
| app/role ausente | status no SPP e decisão Amazon | solicitar papel; não contornar com outra API |
| redirect mismatch | comparar URI exata e ambiente | corrigir configuração antes de novo consentimento |
| `invalid_grant` | idade do authorization code e uso único | reiniciar consentimento; nunca reutilizar code |
| `401`/token expirado | horário e fluxo de refresh | renovar access token sem logar o refresh token |
| `403` | papel, consentimento, região e entidade legal | validar com contato Amazon; não ampliar escopo localmente |
| `429` | rate header e operação | backoff exponencial com jitter; reduzir frequência |
| resposta vazia | região, janela, status e conta | validar filtros; não fabricar dados de teste |
| token de paginação falha | parâmetros da primeira página | repetir exatamente os filtros e trocar apenas token |
| segredo suspeito de exposição | logs, terminal e histórico | interromper, revogar/rotacionar e registrar incidente sanitizado |

## 12. Revogação e rollback operacional

Em revogação, incidente ou desistência:

1. interromper novas sincronizações;
2. desativar a conexão lógica sem apagar auditoria;
3. revogar consentimento/token no canal Amazon aplicável;
4. remover acesso da aplicação ao secret manager;
5. rotacionar client secret se houver suspeita de exposição;
6. preservar somente evidência sanitizada do incidente;
7. confirmar que nenhum job continua usando a referência;
8. não apagar compras/evidências legítimas já aprovadas;
9. comunicar Marco e o responsável técnico;
10. reabrir acesso somente após nova prova controlada.

## 13. Critérios para liberar o futuro batch do adapter Amazon

Todos precisam estar comprovados:

- developer profile aprovado;
- aplicação criada;
- Amazon Business Analytics concedido;
- LWA configurado;
- consentimento administrativo concluído;
- secret manager ou estratégia segura definida;
- `ORDERS` acessível em produção;
- `ORDER_ITEMS` acessível em produção;
- região US confirmada;
- paginação confirmada;
- campos reais inventariados;
- rate limit real registrado;
- resposta sanitizada validada;
- logs verificados sem segredos.

As capabilities progressivas não bloqueiam o núcleo e só podem ser implementadas depois de `CONCEDIDO`, `AUTORIZADO` e `TESTADO` próprios.

## 14. Decisões externas abertas

- secret manager definitivo;
- ambiente de deploy e domínios;
- redirect URIs finais;
- papéis adicionais além de Analytics;
- configuração de usuários e grupos;
- responsável técnico por rotação/revogação;
- retenção de respostas e documentos;
- tolerância monetária;
- frequência final após limites e volume reais.

## 15. Contatos e responsabilidades

| Responsabilidade | Responsável |
| --- | --- |
| autorização administrativa e revogação | Marco |
| contato inicial com Amazon | Marco |
| criação do app client | Marco + responsável técnico a definir |
| secret manager e rotação | responsável técnico a definir |
| prova produtiva sanitizada | responsável técnico autorizado por Marco |
| aprovação de compras no sistema | perfis funcionais; nunca nomes hardcoded |
| suporte Amazon | contato/fila a registrar durante onboarding |

## 16. Gate atual

`RUNBOOK PRESERVADO — PENDENTE_DE_ONBOARDING_EXTERNO`

Este documento não inicia adapter Amazon e não comprova acesso à conta. Enquanto isso, a fonte inicial Amazon planejada é e-mail autorizado, sempre sujeita a reconciliação e aprovação humana.
