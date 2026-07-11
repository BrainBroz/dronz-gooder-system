import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD is required");

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const [dronz, gooder, profile, permission] = await Promise.all([
    prisma.loja.upsert({
      where: { slug: "dronz" },
      update: { nome: "Dronz", ativa: true },
      create: { slug: "dronz", nome: "Dronz", ativa: true }
    }),
    prisma.loja.upsert({
      where: { slug: "gooder" },
      update: { nome: "Gooder", ativa: true },
      create: { slug: "gooder", nome: "Gooder", ativa: true }
    }),
    prisma.perfil.upsert({
      where: { code: "SUPER_ADMIN" },
      update: { name: "SUPER_ADMIN" },
      create: { code: "SUPER_ADMIN", name: "SUPER_ADMIN" }
    }),
    prisma.permissao.upsert({
      where: { code: "SYSTEM_ADMIN" },
      update: { name: "SYSTEM_ADMIN" },
      create: { code: "SYSTEM_ADMIN", name: "SYSTEM_ADMIN" }
    })
  ]);

  const user = await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: { name: adminName, passwordHash, active: true },
    create: { name: adminName, email: adminEmail, passwordHash, active: true }
  });

  await prisma.usuarioLoja.upsert({
    where: { usuarioId_lojaId: { usuarioId: user.id, lojaId: dronz.id } },
    update: {},
    create: { usuarioId: user.id, lojaId: dronz.id }
  });
  await prisma.usuarioLoja.upsert({
    where: { usuarioId_lojaId: { usuarioId: user.id, lojaId: gooder.id } },
    update: {},
    create: { usuarioId: user.id, lojaId: gooder.id }
  });

  await prisma.usuarioPerfil.upsert({
    where: { usuarioId_perfilId: { usuarioId: user.id, perfilId: profile.id } },
    update: {},
    create: { usuarioId: user.id, perfilId: profile.id }
  });

  await prisma.perfilPermissao.upsert({
    where: {
      perfilId_permissaoId: { perfilId: profile.id, permissaoId: permission.id }
    },
    update: {},
    create: { perfilId: profile.id, permissaoId: permission.id }
  });

  const categories = await Promise.all([
    prisma.categoria.upsert({
      where: { lojaId_slug: { lojaId: dronz.id, slug: "dronz-geral" } },
      update: {
        nome: "Dronz Geral",
        descricao: "Categoria de demonstração",
        ordem: 1,
        ativo: true
      },
      create: {
        lojaId: dronz.id,
        nome: "Dronz Geral",
        slug: "dronz-geral",
        descricao: "Categoria de demonstração",
        ordem: 1,
        ativo: true
      }
    }),
    prisma.categoria.upsert({
      where: { lojaId_slug: { lojaId: gooder.id, slug: "gooder-geral" } },
      update: {
        nome: "Gooder Geral",
        descricao: "Categoria de demonstração",
        ordem: 1,
        ativo: true
      },
      create: {
        lojaId: gooder.id,
        nome: "Gooder Geral",
        slug: "gooder-geral",
        descricao: "Categoria de demonstração",
        ordem: 1,
        ativo: true
      }
    })
  ]);

  const products = await Promise.all([
    prisma.produto.upsert({
      where: { codigo: 101 },
      update: {
        lojaId: dronz.id,
        categoriaId: categories[0].id,
        nome: "Produto Dronz 101",
        slug: "produto-dronz-101",
        descricao: "Produto de demonstração",
        precoVenda: "0.00",
        markup: "25.00",
        peso: "1.000",
        ativo: true
      },
      create: {
        codigo: 101,
        lojaId: dronz.id,
        categoriaId: categories[0].id,
        nome: "Produto Dronz 101",
        slug: "produto-dronz-101",
        descricao: "Produto de demonstração",
        precoVenda: "0.00",
        markup: "25.00",
        peso: "1.000",
        ativo: true
      }
    }),
    prisma.produto.upsert({
      where: { codigo: 201 },
      update: {
        lojaId: gooder.id,
        categoriaId: categories[1].id,
        nome: "Produto Gooder 201",
        slug: "produto-gooder-201",
        descricao: "Produto de demonstração",
        precoVenda: "49.90",
        markup: "25.00",
        peso: "1.000",
        ativo: true
      },
      create: {
        codigo: 201,
        lojaId: gooder.id,
        categoriaId: categories[1].id,
        nome: "Produto Gooder 201",
        slug: "produto-gooder-201",
        descricao: "Produto de demonstração",
        precoVenda: "49.90",
        markup: "25.00",
        peso: "1.000",
        ativo: true
      }
    })
  ]);

  const suppliers = await Promise.all([
    prisma.fornecedor.upsert({
      where: { id: "seed-supplier-dronz" },
      update: {
        lojaId: dronz.id,
        nome: "Fornecedor Dronz",
        moedaPadrao: "USD",
        ativo: true
      },
      create: {
        id: "seed-supplier-dronz",
        lojaId: dronz.id,
        nome: "Fornecedor Dronz",
        moedaPadrao: "USD"
      }
    }),
    prisma.fornecedor.upsert({
      where: { id: "seed-supplier-gooder" },
      update: {
        lojaId: gooder.id,
        nome: "Fornecedor Gooder",
        moedaPadrao: "USD",
        ativo: true
      },
      create: {
        id: "seed-supplier-gooder",
        lojaId: gooder.id,
        nome: "Fornecedor Gooder",
        moedaPadrao: "USD"
      }
    })
  ]);
  const orders = await Promise.all([
    prisma.pedidoCompra.upsert({
      where: {
        lojaId_fornecedorId_numeroPedido: {
          lojaId: dronz.id,
          fornecedorId: suppliers[0].id,
          numeroPedido: "SEED-DRONZ-001"
        }
      },
      update: {},
      create: {
        lojaId: dronz.id,
        fornecedorId: suppliers[0].id,
        numeroPedido: "SEED-DRONZ-001",
        dataCompra: new Date("2026-01-01T12:00:00Z"),
        moeda: "USD"
      }
    }),
    prisma.pedidoCompra.upsert({
      where: {
        lojaId_fornecedorId_numeroPedido: {
          lojaId: gooder.id,
          fornecedorId: suppliers[1].id,
          numeroPedido: "SEED-GOODER-001"
        }
      },
      update: {},
      create: {
        lojaId: gooder.id,
        fornecedorId: suppliers[1].id,
        numeroPedido: "SEED-GOODER-001",
        dataCompra: new Date("2026-01-01T12:00:00Z"),
        moeda: "USD"
      }
    })
  ]);
  await Promise.all([
    prisma.pedidoCompraItem.upsert({
      where: {
        pedidoCompraId_produtoId: {
          pedidoCompraId: orders[0].id,
          produtoId: products[0].id
        }
      },
      update: {},
      create: {
        pedidoCompraId: orders[0].id,
        lojaId: dronz.id,
        produtoId: products[0].id,
        quantidade: 1,
        precoUnitario: "10.00",
        totalItem: "10.00"
      }
    }),
    prisma.pedidoCompraItem.upsert({
      where: {
        pedidoCompraId_produtoId: {
          pedidoCompraId: orders[1].id,
          produtoId: products[1].id
        }
      },
      update: {},
      create: {
        pedidoCompraId: orders[1].id,
        lojaId: gooder.id,
        produtoId: products[1].id,
        quantidade: 1,
        precoUnitario: "20.00",
        totalItem: "20.00"
      }
    })
  ]);
  await Promise.all(
    orders.map(async (order) => {
      const items = await prisma.pedidoCompraItem.findMany({
        where: { pedidoCompraId: order.id }
      });
      const subtotal = items.reduce(
        (sum, item) => sum.plus(item.totalItem),
        new Prisma.Decimal(0)
      );
      await prisma.pedidoCompra.update({
        where: { id: order.id },
        data: { subtotal, total: subtotal }
      });
    })
  );
  for (const [index, store] of [dronz, gooder].entries()) {
    const suffix = index === 0 ? "dronz" : "gooder",
      item = await prisma.pedidoCompraItem.findFirstOrThrow({
        where: { pedidoCompraId: orders[index].id }
      });
    const traveler = await prisma.viajante.upsert({
      where: { id: `seed-traveler-${suffix}` },
      update: { lojaId: store.id, nome: `Viajante ${suffix}`, ativo: true },
      create: {
        id: `seed-traveler-${suffix}`,
        lojaId: store.id,
        nome: `Viajante ${suffix}`
      }
    });
    const trip = await prisma.viagem.upsert({
      where: { id: `seed-trip-${suffix}` },
      update: {},
      create: {
        id: `seed-trip-${suffix}`,
        lojaId: store.id,
        viajanteId: traveler.id,
        origem: "Miami",
        destino: "Brasil",
        partidaEm: new Date("2026-08-06T13:00:00Z"),
        chegadaPrevistaEm: new Date("2026-08-07T13:00:00Z"),
        status: "OPEN_FOR_ALLOCATION"
      }
    });
    const suitcase = await prisma.mala.upsert({
      where: { id: `seed-suitcase-${suffix}` },
      update: {},
      create: {
        id: `seed-suitcase-${suffix}`,
        lojaId: store.id,
        viagemId: trip.id,
        codigo: "MALA-1"
      }
    });
    const volume = await prisma.volumeLogistico.upsert({
      where: { id: `seed-volume-${suffix}` },
      update: {},
      create: {
        id: `seed-volume-${suffix}`,
        lojaId: store.id,
        malaId: suitcase.id,
        codigo: "VOL-1",
        taraKg: "0.500"
      }
    });
    await prisma.alocacaoMala.upsert({
      where: {
        pedidoCompraItemId_malaId_volumeLogisticoId: {
          pedidoCompraItemId: item.id,
          malaId: suitcase.id,
          volumeLogisticoId: volume.id
        }
      },
      update: { quantidade: 1, pesoConteudoKg: "1.000" },
      create: {
        lojaId: store.id,
        pedidoCompraItemId: item.id,
        malaId: suitcase.id,
        volumeLogisticoId: volume.id,
        quantidade: 1,
        pesoConteudoKg: "1.000"
      }
    });
  }
  await Promise.all(
    products.map((product, index) =>
      prisma.estoque.upsert({
        where: {
          lojaId_produtoId: {
            lojaId: index === 0 ? dronz.id : gooder.id,
            produtoId: product.id
          }
        },
        update: {},
        create: {
          lojaId: index === 0 ? dronz.id : gooder.id,
          produtoId: product.id
        }
      })
    )
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});
