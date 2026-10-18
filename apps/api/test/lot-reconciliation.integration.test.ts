import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createOperationalFixture } from "./helpers/operational-fixture";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
type Fixture = Awaited<ReturnType<typeof createOperationalFixture>>;
const fixtures: Fixture[] = [];
const quotes: string[] = [];
const users: string[] = [];
const profiles: string[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const data of fixtures.splice(0)) {
    const sales = {
      venda: { itens: { some: { produtoId: data.product.id } } }
    };
    await prisma.recebivelVenda.deleteMany({ where: sales });
    await prisma.devolucaoVenda.deleteMany({ where: sales });
    await prisma.reconciliacaoLote.deleteMany({
      where: { lote: { produtoId: data.product.id } }
    });
    await prisma.baixaVenda.deleteMany({
      where: { item: { produtoId: data.product.id } }
    });
    const ids = (
      await prisma.venda.findMany({
        where: { itens: { some: { produtoId: data.product.id } } },
        select: { id: true }
      })
    ).map((sale) => sale.id);
    await prisma.vendaItem.deleteMany({ where: { vendaId: { in: ids } } });
    await prisma.venda.deleteMany({ where: { id: { in: ids } } });
    await prisma.custoPedidoItem.deleteMany({
      where: { custo: { pedidoCompraId: data.order.id } }
    });
    await prisma.custoPedido.deleteMany({
      where: { pedidoCompraId: data.order.id }
    });
    await data.cleanup();
  }
  await prisma.cotacaoCambio.deleteMany({
    where: { id: { in: quotes.splice(0) } }
  });
  for (const id of users.splice(0)) {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.delete({ where: { id } });
  }
  for (const id of profiles.splice(0)) {
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: id } });
    await prisma.perfil.delete({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

async function admin() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const store = login.body.stores.find(
    (entry: { slug: string }) => entry.slug === "dronz"
  );
  return {
    app,
    store,
    userId: login.body.user.id as string,
    headers: {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": store.id
    }
  };
}

// Estoque Brasil com um lote ENTRY ligado ao item de compra (2 × USD 50).
async function stocked(quantidade = 2, reservada = 0) {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  fixtures.push(data);
  const stock = await prisma.estoque.create({
    data: {
      lojaId: store.id,
      produtoId: data.product.id,
      quantidadeFisica: quantidade,
      quantidadeReservada: reservada
    }
  });
  const lot = await prisma.movimentacaoEstoque.create({
    data: {
      lojaId: store.id,
      produtoId: data.product.id,
      estoqueId: stock.id,
      pedidoCompraItemId: data.item.id,
      tipo: "ENTRY",
      motivo: "PURCHASE_RECEIPT",
      quantidade,
      quantidadeAnterior: 0,
      quantidadePosterior: quantidade,
      responsavelId: data.admin.id
    }
  });
  return { data, stock, lot };
}

const draft = (
  ctx: Awaited<ReturnType<typeof admin>>,
  produtoId: string,
  quantidade: number,
  extra: Record<string, unknown> = {}
) =>
  request(ctx.app)
    .post("/sales")
    .set(ctx.headers)
    .set("idempotency-key", randomUUID())
    .send({
      canal: "MERCADO_LIVRE",
      dataVenda: "2026-10-18T12:00:00.000Z",
      moeda: "BRL",
      itens: [{ produtoId, quantidade, precoUnitario: 100, ...extra }]
    });

const post = (
  ctx: Awaited<ReturnType<typeof admin>>,
  path: string,
  body: object
) =>
  request(ctx.app)
    .post(path)
    .set(ctx.headers)
    .set("idempotency-key", randomUUID())
    .send(body);

describe("PD-03 reconciliação de lotes legados", () => {
  it("saída antiga sem lote bloqueia a venda até a reconciliação explícita; lote sem custo pode ser ligado ao item", async () => {
    const ctx = await admin();
    const { data, stock, lot } = await stocked(2);
    const t0 = Date.now();
    await prisma.movimentacaoEstoque.update({
      where: { id: lot.id },
      data: { createdAt: new Date(t0 - 60_000) }
    });
    // Lote legado sem item de compra (+1) e perda antiga sem lote (−1): físico 2, lotes 3.
    const legacy = await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: ctx.store.id,
        produtoId: data.product.id,
        estoqueId: stock.id,
        tipo: "ADJUSTMENT_POSITIVE",
        motivo: "MANUAL_CORRECTION",
        quantidade: 1,
        quantidadeAnterior: 2,
        quantidadePosterior: 3,
        responsavelId: data.admin.id,
        createdAt: new Date(t0 - 30_000)
      }
    });
    await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: ctx.store.id,
        produtoId: data.product.id,
        estoqueId: stock.id,
        tipo: "EXIT",
        motivo: "LOSS",
        quantidade: 1,
        quantidadeAnterior: 3,
        quantidadePosterior: 2,
        responsavelId: data.admin.id,
        createdAt: new Date(t0 - 10_000)
      }
    });
    const diagnosis = async () =>
      (
        await request(ctx.app)
          .get(`/inventory/lots/${data.product.id}`)
          .set(ctx.headers)
      ).body;
    expect(await diagnosis()).toMatchObject({
      estoqueFisico: 2,
      saldoLotes: 3,
      reconciliado: false
    });
    expect((await diagnosis()).saidasSemLote).toHaveLength(1);
    const sale = await draft(ctx, data.product.id, 1);
    const blocked = await request(ctx.app)
      .get(`/sales/${sale.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(blocked.body.itens[0].blockedReason).toBe(
      "stock_lots_require_reconciliation"
    );

    expect(
      (await post(ctx, `/inventory/lots/${data.product.id}/reconcile`, {}))
        .status
    ).toBe(400);
    const reconciled = await post(
      ctx,
      `/inventory/lots/${data.product.id}/reconcile`,
      { motivo: "Perda de 2025 sem lote" }
    );
    expect(reconciled.body).toMatchObject({ reconciliacoes: 1, saldoLotes: 2 });
    expect(await diagnosis()).toMatchObject({
      estoqueFisico: 2,
      saldoLotes: 2,
      reconciliado: true,
      saidasSemLote: []
    });
    // A perda consumiu o lote mais antigo (o da compra).
    expect(
      (await diagnosis()).lotes.find(
        (l: { movimentoEntradaId: string }) => l.movimentoEntradaId === lot.id
      ).restante
    ).toBe(1);
    expect(
      (
        await post(ctx, `/inventory/lots/${data.product.id}/reconcile`, {
          motivo: "de novo"
        })
      ).body.error
    ).toBe("lots_already_reconciled");
    const ok = await request(ctx.app)
      .get(`/sales/${sale.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(ok.body.itens[0]).toMatchObject({
      blockedReason: null,
      faltante: 0
    });

    // Vínculo de custo: o item da compra só cobre 2 unidades, já ligadas ao lote de compra.
    const link = (pedidoCompraItemId: string) =>
      post(ctx, `/inventory/lots/entries/${legacy.id}/purchase-item`, {
        pedidoCompraItemId,
        motivo: "NF localizada"
      });
    expect((await link(data.item.id)).body.error).toBe(
      "lot_exceeds_purchase_item"
    );
    // Com a compra corrigida para 3 unidades, o lote legado pode ser ligado ao item.
    await prisma.pedidoCompraItem.update({
      where: { id: data.item.id },
      data: { quantidade: 3 }
    });
    expect((await link(data.item.id)).body).toMatchObject({
      pedidoCompraItemId: data.item.id
    });
    expect((await link(data.item.id)).body.error).toBe("lot_already_linked");
    expect(
      (await diagnosis()).lotes.find(
        (l: { movimentoEntradaId: string }) =>
          l.movimentoEntradaId === legacy.id
      )
    ).toMatchObject({ custoConhecido: true });
    expect(
      await prisma.auditLog.count({
        where: { action: "RECONCILE_LOTS", entityId: data.product.id }
      })
    ).toBe(1);
  });
});
