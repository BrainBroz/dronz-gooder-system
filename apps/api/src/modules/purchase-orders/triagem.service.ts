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

    const totalPedido = pedido.itens.reduce((sum: number, i) => sum + i.quantidade, 0);

    const atribuicoes = await client.atribuicaoItem.findMany({
      where: {
        pedidoCompraItem: { pedidoCompraId }
      },
      select: { quantidade: true }
    });

    const totalAtribuido = atribuicoes.reduce((sum: number, a) => sum + a.quantidade, 0);

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

    const totalAtribuido = item.atribuicoes.reduce((sum: number, a) => sum + a.quantidade, 0);
    if (totalAtribuido + quantidade > item.quantidade) {
      throw new AppError(400, "quantidade_insuficiente");
    }

    const pedido = await client.pedidoCompra.findUnique({
      where: { id: pedidoCompraId },
      select: { compraImportadaId: true }
    });

    const atribuicao = await client.atribuicaoItem.upsert({
      where: { pedidoCompraItemId_lojaId: { pedidoCompraItemId, lojaId } },
      update: { quantidade, atribuidoPorId: userId, atribuidoEm: new Date(), observacao },
      create: {
        pedidoCompraItemId,
        lojaId,
        quantidade,
        atribuidoPorId: userId,
        observacao,
        compraImportadaId: pedido?.compraImportadaId ?? undefined
      },
      include: { loja: true, atribuidoPor: true }
    });

    const novoStatus = await this.calcularStatusAtribuicao(pedidoCompraId, client);
    await client.pedidoCompra.update({
      where: { id: pedidoCompraId },
      data: { statusAtribuicao: novoStatus }
    });

    return atribuicao;
  }

  async listarAtribuicoes(pedidoCompraId: string, lojaId: string) {
    const pedido = await this.prisma.pedidoCompra.findUnique({
      where: { id: pedidoCompraId },
      select: { compraImportadaId: true }
    });

    if (!pedido) {
      return [];
    }

    if (pedido.compraImportadaId) {
      const atribuicoes = await this.prisma.atribuicaoItem.findMany({
        where: {
          compraImportadaId: pedido.compraImportadaId,
          lojaId
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
