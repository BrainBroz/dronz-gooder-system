# Modelo de Dados V1

Entidades iniciais:

- Loja
- Usuario
- Perfil
- Permissao
- UsuarioLoja
- UsuarioPerfil
- PerfilPermissao
- RefreshToken
- AuditLog

Princípios:

- relacionamento explícito com loja quando aplicável;
- autenticação com refresh token revogável;
- trilha de auditoria desde a fundação;
- expansão futura para compras, estoque, remessas e financeiro.

