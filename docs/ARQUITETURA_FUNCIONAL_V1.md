# Arquitetura Funcional V1

O sistema começa com duas lojas independentes: Dronz e Gooder.

Fluxo inicial:

1. autenticação;
2. seleção de loja;
3. operação;
4. base para compras, estoque, remessas e financeiro;
5. auditoria de ações.

Regras iniciais:

- cada registro comercial mantém `lojaId`;
- o backend valida permissões;
- a interface não assume estoque compartilhado;
- movimentações futuras serão auditáveis;
- compras futuras consolidarão valores em USD.

