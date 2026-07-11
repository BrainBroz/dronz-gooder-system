import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { flags } from "../../lib/feature-flags";
import { shadowWriteMovimentacao } from "../migration/shadow.service";
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
      // Shadow write (§16 Fase 2): ledger na MESMA transação — rollback conjunto.
      if (flags.ledgerShadowWrite) {
        await shadowWriteMovimentacao(tx, {
          lojaId,
          produtoId: item.produtoId,
          estoqueId: stock.id,
          tipo: "ENTRY",
          motivo: "PURCHASE_RECEIPT",
          quantidade: d.quantidadeRecebida,
          responsavelId: userId
        });
      }
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
