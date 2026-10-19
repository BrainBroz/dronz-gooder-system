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
    // Lote de devolução aponta para a baixa original (baixaOrigemId): soltar antes de apagar a baixa.
    await prisma.movimentacaoEstoque.updateMany({
      where: { produtoId: data.product.id, baixaOrigemId: { not: null } },
      data: { baixaOrigemId: null }
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

async function confirmed(
  ctx: Awaited<ReturnType<typeof admin>>,
  quantidade: number
) {
  const setup = await stocked(2);
  const sale = await draft(ctx, setup.data.product.id, quantidade);
  const result = await post(ctx, `/sales/${sale.body.id}/confirm`, {
    lotes: [
      {
        vendaItemId: sale.body.itens[0].id,
        movimentoEntradaId: setup.lot.id,
        quantidade
      }
    ]
  });
  expect(result.body.estado).toBe("CONFIRMADA");
  return { ...setup, sale: result.body };
}

const physical = async (stockId: string) =>
  (await prisma.estoque.findUniqueOrThrow({ where: { id: stockId } }))
    .quantidadeFisica;

describe("PD-01 estorno e PD-02 devolução de venda", () => {
  it("estorno devolve o saldo ao lote original, mantém a venda original e permite vender de novo", async () => {
    const ctx = await admin();
    const { data, stock, lot, sale } = await confirmed(ctx, 2);
    expect(await physical(stock.id)).toBe(0);
    expect(
      (
        await post(ctx, `/sales/${sale.id}/reverse`, {
          motivo: "Pedido cancelado antes do envio"
        })
      ).status
    ).toBe(400);
    const reversed = await post(ctx, `/sales/${sale.id}/reverse`, {
      motivo: "Pedido cancelado antes do envio",
      itemNaoSaiu: true
    });
    expect(reversed.body).toMatchObject({ estado: "ESTORNADA" });
    expect(await physical(stock.id)).toBe(2);
    // Venda original preservada: itens, baixas e receita continuam lá; o estorno é marcado à parte.
    const view = (
      await request(ctx.app).get(`/sales/${sale.id}`).set(ctx.headers)
    ).body;
    expect(view).toMatchObject({
      estado: "ESTORNADA",
      receitaBruta: "200.00",
      lucro: null,
      recebivel: { status: "ESTORNADO" }
    });
    expect(view.itens[0].baixas).toHaveLength(1);
    expect(
      (
        await post(ctx, `/sales/${sale.id}/reverse`, {
          motivo: "de novo",
          itemNaoSaiu: true
        })
      ).body.error
    ).toBe("sale_not_confirmed");
    // O lote original voltou a ter saldo e os lotes continuam reconciliados com o físico.
    const again = await draft(ctx, data.product.id, 2);
    const suggestion = await request(ctx.app)
      .get(`/sales/${again.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(suggestion.body.itens[0]).toMatchObject({
      faltante: 0,
      blockedReason: null,
      lotes: [{ movimentoEntradaId: lot.id, quantidade: 2 }]
    });
  });

  it("estorno é recusado quando já houve recebimento", async () => {
    const ctx = await admin();
    const { sale } = await confirmed(ctx, 1);
    await post(ctx, `/sales/${sale.id}/receipts`, {
      valor: 10,
      recebidoEm: "2026-10-19T12:00:00.000Z"
    });
    expect(
      (
        await post(ctx, `/sales/${sale.id}/reverse`, {
          motivo: "tarde",
          itemNaoSaiu: true
        })
      ).body.error
    ).toBe("receivable_has_receipts");
  });

  it("devolução só entra no estoque após conferência apta, como lote novo com o custo original", async () => {
    const ctx = await admin();
    const { data, stock, sale } = await confirmed(ctx, 2);
    const itemId = sale.itens[0].id;
    expect(
      (
        await post(ctx, `/sales/${sale.id}/returns`, {
          vendaItemId: itemId,
          quantidade: 3,
          motivo: "cliente"
        })
      ).body.error
    ).toBe("return_exceeds_sold");
    const expected = await post(ctx, `/sales/${sale.id}/returns`, {
      vendaItemId: itemId,
      quantidade: 1,
      motivo: "Arrependimento"
    });
    expect(expected.status).toBe(201);
    const rejected = await post(ctx, `/sales/${sale.id}/returns`, {
      vendaItemId: itemId,
      quantidade: 1,
      motivo: "Defeito"
    });
    // Registrar não mexe em estoque.
    expect(await physical(stock.id)).toBe(0);
    const ok = await post(ctx, `/sales/returns/${expected.body.id}/check`, {
      apta: true,
      condicaoComercial: "CAIXA_ABERTA",
      funcionamento: "FUNCIONAL"
    });
    expect(ok.body.estado).toBe("CONFERIDA");
    const no = await post(ctx, `/sales/returns/${rejected.body.id}/check`, {
      apta: false,
      condicaoComercial: "USADO",
      funcionamento: "INOPERANTE",
      observacao: "Tela quebrada"
    });
    expect(no.body.estado).toBe("REJEITADA");
    expect(await physical(stock.id)).toBe(1);
    expect(
      (
        await post(ctx, `/sales/returns/${expected.body.id}/check`, {
          apta: true,
          condicaoComercial: "NOVO",
          funcionamento: "FUNCIONAL"
        })
      ).body.error
    ).toBe("return_already_checked");
    const returnLot = await prisma.movimentacaoEstoque.findFirstOrThrow({
      where: {
        produtoId: data.product.id,
        tipo: "RETURN_ENTRY",
        motivo: "RETURN"
      }
    });
    expect(returnLot).toMatchObject({
      quantidade: 1,
      pedidoCompraItemId: data.item.id
    });
    // Venda nova consome o lote da devolução com custo conhecido.
    const again = await draft(ctx, data.product.id, 1);
    const suggestion = await request(ctx.app)
      .get(`/sales/${again.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(suggestion.body.itens[0]).toMatchObject({
      faltante: 0,
      lotes: [
        {
          movimentoEntradaId: returnLot.id,
          quantidade: 1,
          custoConhecido: true
        }
      ]
    });
    // Com devolução em aberto ou conferida, o estorno integral é bloqueado.
    expect(
      (
        await post(ctx, `/sales/${sale.id}/reverse`, {
          motivo: "Estorno integral",
          itemNaoSaiu: true
        })
      ).body.error
    ).toBe("sale_has_returns");
  });
});
