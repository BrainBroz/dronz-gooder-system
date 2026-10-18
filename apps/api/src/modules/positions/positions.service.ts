import {
  expectationSelect,
  pendingAt,
  undeclaredRedirect
} from "./expectations";
import {
  Prisma,
  type PapelResponsabilidade,
  type TipoPosicao
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";

export const MIAMI_BASE_ID = "posicao-miami-base";
const ORIGIN = "API_POSITIONS";

type Db = Prisma.TransactionClient | typeof prisma;
export type Actor = { userId: string; permissions: string[] };

const can = (actor: Actor, code: string) =>
  actor.permissions.includes("SYSTEM_ADMIN") ||
  actor.permissions.includes(code);

const activeAt = (at: Date) => ({
  revogadoEm: null,
  validoDe: { lte: at },
  OR: [{ validoAte: null }, { validoAte: { gt: at } }]
});

// D-12: operar numa posição exige permissão sobre todas as posições ou vínculo contextual vigente.
export async function canOperateAt(
  db: Db,
  actor: Actor,
  posicaoId: string,
  at = new Date()
) {
  if (can(actor, "LOGISTICA_POSICOES_TODAS")) return true;
  const link = await db.responsabilidadeContextual.findFirst({
    where: { posicaoId, usuarioId: actor.userId, ...activeAt(at) },
    select: { id: true }
  });
  return !!link;
}

// Posição precisa estar ativa e o ator autorizado; bloqueios são explicáveis (D-16 para posição encerrada).
export async function assertOperable(db: Db, actor: Actor, posicaoId: string) {
  const position = await db.posicaoOperacional.findUnique({
    where: { id: posicaoId }
  });
  if (!position) throw new AppError(404, "position_not_found");
  if (position.status === "ENCERRADA")
    throw new AppError(409, "position_closed");
  if (position.status !== "ATIVA") throw new AppError(409, "position_inactive");
  if (!(await canOperateAt(db, actor, posicaoId)))
    throw new AppError(403, "position_not_authorized");
  return position;
}

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// D-10: pendências que impedem o encerramento de uma posição temporária.
// Auditoria PD (item 4): quem cria pendência numa posição (destino de pedido ou pacote, conteúdo de
// pacote) "reivindica" a linha da posição com UPDATE condicional. Se o encerramento já passou, o UPDATE
// reavalia o status e não acha linha; se o encerramento vier depois, ele trava uma linha alterada por
// outra transação e falha por serialização (409), e a nova tentativa enxerga a pendência.
export async function claimOpenPosition(db: Db, posicaoId: string) {
  const claimed =
    await db.$executeRaw`UPDATE "PosicaoOperacional" SET "updatedAt" = now() WHERE id = ${posicaoId} AND status NOT IN ('ENCERRADA', 'CANCELADA')`;
  if (!claimed) {
    const exists = await db.posicaoOperacional.count({
      where: { id: posicaoId }
    });
    throw new AppError(
      exists ? 409 : 404,
      exists ? "position_closed" : "position_not_found"
    );
  }
}

export async function closurePendencies(db: Db, posicaoId: string) {
  const [pendingItems, openBags, reservations] = await Promise.all([
    // Itens destinados pelo pedido ou por pacote redirecionado a esta posição (auditoria D-15/PD-04).
    db.pedidoCompraItem.findMany({
      where: {
        pedido: {
          status: { notIn: ["CANCELLED", "COMPLETED", "DRAFT"] },
          OR: [
            { destinoPosicaoId: posicaoId },
            {
              compraImportada: {
                enviosExternos: {
                  some: { pacotes: { some: { destinoPosicaoId: posicaoId } } }
                }
              }
            }
          ]
        }
      },
      select: expectationSelect
    }),
    db.mala.count({
      where: { posicaoId, status: { in: ["PLANNING", "CLOSED"] } }
    }),
    db.alocacaoMala.count({
      where: { status: "RESERVADA", mala: { posicaoId } }
    })
  ]);
  const notReceived = pendingItems.filter(
    (item) =>
      pendingAt(item, posicaoId) > 0 ||
      // Pacote redirecionado para cá sem conteúdo declarado: não dá para saber que nada falta.
      undeclaredRedirect(item, posicaoId)
  ).length;
  return [
    ...(notReceived
      ? [
          {
            code: "ITEMS_NOT_RECEIVED",
            message: `${notReceived} item(ns) destinados ainda não recebidos.`
          }
        ]
      : []),
    ...(openBags
      ? [
          {
            code: "VOLUMES_NOT_DISPATCHED",
            message: `${openBags} mala(s) ainda não despachadas.`
          }
        ]
      : []),
    ...(reservations
      ? [
          {
            code: "RESERVATIONS_OPEN",
            message: `${reservations} reserva(s) em aberto.`
          }
        ]
      : [])
  ];
}

async function decorate(
  db: Db,
  actor: Actor,
  position: Prisma.PosicaoOperacionalGetPayload<{
    include: {
      local: true;
      responsabilidades: {
        include: { usuario: { select: { id: true; name: true } } };
      };
    };
  }>
) {
  const now = new Date();
  const manage = can(actor, "LOGISTICA_POSICOES_GERENCIAR");
  const responsible = position.responsabilidades.some(
    (entry) =>
      entry.usuarioId === actor.userId &&
      !entry.revogadoEm &&
      entry.validoDe <= now &&
      (!entry.validoAte || entry.validoAte > now)
  );
  const blockedReasons =
    position.status === "ATIVA" && position.tipo === "TEMPORARIA"
      ? await closurePendencies(db, position.id)
      : [];
  const allowedActions: string[] = [];
  if (manage) {
    if (position.status === "CRIADA") allowedActions.push("ATIVAR", "CANCELAR");
    if (
      position.status === "ATIVA" &&
      position.tipo === "TEMPORARIA" &&
      !blockedReasons.length
    )
      allowedActions.push("ENCERRAR");
    if (position.status === "ENCERRADA") allowedActions.push("REABRIR");
    if (position.status !== "ENCERRADA" && position.status !== "CANCELADA")
      allowedActions.push("GERENCIAR_RESPONSAVEIS");
  }
  const { endereco, ...local } = position.local;
  return {
    ...position,
    // D-7: endereço completo só para quem gerencia ou responde pela posição.
    local: manage || responsible ? { ...local, endereco } : local,
    responsabilidades: position.responsabilidades.filter(
      (entry) => !entry.revogadoEm
    ),
    sugestaoEncerramento:
      position.status === "ATIVA" &&
      position.tipo === "TEMPORARIA" &&
      !blockedReasons.length,
    allowedActions,
    blockedReasons
  };
}

const positionInclude = {
  local: true,
  responsabilidades: {
    include: { usuario: { select: { id: true, name: true } } },
    orderBy: { validoDe: "asc" }
  }
} satisfies Prisma.PosicaoOperacionalInclude;

export async function list(actor: Actor) {
  const where =
    can(actor, "LOGISTICA_POSICOES_VISUALIZAR") ||
    can(actor, "LOGISTICA_POSICOES_TODAS")
      ? {}
      : {
          responsabilidades: {
            some: { usuarioId: actor.userId, ...activeAt(new Date()) }
          }
        };
  const positions = await prisma.posicaoOperacional.findMany({
    where,
    include: positionInclude,
    orderBy: [{ tipo: "asc" }, { createdAt: "asc" }]
  });
  return Promise.all(
    positions.map((position) => decorate(prisma, actor, position))
  );
}

export async function get(actor: Actor, id: string) {
  const position = await prisma.posicaoOperacional.findUnique({
    where: { id },
    include: positionInclude
  });
  const visible =
    position &&
    (can(actor, "LOGISTICA_POSICOES_VISUALIZAR") ||
      can(actor, "LOGISTICA_POSICOES_TODAS") ||
      (await canOperateAt(prisma, actor, id)));
  if (!position || !visible) throw new AppError(404, "not_found");
  return decorate(prisma, actor, position);
}

async function serializable<T>(
  fn: (tx: Prisma.TransactionClient, correlationId: string) => Promise<T>
) {
  try {
    return await prisma.$transaction((tx) => fn(tx, randomUUID()), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" ||
        (error.code === "P2010" && error.meta?.code === "40001"))
    )
      throw new AppError(409, "concurrent_modification");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new AppError(409, "duplicate_code");
    throw error;
  }
}

export async function create(
  actor: Actor,
  d: {
    codigo: string;
    nome: string;
    tipo: TipoPosicao;
    inicioEm?: Date;
    fimEm?: Date;
    local: {
      alias: string;
      cidade: string;
      estado?: string;
      pais: string;
      timezone: string;
      endereco?: string;
    };
  }
) {
  if (!validTimezone(d.local.timezone))
    throw new AppError(400, "invalid_timezone");
  if (
    d.tipo === "TEMPORARIA" &&
    (!d.inicioEm || !d.fimEm || d.fimEm <= d.inicioEm)
  )
    throw new AppError(400, "invalid_period");
  if (d.tipo === "PERMANENTE" && d.fimEm)
    throw new AppError(400, "invalid_period");
  return serializable(async (tx, correlationId) => {
    const local = await tx.local.create({ data: d.local });
    const created = await tx.posicaoOperacional.create({
      data: {
        localId: local.id,
        codigo: d.codigo,
        nome: d.nome,
        tipo: d.tipo,
        inicioEm: d.inicioEm,
        fimEm: d.fimEm
      },
      include: positionInclude
    });
    await audit(tx, {
      usuarioId: actor.userId,
      permissionCode: "LOGISTICA_POSICOES_GERENCIAR",
      action: "CREATE_POSITION",
      entity: "PosicaoOperacional",
      entityId: created.id,
      correlationId,
      after: created,
      origin: ORIGIN
    });
    return decorate(tx, actor, created);
  });
}

export async function transition(
  actor: Actor,
  id: string,
  action: "ATIVAR" | "ENCERRAR" | "CANCELAR" | "REABRIR",
  motivo?: string
) {
  return serializable(async (tx, correlationId) => {
    await tx.$queryRaw`SELECT id FROM "PosicaoOperacional" WHERE id = ${id} FOR UPDATE`;
    const position = await tx.posicaoOperacional.findUnique({ where: { id } });
    if (!position) throw new AppError(404, "not_found");
    const now = new Date();
    let data: Prisma.PosicaoOperacionalUpdateInput;
    if (action === "ATIVAR" && position.status === "CRIADA")
      data = { status: "ATIVA" };
    else if (action === "CANCELAR" && position.status === "CRIADA") {
      const used =
        (await tx.pedidoCompra.count({ where: { destinoPosicaoId: id } })) +
        (await tx.pacoteExterno.count({ where: { destinoPosicaoId: id } })) +
        (await tx.mala.count({ where: { posicaoId: id } })) +
        (await tx.recebimentoMiami.count({ where: { posicaoId: id } }));
      if (used) throw new AppError(409, "position_in_use");
      data = { status: "CANCELADA" };
    } else if (action === "ENCERRAR" && position.status === "ATIVA") {
      if (position.tipo !== "TEMPORARIA")
        throw new AppError(409, "permanent_position");
      const pendencies = await closurePendencies(tx, id);
      if (pendencies.length)
        throw new AppError(409, pendencies[0]!.code.toLowerCase());
      // Encerramento revoga os vínculos contextuais; reabertura exige renová-los explicitamente.
      await tx.responsabilidadeContextual.updateMany({
        where: { posicaoId: id, revogadoEm: null },
        data: { revogadoEm: now }
      });
      data = { status: "ENCERRADA", encerradaEm: now };
    } else if (action === "REABRIR" && position.status === "ENCERRADA") {
      if (!motivo?.trim()) throw new AppError(400, "reason_required");
      data = { status: "ATIVA", encerradaEm: null };
    } else throw new AppError(409, "invalid_transition");
    const updated = await tx.posicaoOperacional.update({
      where: { id },
      data,
      include: positionInclude
    });
    await audit(tx, {
      usuarioId: actor.userId,
      permissionCode: "LOGISTICA_POSICOES_GERENCIAR",
      action: `POSITION_${action}`,
      entity: "PosicaoOperacional",
      entityId: id,
      correlationId,
      reason: motivo,
      before: position,
      after: updated,
      origin: ORIGIN
    });
    return decorate(tx, actor, updated);
  });
}

export async function addResponsibility(
  actor: Actor,
  posicaoId: string,
  d: {
    usuarioId: string;
    papel: PapelResponsabilidade;
    validoDe: Date;
    validoAte?: Date;
  }
) {
  return serializable(async (tx, correlationId) => {
    await tx.$queryRaw`SELECT id FROM "PosicaoOperacional" WHERE id = ${posicaoId} FOR UPDATE`;
    const position = await tx.posicaoOperacional.findUnique({
      where: { id: posicaoId }
    });
    if (!position) throw new AppError(404, "not_found");
    if (position.status === "ENCERRADA" || position.status === "CANCELADA")
      throw new AppError(409, "position_closed");
    const user = await tx.usuario.findUnique({ where: { id: d.usuarioId } });
    if (!user?.active) throw new AppError(409, "user_inactive");
    const validoAte =
      d.validoAte ??
      (position.tipo === "TEMPORARIA"
        ? (position.fimEm ?? undefined)
        : undefined);
    if (validoAte && validoAte <= d.validoDe)
      throw new AppError(400, "invalid_period");
    if (d.papel === "PRINCIPAL") {
      // D-9: um único responsável principal por período, sem sobreposição.
      const overlapping = await tx.responsabilidadeContextual.findFirst({
        where: {
          posicaoId,
          papel: "PRINCIPAL",
          revogadoEm: null,
          OR: [{ validoAte: null }, { validoAte: { gt: d.validoDe } }],
          ...(validoAte ? { validoDe: { lt: validoAte } } : {})
        }
      });
      if (overlapping) throw new AppError(409, "principal_overlap");
    }
    const created = await tx.responsabilidadeContextual.create({
      data: {
        posicaoId,
        usuarioId: d.usuarioId,
        papel: d.papel,
        validoDe: d.validoDe,
        validoAte
      },
      include: { usuario: { select: { id: true, name: true } } }
    });
    await audit(tx, {
      usuarioId: actor.userId,
      permissionCode: "LOGISTICA_POSICOES_GERENCIAR",
      action: "ADD_POSITION_RESPONSIBILITY",
      entity: "ResponsabilidadeContextual",
      entityId: created.id,
      correlationId,
      after: created,
      origin: ORIGIN
    });
    return created;
  });
}

export async function revokeResponsibility(
  actor: Actor,
  posicaoId: string,
  id: string
) {
  return serializable(async (tx, correlationId) => {
    const link = await tx.responsabilidadeContextual.findFirst({
      where: { id, posicaoId }
    });
    if (!link) throw new AppError(404, "not_found");
    if (link.revogadoEm) return link;
    const updated = await tx.responsabilidadeContextual.update({
      where: { id },
      data: { revogadoEm: new Date() }
    });
    await audit(tx, {
      usuarioId: actor.userId,
      permissionCode: "LOGISTICA_POSICOES_GERENCIAR",
      action: "REVOKE_POSITION_RESPONSIBILITY",
      entity: "ResponsabilidadeContextual",
      entityId: id,
      correlationId,
      before: link,
      after: updated,
      origin: ORIGIN
    });
    return updated;
  });
}

// DEC-DOM-007: disponível = recebido na posição − reservado − alocado; "a caminho" é informativo e nunca alocável.
export async function availability(
  actor: Actor,
  lojaId: string,
  posicaoId: string
) {
  const position = await prisma.posicaoOperacional.findUnique({
    where: { id: posicaoId }
  });
  const visible =
    position &&
    (can(actor, "LOGISTICA_POSICOES_VISUALIZAR") ||
      can(actor, "LOGISTICA_POSICOES_TODAS") ||
      (await canOperateAt(prisma, actor, posicaoId)));
  if (!position || !visible) throw new AppError(404, "not_found");
  const items = await prisma.pedidoCompraItem.findMany({
    where: {
      lojaId,
      OR: [
        { recebimentosMiami: { some: { posicaoId } } },
        {
          pedido: {
            destinoPosicaoId: posicaoId,
            status: { notIn: ["CANCELLED", "DRAFT"] }
          }
        },
        // D-15: pacote redirecionado para esta posição traz seus códigos para a conferência.
        {
          pedido: {
            status: { notIn: ["CANCELLED", "DRAFT"] },
            compraImportada: {
              enviosExternos: {
                some: { pacotes: { some: { destinoPosicaoId: posicaoId } } }
              }
            }
          }
        }
      ]
    },
    select: {
      id: true,
      quantidade: true,
      quantidadeRecebidaMiami: true,
      pedido: {
        select: {
          id: true,
          numeroPedido: true,
          destinoPosicaoId: true,
          compraImportada: {
            select: {
              enviosExternos: {
                select: {
                  pacotes: {
                    select: {
                      id: true,
                      destinoPosicaoId: true,
                      itens: {
                        select: { pedidoCompraItemId: true, quantidade: true }
                      },
                      trackings: {
                        where: { ativo: true },
                        select: { codigo: true, transportadora: true }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      produto: { select: { id: true, codigo: true, nome: true, peso: true } },
      recebimentosMiami: {
        select: {
          quantidadeRecebida: true,
          posicaoId: true,
          pacoteExternoId: true
        }
      },
      alocacoesMala: {
        where: { mala: { posicaoId } },
        select: { quantidade: true, status: true }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  return items.map((item) => {
    const recebido = item.recebimentosMiami
      .filter((entry) => entry.posicaoId === posicaoId)
      .reduce((sum, entry) => sum + entry.quantidadeRecebida, 0);
    const reservado = item.alocacoesMala
      .filter((entry) => entry.status === "RESERVADA")
      .reduce((sum, entry) => sum + entry.quantidade, 0);
    const alocado = item.alocacoesMala
      .filter((entry) => entry.status === "CONSUMIDA")
      .reduce((sum, entry) => sum + entry.quantidade, 0);
    // Destino efetivo por pacote e recebimento por pacote: mesma regra do encerramento (expectations.ts).
    const aCaminho = pendingAt(item, posicaoId);
    return {
      pedidoCompraItemId: item.id,
      pedido: { id: item.pedido.id, numeroPedido: item.pedido.numeroPedido },
      // Códigos esperados para conferir a etiqueta; tracking não confirma recebimento.
      // Só pacotes cujo destino efetivo (pacote, senão pedido) é esta posição.
      trackings: (item.pedido.compraImportada?.enviosExternos ?? []).flatMap(
        (envio) =>
          envio.pacotes
            .filter(
              (pkg) =>
                (pkg.destinoPosicaoId ?? item.pedido.destinoPosicaoId) ===
                posicaoId
            )
            .flatMap((pkg) => pkg.trackings)
      ),
      produto: item.produto,
      recebido,
      reservado,
      alocado,
      aCaminho,
      disponivel: Math.max(0, recebido - reservado - alocado)
    };
  });
}

// Quantidade recebida numa posição ainda não comprometida com malas dessa mesma posição.
export async function availableAtPosition(
  tx: Prisma.TransactionClient,
  pedidoCompraItemId: string,
  posicaoId: string
) {
  const [received, committed] = await Promise.all([
    tx.recebimentoMiami.aggregate({
      where: { pedidoCompraItemId, posicaoId },
      _sum: { quantidadeRecebida: true }
    }),
    tx.alocacaoMala.aggregate({
      where: { pedidoCompraItemId, mala: { posicaoId } },
      _sum: { quantidade: true }
    })
  ]);
  return (
    (received._sum.quantidadeRecebida ?? 0) - (committed._sum.quantidade ?? 0)
  );
}

// Usuários que podem receber responsabilidade contextual (vínculo explícito; D-8).
export const assignableUsers = () =>
  prisma.usuario.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" }
  });
