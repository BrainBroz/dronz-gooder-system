import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { audit } from "../operations/operations.persistence";
import { claimOpenPosition } from "../positions/positions.service";

// Batch 14: tracking por pedido operacional. Tracking é evidência de envio, nunca confirma
// recebimento, checkpoint ou estoque. Fallback manual auditável quando o marketplace não informa.
const MANUAL_SHIPMENT = "MANUAL";
const normalizeCode = (value: string) =>
  value.replace(/\s+/g, "").normalize("NFC");

async function orderWithPurchase(
  db: Prisma.TransactionClient | typeof prisma,
  lojaId: string,
  id: string
) {
  const order = await db.pedidoCompra.findFirst({
    where: { id, lojaId },
    select: {
      id: true,
      compraImportadaId: true,
      destinoPosicao: { select: { id: true, nome: true } }
    }
  });
  if (!order) throw new AppError(404, "not_found");
  if (!order.compraImportadaId)
    throw new AppError(409, "order_without_purchase");
  return order as typeof order & { compraImportadaId: string };
}

export async function listTrackings(lojaId: string, pedidoCompraId: string) {
  const order = await orderWithPurchase(prisma, lojaId, pedidoCompraId);
  const trackings = await prisma.trackingExterno.findMany({
    where: {
      pacote: { envio: { compraImportadaId: order.compraImportadaId } }
    },
    include: {
      pacote: {
        select: {
          id: true,
          externalPackageId: true,
          destinoPosicao: { select: { id: true, nome: true } },
          itens: {
            where: { lojaId },
            select: { pedidoCompraItemId: true, quantidade: true }
          },
          envio: { select: { externalShipmentId: true, enviadoEm: true } }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  return trackings.map((tracking) => ({
    id: tracking.id,
    codigo: tracking.codigo,
    transportadora: tracking.transportadora,
    origem: tracking.origem,
    ativo: tracking.ativo,
    statusExterno: tracking.statusExterno,
    substituiTrackingId: tracking.substituiTrackingId,
    pacote: tracking.pacote.externalPackageId,
    pacoteId: tracking.pacote.id,
    pacoteItens: tracking.pacote.itens,
    // Destino efetivo: o do pacote quando definido, senão o padrão do pedido (D-15).
    destino: tracking.pacote.destinoPosicao
      ? { ...tracking.pacote.destinoPosicao, origem: "PACOTE" as const }
      : order.destinoPosicao
        ? { ...order.destinoPosicao, origem: "PEDIDO" as const }
        : null,
    enviadoEm: tracking.pacote.envio.enviadoEm,
    registradoEm: tracking.createdAt
  }));
}

export async function addManualTracking(
  lojaId: string,
  userId: string,
  pedidoCompraId: string,
  input: {
    codigo: string;
    transportadora?: string;
    substituiTrackingId?: string;
  }
) {
  const codigo = normalizeCode(input.codigo);
  if (!codigo) throw new AppError(400, "bad_request");
  return prisma.$transaction(async (tx) => {
    const order = await orderWithPurchase(tx, lojaId, pedidoCompraId);
    await tx.$queryRaw`SELECT id FROM "CompraImportada" WHERE id = ${order.compraImportadaId} FOR UPDATE`;
    const replaced = input.substituiTrackingId
      ? await tx.trackingExterno.findFirst({
          where: {
            id: input.substituiTrackingId,
            pacote: { envio: { compraImportadaId: order.compraImportadaId } }
          }
        })
      : null;
    if (input.substituiTrackingId && !replaced)
      throw new AppError(404, "tracking_not_found");
    const now = new Date();
    const shipment = await tx.envioExterno.upsert({
      where: {
        compraImportadaId_externalShipmentId: {
          compraImportadaId: order.compraImportadaId,
          externalShipmentId: MANUAL_SHIPMENT
        }
      },
      update: { ultimaAtualizacaoEm: now },
      create: {
        compraImportadaId: order.compraImportadaId,
        externalShipmentId: MANUAL_SHIPMENT,
        ultimaAtualizacaoEm: now
      }
    });
    const packageId = `${MANUAL_SHIPMENT}:${input.transportadora ?? "SEM_TRANSPORTADORA"}:${codigo}`;
    const pkg = await tx.pacoteExterno.upsert({
      where: {
        envioExternoId_externalPackageId: {
          envioExternoId: shipment.id,
          externalPackageId: packageId
        }
      },
      update: {},
      create: {
        envioExternoId: shipment.id,
        externalPackageId: packageId,
        transportadora: input.transportadora
      }
    });
    const duplicate = await tx.trackingExterno.findFirst({
      where: {
        pacoteExternoId: pkg.id,
        codigo,
        transportadora: input.transportadora ?? null
      }
    });
    if (duplicate) throw new AppError(409, "tracking_already_registered");
    // Correção cria registro novo ligado ao anterior; o código antigo fica inativo, nunca apagado.
    if (replaced)
      await tx.trackingExterno.update({
        where: { id: replaced.id },
        data: { ativo: false }
      });
    const created = await tx.trackingExterno.create({
      data: {
        pacoteExternoId: pkg.id,
        codigo,
        transportadora: input.transportadora,
        origem: "MANUAL",
        ativo: true,
        substituiTrackingId: replaced?.id,
        ultimaAtualizacaoEm: now
      }
    });
    await audit(tx, {
      usuarioId: userId,
      lojaId,
      permissionCode: "PEDIDOS_COMPRA_GERENCIAR",
      action: replaced ? "REPLACE_TRACKING" : "ADD_MANUAL_TRACKING",
      entity: "TrackingExterno",
      entityId: created.id,
      correlationId: randomUUID(),
      origin: "API_PURCHASE_ORDERS",
      before: replaced
        ? { id: replaced.id, codigo: replaced.codigo }
        : undefined,
      after: {
        codigo,
        transportadora: input.transportadora ?? null,
        pedidoCompraId
      }
    });
    return created;
  });
}

// Leitura de etiqueta: código completo ou últimos dígitos (≥ 6), só entre pedidos da loja ativa.
// Código de outra loja ou desconhecido devolve vazio, sem revelar existência.
export async function lookupTracking(lojaId: string, rawCode: string) {
  const codigo = normalizeCode(rawCode);
  if (codigo.length < 6) throw new AppError(400, "tracking_code_too_short");
  const trackings = await prisma.trackingExterno.findMany({
    where: {
      OR: [
        { codigo: { equals: codigo, mode: "insensitive" } },
        { codigo: { endsWith: codigo, mode: "insensitive" } }
      ],
      pacote: {
        envio: {
          compraImportada: { pedidosOperacionais: { some: { lojaId } } }
        }
      }
    },
    include: {
      pacote: {
        include: {
          envio: {
            include: {
              compraImportada: {
                include: {
                  pedidosOperacionais: {
                    where: { lojaId },
                    select: {
                      id: true,
                      numeroPedido: true,
                      status: true,
                      destinoPosicao: { select: { id: true, nome: true } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    take: 20
  });
  return trackings.map((tracking) => ({
    trackingId: tracking.id,
    codigo: tracking.codigo,
    transportadora: tracking.transportadora,
    ativo: tracking.ativo,
    origem: tracking.origem,
    exato: tracking.codigo.toLowerCase() === codigo.toLowerCase(),
    pedidos: tracking.pacote.envio.compraImportada.pedidosOperacionais
  }));
}

// D-15: destino por pacote. Alteração auditada só antes de qualquer recebimento da compra; depois,
// o caminho é transferência operacional. O pacote é físico e pode servir pedidos das duas lojas.
// Trava os pedidos (ordem fixa) e devolve o destino atual de cada um. Ordem de travas nos comandos de
// pacote: pacote → pedidos → itens → posições; setDestination: pedido → itens → posição.
async function lockedOrderDestinations(
  tx: Prisma.TransactionClient,
  orderIds: string[]
) {
  const destinations = new Map<string, string>();
  for (const id of [...new Set(orderIds)].sort()) {
    const [row] = await tx.$queryRaw<
      { destinoPosicaoId: string }[]
    >`SELECT "destinoPosicaoId" FROM "PedidoCompra" WHERE id = ${id} FOR UPDATE`;
    if (row) destinations.set(id, row.destinoPosicaoId);
  }
  return destinations;
}

export async function setPackageDestination(
  lojaId: string,
  userId: string,
  pedidoCompraId: string,
  pacoteId: string,
  input: { posicaoId: string | null; motivo: string }
) {
  return prisma.$transaction(async (tx) => {
    const order = await orderWithPurchase(tx, lojaId, pedidoCompraId);
    await tx.$queryRaw`SELECT id FROM "PacoteExterno" WHERE id = ${pacoteId} FOR UPDATE`;
    const pkg = await tx.pacoteExterno.findFirst({
      where: {
        id: pacoteId,
        envio: { compraImportadaId: order.compraImportadaId }
      }
    });
    if (!pkg) throw new AppError(404, "package_not_found");
    // O pacote é físico e pode ter linhas das duas lojas. Trocar o destino muda o que cada item pode
    // receber e onde: toca as linhas dos itens (ordem fixa) para serializar com recebimentos.
    const lines = await tx.pacoteItem.findMany({
      where: { pacoteExternoId: pacoteId },
      select: {
        pedidoCompraItemId: true,
        item: { select: { pedidoCompraId: true } }
      }
    });
    // Destinos dos pedidos lidos só depois de travar os pedidos (mesma trava de setDestination).
    const destinations = await lockedOrderDestinations(tx, [
      pedidoCompraId,
      ...lines.map((line) => line.item.pedidoCompraId)
    ]);
    for (const itemId of [
      ...new Set(lines.map((line) => line.pedidoCompraItemId))
    ].sort())
      await tx.$executeRaw`UPDATE "PedidoCompraItem" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${itemId}`;
    // Quem passa a esperar o pacote: a posição informada ou, ao voltar ao padrão, o destino do pedido
    // de cada item presente no pacote (de qualquer loja).
    const claims = input.posicaoId
      ? [input.posicaoId]
      : [
          ...new Set([
            destinations.get(pedidoCompraId)!,
            ...lines.map((line) => destinations.get(line.item.pedidoCompraId)!)
          ])
        ].sort();
    for (const posicaoId of claims) await claimOpenPosition(tx, posicaoId);
    if (
      await tx.recebimentoMiami.count({
        where: {
          item: { pedido: { compraImportadaId: order.compraImportadaId } }
        }
      })
    )
      throw new AppError(409, "already_received");
    const updated = await tx.pacoteExterno.update({
      where: { id: pacoteId },
      data: { destinoPosicaoId: input.posicaoId }
    });
    await audit(tx, {
      usuarioId: userId,
      lojaId,
      permissionCode: "PEDIDOS_COMPRA_GERENCIAR",
      action: "SET_PACKAGE_DESTINATION",
      entity: "PacoteExterno",
      entityId: pacoteId,
      correlationId: randomUUID(),
      origin: "API_PURCHASE_ORDERS",
      reason: input.motivo,
      before: { destinoPosicaoId: pkg.destinoPosicaoId },
      after: { destinoPosicaoId: input.posicaoId, pedidoCompraId }
    });
    return updated;
  });
}

// PD-04: conteúdo do pacote (substitui o conjunto da loja). Só antes do primeiro recebimento da compra;
// a soma de um item em todos os pacotes não passa da quantidade comprada.
export async function setPackageItems(
  lojaId: string,
  userId: string,
  pedidoCompraId: string,
  pacoteId: string,
  input: {
    itens: { pedidoCompraItemId: string; quantidade: number }[];
    motivo: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const order = await orderWithPurchase(tx, lojaId, pedidoCompraId);
    await tx.$queryRaw`SELECT id FROM "PacoteExterno" WHERE id = ${pacoteId} FOR UPDATE`;
    const pkg = await tx.pacoteExterno.findFirst({
      where: {
        id: pacoteId,
        envio: { compraImportadaId: order.compraImportadaId }
      },
      include: { itens: { where: { lojaId } } }
    });
    if (!pkg) throw new AppError(404, "package_not_found");
    // O destino do pedido é relido sob a trava do pedido: um redirecionamento concorrente não fica de fora.
    const orderDestination = (
      await lockedOrderDestinations(tx, [pedidoCompraId])
    ).get(pedidoCompraId)!;
    const ids = input.itens.map((entry) => entry.pedidoCompraItemId);
    if (new Set(ids).size !== ids.length)
      throw new AppError(400, "bad_request");
    // A quantidade comprada do item é o recurso compartilhado entre pacotes: trava as linhas dos itens
    // (novos e os que saem deste pacote) em ordem fixa antes de somar, e só então confere recebimentos.
    const lockIds = [
      ...new Set([...ids, ...pkg.itens.map((line) => line.pedidoCompraItemId)])
    ].sort();
    // UPDATE (e não só FOR UPDATE): um recebimento Serializable que esperava esta linha falha por
    // serialização ao retomar, em vez de validar contra o conteúdo antigo.
    for (const itemId of lockIds)
      await tx.$executeRaw`UPDATE "PedidoCompraItem" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${itemId} AND "lojaId" = ${lojaId}`;
    if (
      await tx.recebimentoMiami.count({
        where: {
          item: { pedido: { compraImportadaId: order.compraImportadaId } }
        }
      })
    )
      throw new AppError(409, "already_received");
    // Conteúdo declarado vira pendência no destino efetivo do pacote; o que sai do pacote (redução ou
    // remoção) volta a ser esperado no destino do pedido. Toda posição que ganha saldo é reivindicada.
    const before = new Map(
      pkg.itens.map((line) => [line.pedidoCompraItemId, line.quantidade])
    );
    const grows = input.itens.some(
      (entry) => entry.quantidade > (before.get(entry.pedidoCompraItemId) ?? 0)
    );
    const shrinks = [...before].some(
      ([itemId, quantidade]) =>
        quantidade >
        (input.itens.find((entry) => entry.pedidoCompraItemId === itemId)
          ?.quantidade ?? 0)
    );
    const claims = new Set<string>();
    if (grows) claims.add(pkg.destinoPosicaoId ?? orderDestination);
    if (shrinks) claims.add(orderDestination);
    for (const posicaoId of [...claims].sort())
      await claimOpenPosition(tx, posicaoId);
    const items = await tx.pedidoCompraItem.findMany({
      where: { id: { in: ids }, lojaId, pedidoCompraId },
      include: { pacotes: { where: { pacoteExternoId: { not: pacoteId } } } }
    });
    if (items.length !== ids.length)
      throw new AppError(404, "purchase_item_not_found");
    for (const entry of input.itens) {
      const item = items.find((i) => i.id === entry.pedidoCompraItemId)!;
      const elsewhere = item.pacotes.reduce((sum, p) => sum + p.quantidade, 0);
      if (elsewhere + entry.quantidade > item.quantidade)
        throw new AppError(409, "package_exceeds_item");
    }
    await tx.pacoteItem.deleteMany({
      where: { pacoteExternoId: pacoteId, lojaId }
    });
    if (input.itens.length)
      await tx.pacoteItem.createMany({
        data: input.itens.map((entry) => ({
          lojaId,
          pacoteExternoId: pacoteId,
          ...entry
        }))
      });
    await audit(tx, {
      usuarioId: userId,
      lojaId,
      permissionCode: "PEDIDOS_COMPRA_GERENCIAR",
      action: "SET_PACKAGE_ITEMS",
      entity: "PacoteExterno",
      entityId: pacoteId,
      correlationId: randomUUID(),
      origin: "API_PURCHASE_ORDERS",
      reason: input.motivo,
      before: {
        itens: pkg.itens.map((i) => ({
          pedidoCompraItemId: i.pedidoCompraItemId,
          quantidade: i.quantidade
        }))
      },
      after: { itens: input.itens }
    });
    return { pacoteId, itens: input.itens };
  });
}
