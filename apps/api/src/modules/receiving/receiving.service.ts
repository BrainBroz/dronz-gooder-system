import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
export const list = (lojaId: string) =>
  prisma.recebimento.findMany({
    where: { lojaId },
    include: { viagem: true, mala: true, itens: { include: { produto: true } } }
  });
export async function create(
  lojaId: string,
  userId: string,
  d: { viagemId: string; malaId: string; observacoes?: string }
) {
  const trip = await prisma.viagem.findFirst({
      where: {
        id: d.viagemId,
        lojaId,
        status: "ARRIVED_BRAZIL",
        chegadaRealEm: { not: null }
      }
    }),
    bag = await prisma.mala.findFirst({
      where: {
        id: d.malaId,
        viagemId: d.viagemId,
        lojaId,
        status: { in: ["ARRIVED_BRAZIL", "RECEIVED"] }
      },
      include: { alocacoes: { include: { item: true } } }
    });
  if (!trip || !bag) throw new AppError(409, "not_arrived_brazil");
  return prisma.$transaction(async (tx) => {
    const r = await tx.recebimento.create({
      data: {
        ...d,
        lojaId,
        confirmadoPorId: userId,
        iniciadoEm: new Date(),
        status: "IN_PROGRESS"
      }
    });
    for (const a of bag.alocacoes)
      await tx.recebimentoItem.create({
        data: {
          lojaId,
          recebimentoId: r.id,
          pedidoCompraItemId: a.pedidoCompraItemId,
          produtoId: a.item.produtoId,
          quantidadeEsperada: a.quantidade
        }
      });
    return r;
  });
}
export async function confirm(
  lojaId: string,
  userId: string,
  id: string,
  itemId: string,
  d: {
    quantidadeRecebida: number;
    quantidadeRejeitada: number;
    observacoes?: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.recebimento.findFirst({
      where: {
        id,
        lojaId,
        status: { in: ["IN_PROGRESS", "PARTIALLY_COMPLETED"] }
      }
    });
    const item = await tx.recebimentoItem.findFirst({
      where: { id: itemId, recebimentoId: id, lojaId }
    });
    if (
      !r ||
      !item ||
      d.quantidadeRecebida < 0 ||
      d.quantidadeRejeitada < 0 ||
      item.quantidadeRecebida +
        item.quantidadeRejeitada +
        d.quantidadeRecebida +
        d.quantidadeRejeitada >
        item.quantidadeEsperada
    )
      throw new AppError(409, "conflict");
    if (d.quantidadeRecebida + d.quantidadeRejeitada === 0)
      throw new AppError(400, "bad_request");
    await tx.recebimentoItem.update({
      where: { id: item.id },
      data: {
        quantidadeRecebida: { increment: d.quantidadeRecebida },
        quantidadeRejeitada: { increment: d.quantidadeRejeitada },
        observacoes: d.observacoes
      }
    });
    if (d.quantidadeRecebida > 0) {
      const stock = await tx.estoque.upsert({
        where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } },
        update: { quantidadeFisica: { increment: d.quantidadeRecebida } },
        create: {
          lojaId,
          produtoId: item.produtoId,
          quantidadeFisica: d.quantidadeRecebida
        }
      });
      await tx.movimentacaoEstoque.create({
        data: {
          lojaId,
          produtoId: item.produtoId,
          estoqueId: stock.id,
          recebimentoId: r.id,
          tipo: "ENTRY",
          motivo: "PURCHASE_RECEIPT",
          quantidade: d.quantidadeRecebida,
          quantidadeAnterior: stock.quantidadeFisica - d.quantidadeRecebida,
          quantidadePosterior: stock.quantidadeFisica,
          responsavelId: userId,
          observacoes: d.observacoes
        }
      });
    }
    const items = await tx.recebimentoItem.findMany({
      where: { recebimentoId: id },
      select: {
        quantidadeEsperada: true,
        quantidadeRecebida: true,
        quantidadeRejeitada: true
      }
    });
    const pending = items.some(
      (current) =>
        current.quantidadeRecebida + current.quantidadeRejeitada <
        current.quantidadeEsperada
    );
    return tx.recebimento.update({
      where: { id },
      data: {
        status: pending ? "PARTIALLY_COMPLETED" : "COMPLETED",
        concluidoEm: pending ? null : new Date()
      }
    });
  });
}

export async function entradaDefinitiva(
  lojaId: string,
  userId: string,
  d: {
    viagemId: string;
    malaId: string;
    confirmadoEm: Date;
    observacao?: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const viagem = await tx.viagem.findFirst({
      where: { id: d.viagemId, lojaId, status: "ARRIVED_BRAZIL" }
    });
    if (!viagem) throw new AppError(404, "not_found");

    const mala = await tx.mala.findFirst({
      where: { id: d.malaId, lojaId, viagemId: d.viagemId }
    });
    if (!mala) throw new AppError(404, "not_found");

    const checkpointMiami = await tx.recebimentoMiami.findFirst({
      where: { lojaId }
    });
    if (!checkpointMiami) throw new AppError(409, "missing_checkpoint_miami");

    const checkpointParaguai = await tx.checkpointParaguai.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId }
    });
    if (!checkpointParaguai) throw new AppError(409, "missing_checkpoint_paraguai");

    const checkpointBrasil = await tx.checkpointBrasil.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId }
    });
    if (!checkpointBrasil) throw new AppError(409, "missing_checkpoint_brasil");

    const entradaExistente = await tx.estoqueEntrada.findFirst({
      where: { lojaId, viagemId: d.viagemId, malaId: d.malaId }
    });

    if (entradaExistente) {
      if (entradaExistente.status === "COMPLETED") {
        return entradaExistente;
      }
      throw new AppError(409, "entrada_already_processing");
    }

    const itens = await tx.recebimentoItem.findMany({
      where: {
        recebimento: {
          lojaId,
          malaId: d.malaId
        }
      }
    });

    if (itens.length === 0) throw new AppError(409, "no_items");

    const temApta = itens.some(
      (i) => i.quantidadeRecebida - i.quantidadeRejeitada - i.quantidadeJaIncorporada > 0
    );
    if (!temApta) throw new AppError(409, "no_apt_quantity");

    const entrada = await tx.estoqueEntrada.create({
      data: {
        lojaId,
        viagemId: d.viagemId,
        malaId: d.malaId,
        confirmadoPorId: userId,
        confirmadoEm: d.confirmadoEm,
        observacao: d.observacao,
        status: "PENDING"
      }
    });

    for (const item of itens) {
      const quantidadeApta = item.quantidadeRecebida - item.quantidadeRejeitada - item.quantidadeJaIncorporada;

      if (quantidadeApta > 0) {
        const stock = await tx.estoque.upsert({
          where: { lojaId_produtoId: { lojaId, produtoId: item.produtoId } },
          update: { quantidadeFisica: { increment: quantidadeApta } },
          create: {
            lojaId,
            produtoId: item.produtoId,
            quantidadeFisica: quantidadeApta
          }
        });

        await tx.movimentacaoEstoque.create({
          data: {
            lojaId,
            produtoId: item.produtoId,
            estoqueId: stock.id,
            recebimentoId: item.recebimentoId,
            tipo: "ENTRY",
            motivo: "PURCHASE_RECEIPT",
            quantidade: quantidadeApta,
            quantidadeAnterior: stock.quantidadeFisica - quantidadeApta,
            quantidadePosterior: stock.quantidadeFisica,
            responsavelId: userId,
            observacoes: `Entrada parcial de ${quantidadeApta} unidades (recebidas: ${item.quantidadeRecebida}, rejeitadas: ${item.quantidadeRejeitada})`
          }
        });

        await tx.recebimentoItem.update({
          where: { id: item.id },
          data: { quantidadeJaIncorporada: { increment: quantidadeApta } }
        });
      }
    }

    const entradaAtualizada = await tx.estoqueEntrada.update({
      where: { id: entrada.id },
      data: { status: "COMPLETED" }
    });

    return entradaAtualizada;
  });
}
