# Modelo de Dados V1

> **Status histórico:** modelo inicial de autenticação. O schema Prisma e as migrations são a fonte estrutural vigente; `PROJECT_CONTEXT_MASTER.md` resume os domínios adicionados depois.

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
