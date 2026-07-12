import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export async function createOperationalFixture(prisma: PrismaClient, lojaId: string) {
  const suffix = randomUUID();
  const admin = await prisma.usuario.findUniqueOrThrow({
    where: { email: "admin@example.com" }
  });
  const category = await prisma.categoria.create({
    data: { lojaId, nome: `Categoria ${suffix}`, slug: `category-${suffix}` }
  });
  const product = await prisma.produto.create({
    data: {
      lojaId,
      categoriaId: category.id,
      codigo: 1_000_000 + Number.parseInt(suffix.slice(0, 7), 16),
      nome: `Produto ${suffix}`,
      slug: `product-${suffix}`,
      precoVenda: 100,
      markup: 25,
      peso: 1
    }
  });
  const supplier = await prisma.fornecedor.create({
    data: { lojaId, nome: `Fornecedor ${suffix}` }
  });
  const order = await prisma.pedidoCompra.create({
    data: {
      lojaId,
      fornecedorId: supplier.id,
      numeroPedido: `TEST-${suffix}`,
      dataCompra: new Date(),
      subtotal: 100,
      total: 100,
      itens: {
        create: {
          produtoId: product.id,
          quantidade: 2,
          precoUnitario: 50,
          totalItem: 100
        }
      }
    },
    include: { itens: true }
  });
  const traveler = await prisma.viajante.create({
    data: { lojaId, nome: `Viajante ${suffix}` }
  });
  const trip = await prisma.viagem.create({
    data: {
      lojaId,
      viajanteId: traveler.id,
      origem: "Miami",
      destino: "Brasil",
      partidaEm: new Date(Date.now() + 86_400_000),
      chegadaPrevistaEm: new Date(Date.now() + 172_800_000),
      status: "OPEN_FOR_ALLOCATION"
    }
  });
  const bag = await prisma.mala.create({
    data: { lojaId, viagemId: trip.id, codigo: `BAG-${suffix}` }
  });
  const volume = await prisma.volumeLogistico.create({
    data: { lojaId, malaId: bag.id, codigo: `BOX-${suffix}`, taraKg: 0.5 }
  });
  const allocation = await prisma.alocacaoMala.create({
    data: {
      lojaId,
      pedidoCompraItemId: order.itens[0].id,
      malaId: bag.id,
      volumeLogisticoId: volume.id,
      quantidade: 2,
      pesoConteudoKg: 1
    }
  });

  return {
    admin,
    category,
    product,
    supplier,
    order,
    item: order.itens[0],
    traveler,
    trip,
    bag,
    volume,
    allocation,
    async cleanup() {
      await prisma.movimentacaoEstoque.deleteMany({ where: { produtoId: product.id } });
      await prisma.recebimentoItem.deleteMany({ where: { produtoId: product.id } });
      await prisma.recebimento.deleteMany({ where: { malaId: bag.id } });
      await prisma.estoqueEntrada.deleteMany({ where: { malaId: bag.id } });
      await prisma.checkpointBrasil.deleteMany({ where: { malaId: bag.id } });
      await prisma.checkpointParaguai.deleteMany({ where: { malaId: bag.id } });
      await prisma.recebimentoMiami.deleteMany({ where: { pedidoCompraItemId: order.itens[0].id } });
      await prisma.alocacaoMala.deleteMany({ where: { id: allocation.id } });
      await prisma.volumeLogistico.deleteMany({ where: { id: volume.id } });
      await prisma.mala.deleteMany({ where: { id: bag.id } });
      await prisma.viagem.deleteMany({ where: { id: trip.id } });
      await prisma.viajante.deleteMany({ where: { id: traveler.id } });
      await prisma.pedidoCompra.deleteMany({ where: { id: order.id } });
      await prisma.estoque.deleteMany({ where: { produtoId: product.id } });
      await prisma.produto.deleteMany({ where: { id: product.id } });
      await prisma.categoria.deleteMany({ where: { id: category.id } });
      await prisma.fornecedor.deleteMany({ where: { id: supplier.id } });
    }
  };
}
