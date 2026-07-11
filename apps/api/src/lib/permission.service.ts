import { prisma } from "./prisma";
import { AppError } from "./app-error";

export async function checkPermission(
  usuarioId: string,
  lojaId: string,
  permissionCode: string,
  localizacaoId?: string
): Promise<boolean> {
  // 1. User must be active
  const user = await prisma.usuario.findUnique({
    where: { id: usuarioId }
  });
  if (!user || !user.active) return false;

  // 2. User must have UsuarioLoja vínculo
  const usuarioLoja = await prisma.usuarioLoja.findUnique({
    where: { usuarioId_lojaId: { usuarioId, lojaId } }
  });
  if (!usuarioLoja) return false;

  // 3. User must have permission via perfil
  const hasPermission = await prisma.perfilPermissao.findFirst({
    where: {
      perfil: {
        usuarioPerfis: { some: { usuarioId } }
      },
      permissao: { code: permissionCode }
    }
  });
  if (!hasPermission) return false;

  // 4. If localizacaoId required, user must have scope
  if (localizacaoId) {
    const hasScope = await prisma.usuarioLocalizacao.findUnique({
      where: { usuarioId_localizacaoId: { usuarioId, localizacaoId } }
    });
    if (!hasScope) return false;
  }

  return true;
}

export async function requirePermission(
  usuarioId: string,
  lojaId: string,
  permissionCode: string,
  localizacaoId?: string
) {
  const allowed = await checkPermission(
    usuarioId,
    lojaId,
    permissionCode,
    localizacaoId
  );
  if (!allowed) {
    throw new AppError(403, "permission_denied");
  }
}

export async function bumpAuthorizationVersion(
  tx: any,
  usuarioId: string
) {
  return tx.usuario.update({
    where: { id: usuarioId },
    data: { authorizationVersion: { increment: 1 } }
  });
}
