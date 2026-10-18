import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOperationalFixture } from "./helpers/operational-fixture";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

// Regressões dos cinco achados da auditoria do Codex sobre PD-01..PD-13 (baseline 363db60).
const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

async function packages() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  const base = await prisma.posicaoOperacional.findUniqueOrThrow({
    where: { id: "posicao-miami-base" }
  });
  const hotel = await prisma.posicaoOperacional.create({
    data: {
      localId: base.localId,
      codigo: `AUD-${randomUUID()}`,
      nome: "Hotel auditoria",
      tipo: "TEMPORARIA",
      status: "ATIVA",
      inicioEm: new Date(Date.now() - 86_400_000),
      fimEm: new Date(Date.now() + 86_400_000)
    }
  });
  const purchase = await prisma.compraImportada.create({
    data: {
      numeroPedido: `AUD-${randomUUID()}`,
      quantidade: 2,
      plataforma: "MANUAL",
      dataPedido: new Date()
    }
  });
  await prisma.pedidoCompra.update({
    where: { id: data.order.id },
    data: { compraImportadaId: purchase.id, destinoPosicaoId: base.id }
  });
  const shipment = await prisma.envioExterno.create({
    data: {
      compraImportadaId: purchase.id,
      externalShipmentId: "AUD",
      ultimaAtualizacaoEm: new Date()
    }
  });
  const [a, b] = await Promise.all(
    ["A", "B"].map((externalPackageId) =>
      prisma.pacoteExterno.create({
        data: { envioExternoId: shipment.id, externalPackageId }
      })
    )
  );
  cleanups.push(async () => {
    await prisma.recebimentoMiami.deleteMany({
      where: { pedidoCompraItemId: data.item.id }
    });
    await prisma.pacoteItem.deleteMany({
      where: { pedidoCompraItemId: data.item.id }
    });
    await prisma.pacoteExterno.deleteMany({
      where: { envioExternoId: shipment.id }
    });
    await prisma.envioExterno.deleteMany({ where: { id: shipment.id } });
    await prisma.pedidoCompra.update({
      where: { id: data.order.id },
      data: { compraImportadaId: null }
    });
    await data.cleanup();
    await prisma.compraImportada.delete({ where: { id: purchase.id } });
    await prisma.posicaoOperacional.delete({ where: { id: hotel.id } });
  });
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const headers = {
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": store.id
  };
  const put = (pkgId: string, path: string, body: object) =>
    request(app)
      .put(`/purchase-orders/${data.order.id}/packages/${pkgId}/${path}`)
      .set(headers)
      .send(body);
  const content = (pkgId: string, quantidade: number) =>
    put(pkgId, "items", {
      itens: quantidade
        ? [{ pedidoCompraItemId: data.item.id, quantidade }]
        : [],
      motivo: "Conteúdo auditado"
    });
  const admin = { userId: data.admin.id, permissions: ["SYSTEM_ADMIN"] };
  return {
    store,
    data,
    base,
    hotel,
    a: a!,
    b: b!,
    app,
    headers,
    put,
    content,
    admin
  };
}

const assigned = async (itemId: string) =>
  (
    await prisma.pacoteItem.aggregate({
      where: { pedidoCompraItemId: itemId },
      _sum: { quantidade: true }
    })
  )._sum.quantidade ?? 0;

describe("auditoria PD: conteúdo de pacote sob concorrência", () => {
  it("dois pacotes disputando as 2 unidades: a soma persistida nunca passa do comprado", async () => {
    const ctx = await packages();
    const { setPackageItems } =
      await import("../src/modules/purchase-orders/tracking.service");
    for (let round = 0; round < 3; round++) {
      await prisma.pacoteItem.deleteMany({
        where: { pedidoCompraItemId: ctx.data.item.id }
      });
      const results = await Promise.allSettled(
        [ctx.a, ctx.b].map((pkg) =>
          setPackageItems(
            ctx.store.id,
            ctx.data.admin.id,
            ctx.data.order.id,
            pkg.id,
            {
              itens: [{ pedidoCompraItemId: ctx.data.item.id, quantidade: 2 }],
              motivo: "Concorrência"
            }
          )
        )
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === "rejected"
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "package_exceeds_item" });
      expect(await assigned(ctx.data.item.id)).toBe(2);
    }
  });

  it("edição reduz e remoção libera o saldo para outro pacote", async () => {
    const ctx = await packages();
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    expect((await ctx.content(ctx.b.id, 1)).body.error).toBe(
      "package_exceeds_item"
    );
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    expect((await ctx.content(ctx.b.id, 1)).status).toBe(200);
    expect((await ctx.content(ctx.a.id, 0)).status).toBe(200);
    expect((await ctx.content(ctx.b.id, 2)).status).toBe(200);
    expect(await assigned(ctx.data.item.id)).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "SET_PACKAGE_ITEMS",
          entityId: { in: [ctx.a.id, ctx.b.id] }
        }
      })
    ).toBe(5);
  });
});

describe("auditoria PD: recebimento no destino efetivo do pacote", () => {
  it("pacote redirecionado recebe no hotel com rastreio; herdado recebe na base; saldo e caminho legado protegidos", async () => {
    const ctx = await packages();
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    expect((await ctx.content(ctx.b.id, 1)).status).toBe(200);
    const receive = (body: Record<string, unknown>, actor = ctx.admin) =>
      confirmMiami(
        ctx.store.id,
        actor,
        {
          pedidoCompraItemId: ctx.data.item.id,
          quantidadeRecebida: 1,
          recebidoEm: new Date(),
          ...body
        },
        randomUUID()
      );
    // Caminho legado não consome unidades declaradas em pacote.
    await expect(receive({})).rejects.toMatchObject({
      code: "package_receipt_required"
    });
    // Destino divergente do pacote continua recusado.
    await expect(
      receive({ pacoteExternoId: ctx.a.id, posicaoId: ctx.base.id })
    ).rejects.toMatchObject({
      code: "destination_mismatch"
    });
    // Sem vínculo contextual na posição do pacote, não recebe.
    await expect(
      receive(
        { pacoteExternoId: ctx.a.id },
        { userId: ctx.data.admin.id, permissions: [] }
      )
    ).rejects.toMatchObject({
      code: "position_not_authorized"
    });
    const hotel = await receive({
      pacoteExternoId: ctx.a.id,
      posicaoId: ctx.hotel.id
    });
    expect(hotel).toMatchObject({
      posicaoId: ctx.hotel.id,
      pacoteExternoId: ctx.a.id
    });
    await expect(receive({ pacoteExternoId: ctx.a.id })).rejects.toMatchObject({
      code: "package_quantity_exceeded"
    });
    const inherited = await receive({ pacoteExternoId: ctx.b.id });
    expect(inherited).toMatchObject({
      posicaoId: ctx.base.id,
      pacoteExternoId: ctx.b.id
    });
    // Depois de receber, o conteúdo não muda mais.
    expect((await ctx.content(ctx.b.id, 2)).body.error).toBe(
      "already_received"
    );
  });

  it("recebimento parcial por pacote e pacote de outro item são tratados", async () => {
    const ctx = await packages();
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    const receive = (pacoteExternoId: string, quantidadeRecebida: number) =>
      confirmMiami(
        ctx.store.id,
        ctx.admin,
        {
          pedidoCompraItemId: ctx.data.item.id,
          quantidadeRecebida,
          recebidoEm: new Date(),
          pacoteExternoId
        },
        randomUUID()
      );
    await expect(receive(ctx.b.id, 1)).rejects.toMatchObject({
      code: "package_item_not_declared"
    });
    await receive(ctx.a.id, 1);
    const onWay = async () =>
      (
        await request(ctx.app)
          .get(`/positions/${ctx.base.id}/availability`)
          .set(ctx.headers)
      ).body.find(
        (row: { pedidoCompraItemId: string }) =>
          row.pedidoCompraItemId === ctx.data.item.id
      ).aCaminho;
    expect(await onWay()).toBe(1);
    await receive(ctx.a.id, 1);
    await expect(receive(ctx.a.id, 1)).rejects.toMatchObject({
      code: "conflict"
    });
    expect(
      (
        await prisma.pedidoCompraItem.findUniqueOrThrow({
          where: { id: ctx.data.item.id }
        })
      ).quantidadeRecebidaMiami
    ).toBe(2);
  });
});

describe("auditoria PD: encerramento com pacote pendente", () => {
  it("hotel com pacote destinado e não recebido não encerra; após o recebimento, encerra", async () => {
    const ctx = await packages();
    const { closurePendencies, transition } =
      await import("../src/modules/positions/positions.service");
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    // Redirecionado sem conteúdo declarado: pendente, porque não se sabe o que traz.
    expect(
      (await closurePendencies(prisma, ctx.hotel.id)).map((p) => p.code)
    ).toEqual(["ITEMS_NOT_RECEIVED"]);
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    expect(
      (await closurePendencies(prisma, ctx.hotel.id)).map((p) => p.code)
    ).toEqual(["ITEMS_NOT_RECEIVED"]);
    await expect(
      transition(ctx.admin, ctx.hotel.id, "ENCERRAR")
    ).rejects.toMatchObject({ code: "items_not_received" });
    await confirmMiami(
      ctx.store.id,
      ctx.admin,
      {
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        pacoteExternoId: ctx.a.id
      },
      randomUUID()
    );
    expect(await closurePendencies(prisma, ctx.hotel.id)).toEqual([]);
    expect((await transition(ctx.admin, ctx.hotel.id, "ENCERRAR")).status).toBe(
      "ENCERRADA"
    );
  });
});

describe("auditoria PD: custo do lote de devolução e competência dos custos", () => {
  it("devolução mantém o custo congelado da venda original mesmo se o custo do item mudar", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const g = await createOperationalFixture(prisma, store.id);
    const stock = await prisma.estoque.create({
      data: { lojaId: store.id, produtoId: g.product.id, quantidadeFisica: 2 }
    });
    const lot = await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: store.id,
        produtoId: g.product.id,
        estoqueId: stock.id,
        pedidoCompraItemId: g.item.id,
        tipo: "ENTRY",
        motivo: "PURCHASE_RECEIPT",
        quantidade: 2,
        quantidadeAnterior: 0,
        quantidadePosterior: 2,
        responsavelId: g.admin.id
      }
    });
    cleanups.push(async () => {
      const ids = (
        await prisma.venda.findMany({
          where: { itens: { some: { produtoId: g.product.id } } },
          select: { id: true }
        })
      ).map((v) => v.id);
      await prisma.devolucaoVenda.deleteMany({
        where: { vendaId: { in: ids } }
      });
      await prisma.recebivelVenda.deleteMany({
        where: { vendaId: { in: ids } }
      });
      await prisma.movimentacaoEstoque.updateMany({
        where: { produtoId: g.product.id },
        data: { baixaOrigemId: null }
      });
      await prisma.baixaVenda.deleteMany({
        where: { item: { produtoId: g.product.id } }
      });
      await prisma.vendaItem.deleteMany({ where: { vendaId: { in: ids } } });
      await prisma.venda.deleteMany({ where: { id: { in: ids } } });
      await prisma.custoPedidoItem.deleteMany({
        where: { custo: { pedidoCompraId: g.order.id } }
      });
      await prisma.custoPedido.deleteMany({
        where: { pedidoCompraId: g.order.id }
      });
      await g.cleanup();
    });
    const app = createApp();
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
    const headers = {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": store.id
    };
    const post = (url: string, body: object) =>
      request(app)
        .post(url)
        .set(headers)
        .set("idempotency-key", randomUUID())
        .send(body);
    const draft = async () =>
      (
        await post("/sales", {
          canal: "OUTRO",
          dataVenda: new Date().toISOString(),
          moeda: "USD",
          itens: [
            { produtoId: g.product.id, quantidade: 1, precoUnitario: 150 }
          ]
        })
      ).body;
    const sale = await draft();
    const first = await post(`/sales/${sale.id}/confirm`, {
      lotes: [
        {
          vendaItemId: sale.itens[0].id,
          movimentoEntradaId: lot.id,
          quantidade: 1
        }
      ]
    });
    expect(first.body.itens[0].baixas[0].custoUnitario).toBe("50.00");
    const { setCosts } = await import("../src/modules/finance/finance.service");
    await setCosts(
      store.id,
      g.admin.id,
      g.order.id,
      { iofPercentual: 0, taxas: 100, custoAdicional: 0 },
      randomUUID()
    );
    const ret = await post(`/sales/${sale.id}/returns`, {
      vendaItemId: sale.itens[0].id,
      quantidade: 1,
      motivo: "Custo original"
    });
    expect(
      (
        await post(`/sales/returns/${ret.body.id}/check`, {
          apta: true,
          condicaoComercial: "CAIXA_ABERTA",
          funcionamento: "FUNCIONAL"
        })
      ).status
    ).toBe(200);
    const returnLot = await prisma.movimentacaoEstoque.findFirstOrThrow({
      where: { produtoId: g.product.id, tipo: "RETURN_ENTRY" }
    });
    expect(returnLot.baixaOrigemId).not.toBeNull();
    const second = await draft();
    const sold = await post(`/sales/${second.id}/confirm`, {
      lotes: [
        {
          vendaItemId: second.itens[0].id,
          movimentoEntradaId: returnLot.id,
          quantidade: 1
        }
      ]
    });
    expect(sold.body.itens[0].baixas[0]).toMatchObject({
      custoUnitario: "50.00",
      custoUnitarioConvertido: "50.00"
    });

    // Encargo lançado em outubro para pedido de setembro aparece na competência de setembro.
    await prisma.pedidoCompra.update({
      where: { id: g.order.id },
      data: { dataCompra: new Date("2026-09-15T12:00:00Z") }
    });
    const { report } =
      await import("../src/modules/analytics/analytics.service");
    const found = async (from: string, to: string) =>
      (
        (await report(store.id, "costs", {
          from: new Date(from),
          to: new Date(to)
        })) as { pedidoCompraId: string }[]
      ).some((row) => row.pedidoCompraId === g.order.id);
    expect(await found("2026-09-01T03:00:00Z", "2026-10-01T02:59:59Z")).toBe(
      true
    );
    expect(await found("2026-10-01T03:00:00Z", "2026-11-01T02:59:59Z")).toBe(
      false
    );
  });
});
