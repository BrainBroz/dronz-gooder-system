import { Prisma, PrismaClient, StatusAtribuicao } from "@prisma/client";
import { AppError } from "../../lib/app-error";

export class TriagemService {
  constructor(private prisma: PrismaClient) {}

  private async calcularStatusAtribuicao(
    pedidoCompraId: string,
    client: Prisma.TransactionClient | PrismaClient
  ): Promise<StatusAtribuicao> {
    const pedido = await client.pedidoCompra.findUnique({
      where: { id: pedidoCompraId },
      include: {
        itens: true
      }
    });

    if (!pedido) return StatusAtribuicao.PENDENTE_ATRIBUICAO;

    const totalPedido = pedido.itens.reduce(
      (sum: number, i) => sum + i.quantidade,
      0
    );

    const atribuicoes = await client.atribuicaoItem.findMany({
      where: {
        pedidoCompraItem: { pedidoCompraId }
      },
      select: { quantidade: true }
    });

    const totalAtribuido = atribuicoes.reduce(
      (sum: number, a) => sum + a.quantidade,
      0
    );

    if (totalAtribuido === 0) return StatusAtribuicao.PENDENTE_ATRIBUICAO;
    if (totalAtribuido >= totalPedido) return StatusAtribuicao.ATRIBUIDA;
    return StatusAtribuicao.PARCIALMENTE_ATRIBUIDA;
  }

  async atribuirItem(
    pedidoCompraId: string,
    pedidoCompraItemId: string,
    lojaId: string,
    quantidade: number,
    userId: string,
    observacao?: string,
    tx?: Prisma.TransactionClient
  ): Promise<
    Prisma.AtribuicaoItemGetPayload<{
      include: { loja: true; atribuidoPor: true };
    }>
  > {
    if (!tx) {
      return this.prisma.$transaction((client) =>
        this.atribuirItem(
          pedidoCompraId,
          pedidoCompraItemId,
          lojaId,
          quantidade,
          userId,
          observacao,
          client
        )
      );
    }
    const client = tx;

    const item = await client.pedidoCompraItem.findFirst({
      where: { id: pedidoCompraItemId, pedidoCompraId, lojaId },
      include: { atribuicoes: true }
    });

    if (!item) {
      throw new AppError(404, "item_not_found");
    }

    const totalOutrasAtribuicoes = item.atribuicoes
      .filter((atribuicao) => atribuicao.lojaId !== lojaId)
      .reduce((sum: number, atribuicao) => sum + atribuicao.quantidade, 0);
    if (totalOutrasAtribuicoes + quantidade > item.quantidade) {
      throw new AppError(400, "quantidade_insuficiente");
    }

    const pedidoExiste = await client.pedidoCompra.count({
      where: { id: pedidoCompraId, lojaId }
    });
    if (!pedidoExiste) throw new AppError(404, "item_not_found");

    const atribuicao = await client.atribuicaoItem.upsert({
      where: { pedidoCompraItemId_lojaId: { pedidoCompraItemId, lojaId } },
      update: {
        quantidade,
        atribuidoPorId: userId,
        atribuidoEm: new Date(),
        observacao
      },
      create: {
        pedidoCompraItemId,
        lojaId,
        quantidade,
        atribuidoPorId: userId,
        observacao
      },
      include: { loja: true, atribuidoPor: true }
    });

    const novoStatus = await this.calcularStatusAtribuicao(
      pedidoCompraId,
      client
    );
    await client.pedidoCompra.update({
      where: { id: pedidoCompraId },
      data: { statusAtribuicao: novoStatus }
    });

    return atribuicao;
  }

  async listarAtribuicoes(pedidoCompraId: string, lojaId: string) {
    const pedidoExiste = await this.prisma.pedidoCompra.count({
      where: { id: pedidoCompraId, lojaId }
    });

    if (!pedidoExiste) {
      throw new AppError(404, "not_found");
    }

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
