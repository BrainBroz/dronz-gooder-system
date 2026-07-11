import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/app-error";

export class TriagemService {
  constructor(private prisma: PrismaClient) {}

  async atribuirItem(
    pedidoCompraId: string,
    pedidoCompraItemId: string,
    lojaId: string,
    quantidade: number,
    userId: string,
    observacao?: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma;

    const item = await client.pedidoCompraItem.findUnique({
      where: { id: pedidoCompraItemId },
      include: { atribuicoes: true }
    });

    if (!item) {
      throw new AppError(404, "item_not_found");
    }

    if (item.pedidoCompraId !== pedidoCompraId) {
      throw new AppError(404, "item_not_found");
    }

    const totalAtribuido = item.atribuicoes.reduce((sum, a) => sum + a.quantidade, 0);
    if (totalAtribuido + quantidade > item.quantidade) {
      throw new AppError(400, "quantidade_insuficiente");
    }

    const atribuicao = await client.atribuicaoItem.upsert({
      where: { pedidoCompraItemId_lojaId: { pedidoCompraItemId, lojaId } },
      update: { quantidade, atribuidoPorId: userId, atribuidoEm: new Date(), observacao },
      create: {
        pedidoCompraItemId,
        lojaId,
        quantidade,
        atribuidoPorId: userId,
        observacao
      },
      include: { loja: true, atribuidoPor: true }
    });

    return atribuicao;
  }

  async listarAtribuicoes(pedidoCompraId: string, lojaId: string) {
    const atribuicoes = await this.prisma.atribuicaoItem.findMany({
      where: {
        pedidoCompraItem: {
          pedidoCompraId,
          lojaId
        }
      },
      include: {
        loja: true,
        atribuidoPor: true,
        pedidoCompraItem: true
      },
      orderBy: { atribuidoEm: "desc" }
    });

    return atribuicoes;
  }

  async validarMiamiAtribuicao(pedidoCompraItemId: string, lojaId: string) {
    const atribuicoes = await this.prisma.atribuicaoItem.findMany({
      where: {
        pedidoCompraItemId,
        lojaId
      }
    });

    return atribuicoes.length > 0;
  }
}
