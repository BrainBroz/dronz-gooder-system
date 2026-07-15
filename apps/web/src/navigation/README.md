# Fundação de navegação (UX-0)

Este diretório contém a estrutura-alvo de navegação definida em
`docs/UX_OPERATIONAL_FOUNDATION_V1.md` (seção 5), preparada para uso
gradual pelos próximos batches (UX-1 em diante).

Nesta etapa (UX-0) os tipos e a árvore de navegação são apenas
**declarados e testados isoladamente** — nada em `app.tsx` foi trocado
e nenhuma tela nova foi criada. O shell atual continua ativo e é quem
efetivamente decide o que o usuário vê.

## Natureza exclusivamente declarativa

`navigationTree` é dado estático de UI. Ele:

- **não é fonte de verdade para RBAC** — não decide quem vê o quê;
- **não calcula badges** — `badgeSource` é apenas um rótulo indicando
  de onde a contagem deve vir quando existir, nunca um valor;
- **não decide estados** — não sabe o que está pendente, bloqueado,
  disponível ou concluído;
- **não substitui `allowedActions`/`blockedReasons`** nem qualquer
  outro contrato do backend.

Quando um batch futuro adotar `navigationTree`, ele deve:

- derivar o menu visível a partir de permissões reais do usuário,
  consultadas no backend (nunca hardcode de nome ou papel, conforme
  UX_OPERATIONAL_FOUNDATION_V1.md §5);
- preencher badges exclusivamente a partir de read models do backend
  que representem trabalho pendente, nunca por contagem local de
  registros já carregados no cliente;
- preservar o seletor de escopo Todas/Dronz/Gooder como front do RBAC,
  não como bypass de tenancy.
