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

describe("vendas e baixa patrimonial (Batch 17)", () => {
  it("saldo BR 2 e duas vendas concorrentes de 2: só uma confirma", async () => {
    const ctx = await admin();
    const { data, stock, lot } = await stocked(2);
    const sales = [
      await draft(ctx, data.product.id, 2),
      await draft(ctx, data.product.id, 2)
    ];
    const { confirmSale } = await import("../src/modules/sales/sales.service");
    const results = await Promise.allSettled(
      sales.map((sale) =>
        confirmSale(ctx.store.id, ctx.userId, sale.body.id, {
          lotes: [
            {
              vendaItemId: sale.body.itens[0].id,
              movimentoEntradaId: lot.id,
              quantidade: 2
            }
          ]
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(0);
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: data.product.id, tipo: "EXIT", motivo: "SALE" }
      })
    ).toBe(1);
  });

  it("estoque reservado não satisfaz a venda e o estoque genérico não aceita saída por venda", async () => {
    const ctx = await admin();
    const { data, lot } = await stocked(2, 2);
    const sale = await draft(ctx, data.product.id, 1);
    const confirm = await request(ctx.app)
      .post(`/sales/${sale.body.id}/confirm`)
      .set(ctx.headers)
      .send({
        lotes: [
          {
            vendaItemId: sale.body.itens[0].id,
            movimentoEntradaId: lot.id,
            quantidade: 1
          }
        ]
      });
    expect(confirm.body.error).toBe("insufficient_stock");
    const generic = await request(ctx.app)
      .post("/inventory/movements")
      .set(ctx.headers)
      .send({
        produtoId: data.product.id,
        tipo: "EXIT",
        motivo: "SALE",
        quantidade: 1
      });
    expect(generic.body.error).toBe("sale_requires_sales_module");
  });

  it("custo é snapshot do lote com câmbio registrado; receita, lucro e margem batem e não mudam depois", async () => {
    const ctx = await admin();
    const { data, lot } = await stocked(2);
    const rate = await request(ctx.app)
      .post("/finance/exchange-rates")
      .set(ctx.headers)
      .send({
        moedaOrigem: "USD",
        moedaDestino: "BRL",
        valorMercado: 5,
        margem: 0,
        fonte: "teste B17",
        cotadoEm: "2026-10-17T12:00:00.000Z"
      });
    quotes.push(rate.body.id);
    await request(ctx.app)
      .put(`/finance/orders/${data.order.id}/costs`)
      .set(ctx.headers)
      .send({
        cotacaoCambioId: rate.body.id,
        iofPercentual: 0,
        taxas: 0,
        custoAdicional: 0
      });
    const sale = await draft(ctx, data.product.id, 1, {
      precoUnitario: 400,
      taxaMarketplace: 64,
      notaFiscal: 24
    });
    const suggestion = await request(ctx.app)
      .get(`/sales/${sale.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(suggestion.body.itens[0]).toMatchObject({
      faltante: 0,
      lotes: [
        { movimentoEntradaId: lot.id, quantidade: 1, custoConhecido: true }
      ]
    });
    const confirmed = await request(ctx.app)
      .post(`/sales/${sale.body.id}/confirm`)
      .set(ctx.headers)
      .send({
        lotes: suggestion.body.itens[0].lotes.map(
          (entry: { movimentoEntradaId: string; quantidade: number }) => ({
            vendaItemId: sale.body.itens[0].id,
            movimentoEntradaId: entry.movimentoEntradaId,
            quantidade: entry.quantidade
          })
        )
      });
    expect(confirmed.status).toBe(200);
    // 400 − 64 − 24 = 312; custo 50 USD × 5 = 250 BRL; lucro 62; margem 62/312.
    expect(confirmed.body).toMatchObject({
      estado: "CONFIRMADA",
      receitaBruta: "400.00",
      receitaLiquida: "312.00",
      custo: "250.00",
      lucro: "62.00",
      margem: "19.87",
      recebivel: { valorPrevisto: "336", status: "PENDENTE" }
    });
    expect(confirmed.body.itens[0].baixas[0]).toMatchObject({
      custoUnitario: "50.00",
      moedaCusto: "USD",
      custoUnitarioConvertido: "250.00",
      politica: "X-10-LOTE-v1"
    });
    // Custo do pedido alterado depois não recalcula o lucro histórico.
    await request(ctx.app)
      .put(`/finance/orders/${data.order.id}/costs`)
      .set(ctx.headers)
      .send({
        cotacaoCambioId: rate.body.id,
        iofPercentual: 0,
        taxas: 40,
        custoAdicional: 0
      });
    const later = await request(ctx.app)
      .get(`/sales/${sale.body.id}`)
      .set(ctx.headers);
    expect(later.body.lucro).toBe("62.00");
    // Recebível: parcial, excedente rejeitado, quitação.
    const receipt = (valor: number) =>
      request(ctx.app)
        .post(`/sales/${sale.body.id}/receipts`)
        .set(ctx.headers)
        .set("idempotency-key", randomUUID())
        .send({ valor, recebidoEm: "2026-10-30T12:00:00.000Z" });
    expect((await receipt(300)).body.status).toBe("PARCIAL");
    expect((await receipt(37)).body.error).toBe("receipt_exceeds_receivable");
    expect((await receipt(36)).body.status).toBe("RECEBIDO");
    expect(
      (
        await request(ctx.app)
          .post(`/sales/${sale.body.id}/cancel`)
          .set(ctx.headers)
          .send({ motivo: "teste" })
      ).body.error
    ).toBe("sale_not_draft");
  });

  it("falha de auditoria reverte venda e baixa; lotes precisam cobrir o item", async () => {
    const ctx = await admin();
    const { data, stock, lot } = await stocked(2);
    const sale = await draft(ctx, data.product.id, 2);
    const confirm = (quantidade: number) =>
      request(ctx.app)
        .post(`/sales/${sale.body.id}/confirm`)
        .set(ctx.headers)
        .send({
          lotes: [
            {
              vendaItemId: sale.body.itens[0].id,
              movimentoEntradaId: lot.id,
              quantidade
            }
          ]
        });
    expect((await confirm(1)).body.error).toBe("lots_must_cover_item");
    const { setAuditFailureForTests } =
      await import("../src/modules/operations/operations.persistence");
    setAuditFailureForTests((input) => input.action === "CONFIRM_SALE");
    try {
      expect((await confirm(2)).status).toBe(500);
    } finally {
      setAuditFailureForTests();
    }
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(2);
    expect(
      await prisma.baixaVenda.count({ where: { movimentoEntradaId: lot.id } })
    ).toBe(0);
    expect(
      (await prisma.venda.findUniqueOrThrow({ where: { id: sale.body.id } }))
        .estado
    ).toBe("RASCUNHO");
    expect((await confirm(2)).body.estado).toBe("CONFIRMADA");
  });

  it("rascunho cancelado não move estoque e custo fica oculto sem acesso financeiro", async () => {
    const ctx = await admin();
    const { data, stock } = await stocked(2);
    const sale = await draft(ctx, data.product.id, 1);
    expect(
      (
        await request(ctx.app)
          .post(`/sales/${sale.body.id}/cancel`)
          .set(ctx.headers)
          .send({ motivo: "cliente desistiu" })
      ).body.estado
    ).toBe("CANCELADA");
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(2);
    const { getSale } = await import("../src/modules/sales/sales.service");
    const hidden = await getSale(ctx.store.id, sale.body.id, false);
    expect(hidden).not.toHaveProperty("custo");
    expect(hidden.itens[0]).not.toHaveProperty("baixas");
  });

  it("filtra custo na confirmação e no replay de outro usuário sem acesso financeiro", async () => {
    const ctx = await admin();
    const { data, lot } = await stocked();
    const profile = await prisma.perfil.create({
      data: { code: `SALE_TEST_${randomUUID()}`, name: "Vendas sem financeiro" }
    });
    profiles.push(profile.id);
    for (const code of ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]) {
      const permission = await prisma.permissao.findUniqueOrThrow({
        where: { code }
      });
      await prisma.perfilPermissao.create({
        data: { perfilId: profile.id, permissaoId: permission.id }
      });
    }
    const user = await prisma.usuario.create({
      data: {
        email: `sale-${randomUUID()}@example.com`,
        name: "Vendas",
        passwordHash: data.admin.passwordHash,
        lojas: { create: { lojaId: ctx.store.id } },
        perfis: { create: { perfilId: profile.id } }
      }
    });
    users.push(user.id);
    const login = await request(ctx.app)
      .post("/auth/login")
      .send({ email: user.email, password: "change-me" });
    const operatorHeaders = {
      ...ctx.headers,
      Authorization: `Bearer ${login.body.accessToken}`
    };
    const sale = await draft(ctx, data.product.id, 1);
    const body = {
      lotes: [
        {
          vendaItemId: sale.body.itens[0].id,
          movimentoEntradaId: lot.id,
          quantidade: 1
        }
      ]
    };
    const key = randomUUID();
    const confirm = (headers: typeof ctx.headers) =>
      request(ctx.app)
        .post(`/sales/${sale.body.id}/confirm`)
        .set(headers)
        .set("idempotency-key", key)
        .send(body);
    const privileged = await confirm(ctx.headers);
    expect(privileged.status).toBe(200);
    expect(privileged.body).toHaveProperty("custo");
    const replay = await confirm(operatorHeaders);
    expect(replay.status).toBe(200);
    expect(replay.body).not.toHaveProperty("custo");
    expect(replay.body).not.toHaveProperty("lucro");
    expect(replay.body.itens[0]).not.toHaveProperty("baixas");
    const fresh = await draft(ctx, data.product.id, 1);
    const confirmed = await request(ctx.app)
      .post(`/sales/${fresh.body.id}/confirm`)
      .set(operatorHeaders)
      .send({
        lotes: [
          {
            vendaItemId: fresh.body.itens[0].id,
            movimentoEntradaId: lot.id,
            quantidade: 1
          }
        ]
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).not.toHaveProperty("custo");
  });

  it("não reutiliza lote perdido após reposição e desconta reservas da sugestão", async () => {
    const ctx = await admin();
    const { data, lot, stock } = await stocked(2, 1);
    const sale = await draft(ctx, data.product.id, 2);
    const suggestion = await request(ctx.app)
      .get(`/sales/${sale.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(suggestion.body.itens[0]).toMatchObject({
      faltante: 1,
      lotes: [{ quantidade: 1 }]
    });
    const { move } = await import("../src/modules/inventory/inventory.service");
    await move(ctx.store.id, ctx.userId, {
      produtoId: data.product.id,
      tipo: "RELEASE_RESERVATION",
      motivo: "RESERVATION_RELEASE",
      quantidade: 1
    });
    await move(ctx.store.id, ctx.userId, {
      produtoId: data.product.id,
      tipo: "ADJUSTMENT_NEGATIVE",
      motivo: "LOSS",
      quantidade: 2,
      observacoes: "Perda integral"
    });
    await move(ctx.store.id, ctx.userId, {
      produtoId: data.product.id,
      tipo: "ADJUSTMENT_POSITIVE",
      motivo: "MANUAL_CORRECTION",
      quantidade: 2,
      observacoes: "Reposição de outra origem"
    });
    const blocked = await request(ctx.app)
      .get(`/sales/${sale.body.id}/lot-suggestion`)
      .set(ctx.headers);
    expect(blocked.body.itens[0]).toMatchObject({
      faltante: 2,
      lotes: [],
      blockedReason: "stock_lots_require_reconciliation"
    });
    const confirmed = await request(ctx.app)
      .post(`/sales/${sale.body.id}/confirm`)
      .set(ctx.headers)
      .send({
        lotes: [
          {
            vendaItemId: sale.body.itens[0].id,
            movimentoEntradaId: lot.id,
            quantidade: 2
          }
        ]
      });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error).toBe("stock_lots_require_reconciliation");
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(2);
    expect(
      await prisma.baixaVenda.count({ where: { movimentoEntradaId: lot.id } })
    ).toBe(0);
  });

  it("exige idempotência e não duplica criação, recebimento ou auditoria no replay", async () => {
    const ctx = await admin();
    const { data, lot } = await stocked();
    const body = {
      canal: "OUTRO",
      dataVenda: "2026-10-18T12:00:00Z",
      moeda: "USD",
      itens: [{ produtoId: data.product.id, quantidade: 1, precoUnitario: 100 }]
    };
    expect(
      (await request(ctx.app).post("/sales").set(ctx.headers).send(body)).status
    ).toBe(400);
    const key = randomUUID();
    const create = () =>
      request(ctx.app)
        .post("/sales")
        .set(ctx.headers)
        .set("idempotency-key", key)
        .send(body);
    const sale = await create();
    expect(sale.status).toBe(201);
    expect((await create()).body.id).toBe(sale.body.id);
    expect(
      await prisma.vendaItem.count({ where: { produtoId: data.product.id } })
    ).toBe(1);
    await request(ctx.app)
      .post(`/sales/${sale.body.id}/confirm`)
      .set(ctx.headers)
      .send({
        lotes: [
          {
            vendaItemId: sale.body.itens[0].id,
            movimentoEntradaId: lot.id,
            quantidade: 1
          }
        ]
      });
    const receiptBody = { valor: 25, recebidoEm: "2034-01-15T12:00:00Z" };
    const url = `/sales/${sale.body.id}/receipts`;
    expect(
      (await request(ctx.app).post(url).set(ctx.headers).send(receiptBody))
        .status
    ).toBe(400);
    const receiptKey = randomUUID();
    const receive = (payload = receiptBody) =>
      request(ctx.app)
        .post(url)
        .set(ctx.headers)
        .set("idempotency-key", receiptKey)
        .send(payload);
    expect((await receive()).body.valorRecebido).toBe("25");
    expect((await receive()).body.valorRecebido).toBe("25");
    expect((await receive({ ...receiptBody, valor: 30 })).body.error).toBe(
      "idempotency_conflict"
    );
    expect(
      await prisma.auditLog.count({
        where: { action: "RECEIVE_SALE", idempotencyKey: receiptKey }
      })
    ).toBe(1);
    const incompatible = await request(ctx.app)
      .post(url)
      .set(ctx.headers)
      .set("idempotency-key", randomUUID())
      .send({ ...receiptBody, transacaoFonteId: "fonte-b16-incompativel" });
    expect(incompatible.status).toBe(409);
    expect(incompatible.body.error).toBe("sale_receipt_source_not_supported");
    expect(
      (
        await prisma.recebivelVenda.findUniqueOrThrow({
          where: { vendaId: sale.body.id }
        })
      ).valorRecebido.toString()
    ).toBe("25");
  });
});
