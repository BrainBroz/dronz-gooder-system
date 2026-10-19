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

describe("auditoria PD (completo): recebimento por pacote — bordas", () => {
  it("retry idempotente, concorrência no saldo, loja/compra alheias, posição encerrada e nenhum estoque antes da entrada definitiva", async () => {
    const ctx = await packages();
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    expect((await ctx.content(ctx.b.id, 1)).status).toBe(200);
    const body = (
      pacoteExternoId: string,
      extra: Record<string, unknown> = {}
    ) => ({
      pedidoCompraItemId: ctx.data.item.id,
      quantidadeRecebida: 1,
      recebidoEm: new Date("2026-10-18T12:00:00Z"),
      pacoteExternoId,
      ...extra
    });
    // Retry com a mesma chave devolve o mesmo recebimento, sem duplicar.
    const key = randomUUID();
    const first = await confirmMiami(
      ctx.store.id,
      ctx.admin,
      body(ctx.a.id),
      key
    );
    const replay = await confirmMiami(
      ctx.store.id,
      ctx.admin,
      body(ctx.a.id),
      key
    );
    expect(replay.id).toBe(first.id);
    expect(
      await prisma.recebimentoMiami.count({
        where: { pacoteExternoId: ctx.a.id }
      })
    ).toBe(1);
    // Concorrência: dois recebimentos simultâneos disputam o saldo 1 do pacote B.
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        confirmMiami(ctx.store.id, ctx.admin, body(ctx.b.id), randomUUID())
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.recebimentoMiami.count({
        where: { pacoteExternoId: ctx.b.id }
      })
    ).toBe(1);
    // Recebimento em Miami não cria estoque antes da entrada definitiva.
    expect(
      await prisma.estoque.count({ where: { produtoId: ctx.data.product.id } })
    ).toBe(0);
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: ctx.data.product.id }
      })
    ).toBe(0);
  });

  it("pacote de outra compra, item de outra loja e posição encerrada são recusados", async () => {
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
    const other = await prisma.compraImportada.create({
      data: {
        numeroPedido: `AUD-OTHER-${randomUUID()}`,
        quantidade: 1,
        plataforma: "MANUAL",
        dataPedido: new Date()
      }
    });
    const otherShipment = await prisma.envioExterno.create({
      data: {
        compraImportadaId: other.id,
        externalShipmentId: "OTHER",
        ultimaAtualizacaoEm: new Date()
      }
    });
    const foreign = await prisma.pacoteExterno.create({
      data: { envioExternoId: otherShipment.id, externalPackageId: "X" }
    });
    cleanups.push(async () => {
      await prisma.pacoteExterno.delete({ where: { id: foreign.id } });
      await prisma.envioExterno.delete({ where: { id: otherShipment.id } });
      await prisma.compraImportada.delete({ where: { id: other.id } });
    });
    const receive = (lojaId: string, pacoteExternoId: string) =>
      confirmMiami(
        lojaId,
        ctx.admin,
        {
          pedidoCompraItemId: ctx.data.item.id,
          quantidadeRecebida: 1,
          recebidoEm: new Date(),
          pacoteExternoId
        },
        randomUUID()
      );
    await expect(receive(ctx.store.id, foreign.id)).rejects.toMatchObject({
      code: "package_item_not_declared"
    });
    const gooder = await prisma.loja.findUniqueOrThrow({
      where: { slug: "gooder" }
    });
    await expect(receive(gooder.id, ctx.a.id)).rejects.toMatchObject({
      code: "conflict"
    });
    await prisma.posicaoOperacional.update({
      where: { id: ctx.hotel.id },
      data: { status: "ENCERRADA", encerradaEm: new Date() }
    });
    await expect(receive(ctx.store.id, ctx.a.id)).rejects.toMatchObject({
      code: "position_closed"
    });
    expect(
      await prisma.recebimentoMiami.count({
        where: { pedidoCompraItemId: ctx.data.item.id }
      })
    ).toBe(0);
  });
});

describe("auditoria PD (completo): encerramento — bordas e concorrência", () => {
  it("recebimento parcial ainda bloqueia e não há dupla contagem quando pedido e pacote apontam para a mesma posição", async () => {
    const ctx = await packages();
    const { closurePendencies } =
      await import("../src/modules/positions/positions.service");
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { destinoPosicaoId: ctx.hotel.id }
    });
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    const pending = async () => closurePendencies(prisma, ctx.hotel.id);
    expect(await pending()).toEqual([
      {
        code: "ITEMS_NOT_RECEIVED",
        message: "1 item(ns) destinados ainda não recebidos."
      }
    ]);
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
    expect((await pending()).map((p) => p.code)).toEqual([
      "ITEMS_NOT_RECEIVED"
    ]);
  });

  it("redirecionar para posição já encerrada é recusado; corrida entre encerrar e redirecionar nunca deixa posição encerrada com pendência", async () => {
    const ctx = await packages();
    const { closurePendencies, transition } =
      await import("../src/modules/positions/positions.service");
    const { setPackageDestination } =
      await import("../src/modules/purchase-orders/tracking.service");
    expect((await transition(ctx.admin, ctx.hotel.id, "ENCERRAR")).status).toBe(
      "ENCERRADA"
    );
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Tarde"
        })
      ).body.error
    ).toBe("position_closed");
    const base = await prisma.posicaoOperacional.findUniqueOrThrow({
      where: { id: "posicao-miami-base" }
    });
    for (let round = 0; round < 5; round++) {
      const hotel = await prisma.posicaoOperacional.create({
        data: {
          localId: base.localId,
          codigo: `AUD-RACE-${randomUUID()}`,
          nome: "Hotel corrida",
          tipo: "TEMPORARIA",
          status: "ATIVA",
          inicioEm: new Date(Date.now() - 86_400_000),
          fimEm: new Date(Date.now() + 86_400_000)
        }
      });
      await prisma.pacoteExterno.update({
        where: { id: ctx.a.id },
        data: { destinoPosicaoId: null }
      });
      await Promise.allSettled([
        transition(ctx.admin, hotel.id, "ENCERRAR"),
        setPackageDestination(
          ctx.store.id,
          ctx.data.admin.id,
          ctx.data.order.id,
          ctx.a.id,
          {
            posicaoId: hotel.id,
            motivo: "Corrida"
          }
        )
      ]);
      const after = await prisma.posicaoOperacional.findUniqueOrThrow({
        where: { id: hotel.id }
      });
      const redirected =
        (
          await prisma.pacoteExterno.findUniqueOrThrow({
            where: { id: ctx.a.id }
          })
        ).destinoPosicaoId === hotel.id;
      // Invariante: nunca encerrada E com pacote destinado pendente.
      expect(after.status === "ENCERRADA" && redirected).toBe(false);
      if (redirected)
        expect(
          (await closurePendencies(prisma, hotel.id)).length
        ).toBeGreaterThan(0);
      await prisma.pacoteExterno.update({
        where: { id: ctx.a.id },
        data: { destinoPosicaoId: null }
      });
      await prisma.posicaoOperacional.delete({ where: { id: hotel.id } });
    }
  });
});

describe("auditoria PD (completo): custo da devolução — bordas", () => {
  it("devolução parcial de venda com lotes de custos diferentes preserva cada custo; custo desconhecido continua desconhecido; replay e rollback", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const g = await createOperationalFixture(prisma, store.id);
    const stock = await prisma.estoque.create({
      data: { lojaId: store.id, produtoId: g.product.id, quantidadeFisica: 2 }
    });
    const known = await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: store.id,
        produtoId: g.product.id,
        estoqueId: stock.id,
        pedidoCompraItemId: g.item.id,
        tipo: "ENTRY",
        motivo: "PURCHASE_RECEIPT",
        quantidade: 1,
        quantidadeAnterior: 0,
        quantidadePosterior: 1,
        responsavelId: g.admin.id,
        createdAt: new Date(Date.now() - 60_000)
      }
    });
    const unknown = await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: store.id,
        produtoId: g.product.id,
        estoqueId: stock.id,
        tipo: "ADJUSTMENT_POSITIVE",
        motivo: "MANUAL_CORRECTION",
        quantidade: 1,
        quantidadeAnterior: 1,
        quantidadePosterior: 2,
        responsavelId: g.admin.id,
        observacoes: "Lote legado sem custo",
        createdAt: new Date(Date.now() - 30_000)
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
    const post = (url: string, body: object, key = randomUUID()) =>
      request(app)
        .post(url)
        .set(headers)
        .set("idempotency-key", key)
        .send(body);
    const sale = (
      await post("/sales", {
        canal: "OUTRO",
        dataVenda: new Date().toISOString(),
        moeda: "USD",
        itens: [{ produtoId: g.product.id, quantidade: 2, precoUnitario: 150 }]
      })
    ).body;
    const confirmed = await post(`/sales/${sale.id}/confirm`, {
      lotes: [
        {
          vendaItemId: sale.itens[0].id,
          movimentoEntradaId: known.id,
          quantidade: 1
        },
        {
          vendaItemId: sale.itens[0].id,
          movimentoEntradaId: unknown.id,
          quantidade: 1
        }
      ]
    });
    expect(confirmed.status).toBe(200);
    const originalBaixas = await prisma.baixaVenda.findMany({
      where: { vendaItemId: sale.itens[0].id },
      orderBy: { createdAt: "asc" }
    });
    const { setCosts } = await import("../src/modules/finance/finance.service");
    await setCosts(
      store.id,
      g.admin.id,
      g.order.id,
      { iofPercentual: 0, taxas: 100, custoAdicional: 0 },
      randomUUID()
    );
    // Devolução parcial (1 de 2): rollback por falha de auditoria não deixa lote nem estoque.
    const ret = (
      await post(`/sales/${sale.id}/returns`, {
        vendaItemId: sale.itens[0].id,
        quantidade: 1,
        motivo: "Parcial"
      })
    ).body;
    const { setAuditFailureForTests } =
      await import("../src/modules/operations/operations.persistence");
    setAuditFailureForTests((input) => input.action === "CHECK_SALE_RETURN");
    try {
      expect(
        (
          await post(`/sales/returns/${ret.id}/check`, {
            apta: true,
            condicaoComercial: "NOVO",
            funcionamento: "FUNCIONAL"
          })
        ).status
      ).toBe(500);
    } finally {
      setAuditFailureForTests();
    }
    expect(
      await prisma.movimentacaoEstoque.count({
        where: { produtoId: g.product.id, tipo: "RETURN_ENTRY" }
      })
    ).toBe(0);
    expect(
      (await prisma.estoque.findUniqueOrThrow({ where: { id: stock.id } }))
        .quantidadeFisica
    ).toBe(0);
    // Replay com a mesma chave não duplica o lote.
    const checkKey = randomUUID();
    const checkBody = {
      apta: true,
      condicaoComercial: "NOVO",
      funcionamento: "FUNCIONAL"
    };
    expect(
      (await post(`/sales/returns/${ret.id}/check`, checkBody, checkKey)).status
    ).toBe(200);
    expect(
      (await post(`/sales/returns/${ret.id}/check`, checkBody, checkKey)).status
    ).toBe(200);
    // Segunda devolução, do outro lote.
    const ret2 = (
      await post(`/sales/${sale.id}/returns`, {
        vendaItemId: sale.itens[0].id,
        quantidade: 1,
        motivo: "Restante"
      })
    ).body;
    expect(
      (await post(`/sales/returns/${ret2.id}/check`, checkBody)).status
    ).toBe(200);
    const returnLots = await prisma.movimentacaoEstoque.findMany({
      where: { produtoId: g.product.id, tipo: "RETURN_ENTRY" },
      include: { baixaOrigem: true }
    });
    expect(returnLots).toHaveLength(2);
    // Cada lote de devolução aponta para uma baixa distinta, com seu custo congelado (50 e desconhecido).
    expect(new Set(returnLots.map((l) => l.baixaOrigemId)).size).toBe(2);
    expect(
      returnLots
        .map((l) => l.baixaOrigem!.custoUnitario?.toFixed(2) ?? null)
        .sort()
    ).toEqual(["50.00", null].sort());
    // Venda original intacta.
    expect(
      await prisma.baixaVenda.findMany({
        where: { vendaItemId: sale.itens[0].id },
        orderBy: { createdAt: "asc" }
      })
    ).toEqual(originalBaixas);
    // Revenda dos dois lotes de devolução: 50 preservado e desconhecido não inventado.
    const resale = (
      await post("/sales", {
        canal: "OUTRO",
        dataVenda: new Date().toISOString(),
        moeda: "USD",
        itens: [{ produtoId: g.product.id, quantidade: 2, precoUnitario: 150 }]
      })
    ).body;
    const sold = await post(`/sales/${resale.id}/confirm`, {
      lotes: returnLots.map((l) => ({
        vendaItemId: resale.itens[0].id,
        movimentoEntradaId: l.id,
        quantidade: 1
      }))
    });
    expect(sold.status).toBe(200);
    expect(
      sold.body.itens[0].baixas
        .map((b: { custoUnitario: string | null }) => b.custoUnitario)
        .sort()
    ).toEqual(["50.00", null].sort());
    expect(sold.body.lucro).toBeNull();
  });
});

describe("auditoria PD (completo): competência dos custos", () => {
  it("competência usa o mês de São Paulo com fim exclusivo e isola lojas (restrição financeira: analytics-indicators)", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const sept = await createOperationalFixture(prisma, store.id);
    const oct = await createOperationalFixture(prisma, store.id);
    cleanups.push(async () => {
      for (const f of [sept, oct]) {
        await prisma.custoPedidoItem.deleteMany({
          where: { custo: { pedidoCompraId: f.order.id } }
        });
        await prisma.custoPedido.deleteMany({
          where: { pedidoCompraId: f.order.id }
        });
        await f.cleanup();
      }
    });
    // 30/09 23:59 em São Paulo e 01/10 00:00 em São Paulo.
    await prisma.pedidoCompra.update({
      where: { id: sept.order.id },
      data: { dataCompra: new Date("2026-10-01T02:59:00Z") }
    });
    await prisma.pedidoCompra.update({
      where: { id: oct.order.id },
      data: { dataCompra: new Date("2026-10-01T03:00:00Z") }
    });
    const { setCosts } = await import("../src/modules/finance/finance.service");
    for (const f of [sept, oct])
      await setCosts(
        store.id,
        f.admin.id,
        f.order.id,
        { iofPercentual: 0, taxas: 5, custoAdicional: 0 },
        randomUUID()
      );
    const app = createApp();
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
    const stores = login.body.stores as { id: string; slug: string }[];
    const h = (slug: string) => ({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": stores.find((s) => s.slug === slug)!.id
    });
    const ids = async (competencia: string, slug = "dronz") =>
      (
        (
          await request(app)
            .get("/analytics/reports/costs")
            .query({ competencia })
            .set(h(slug))
        ).body as { pedidoCompraId: string; competencia: string }[]
      )
        .filter((r) => [sept.order.id, oct.order.id].includes(r.pedidoCompraId))
        .map((r) => [
          r.pedidoCompraId === sept.order.id ? "sept" : "oct",
          r.competencia
        ]);
    expect(await ids("2026-09")).toEqual([["sept", "2026-09"]]);
    expect(await ids("2026-10")).toEqual([["oct", "2026-10"]]);
    expect(await ids("2026-09", "gooder")).toEqual([]);
    expect(
      (
        await request(app)
          .get("/analytics/reports/costs")
          .query({ competencia: "2026-13" })
          .set(h("dronz"))
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/analytics/reports/payments")
          .query({ competencia: "2026-09" })
          .set(h("dronz"))
      ).status
    ).toBe(400);
  });
});

describe("revisão local do Codex (5b1be86): achados corrigidos", () => {
  it("P1: recebimento antigo sem pacote não faz o item voltar a pendente", async () => {
    const ctx = await packages();
    const { pendingAt } = await import("../src/modules/positions/expectations");
    const { closurePendencies } =
      await import("../src/modules/positions/positions.service");
    const { expectationSelect } =
      await import("../src/modules/positions/expectations");
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    // Dados anteriores à correção: recebimentos na base, sem vínculo com o pacote.
    await prisma.recebimentoMiami.createMany({
      data: [1, 2].map(() => ({
        lojaId: ctx.store.id,
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        confirmadoPorId: ctx.data.admin.id,
        posicaoId: ctx.base.id
      }))
    });
    const item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: ctx.data.item.id },
      select: expectationSelect
    });
    expect(pendingAt(item, ctx.base.id)).toBe(0);
    // Mesmo com o pacote redirecionado depois, o item já foi todo recebido: hotel sem pendência.
    await prisma.pacoteExterno.update({
      where: { id: ctx.a.id },
      data: { destinoPosicaoId: ctx.hotel.id }
    });
    expect(await closurePendencies(prisma, ctx.hotel.id)).toEqual([]);
  });

  it("P1: recebimento antigo parcial deixa só o que falta", async () => {
    const ctx = await packages();
    const { pendingAt, expectationSelect } =
      await import("../src/modules/positions/expectations");
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    await prisma.recebimentoMiami.create({
      data: {
        lojaId: ctx.store.id,
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        confirmadoPorId: ctx.data.admin.id,
        posicaoId: ctx.base.id
      }
    });
    const item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: ctx.data.item.id },
      select: expectationSelect
    });
    expect(pendingAt(item, ctx.hotel.id)).toBe(1);
  });

  it("P1 (2): reduzir conteúdo não devolve saldo a destino de pedido já encerrado", async () => {
    const ctx = await packages();
    const { transition } =
      await import("../src/modules/positions/positions.service");
    const base = ctx.base;
    const orderDest = await prisma.posicaoOperacional.create({
      data: {
        localId: base.localId,
        codigo: `AUD-ORD-${randomUUID()}`,
        nome: "Destino do pedido",
        tipo: "TEMPORARIA",
        status: "ATIVA",
        inicioEm: new Date(Date.now() - 86_400_000),
        fimEm: new Date(Date.now() + 86_400_000)
      }
    });
    cleanups.push(async () => {
      await prisma.pedidoCompra.update({
        where: { id: ctx.data.order.id },
        data: { destinoPosicaoId: base.id }
      });
      await prisma.posicaoOperacional.delete({ where: { id: orderDest.id } });
    });
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { destinoPosicaoId: orderDest.id }
    });
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    // Todas as unidades vão para o hotel: o destino do pedido pode encerrar.
    expect((await transition(ctx.admin, orderDest.id, "ENCERRAR")).status).toBe(
      "ENCERRADA"
    );
    expect((await ctx.content(ctx.a.id, 1)).body.error).toBe("position_closed");
    expect((await ctx.content(ctx.a.id, 0)).body.error).toBe("position_closed");
    expect(await assigned(ctx.data.item.id)).toBe(2);
  });

  it("P2: lote de devolução de custo desconhecido segue sem custo e não pode ser religado", async () => {
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const g = await createOperationalFixture(prisma, store.id);
    const stock = await prisma.estoque.create({
      data: { lojaId: store.id, produtoId: g.product.id, quantidadeFisica: 1 }
    });
    const unknown = await prisma.movimentacaoEstoque.create({
      data: {
        lojaId: store.id,
        produtoId: g.product.id,
        estoqueId: stock.id,
        tipo: "ADJUSTMENT_POSITIVE",
        motivo: "MANUAL_CORRECTION",
        quantidade: 1,
        quantidadeAnterior: 0,
        quantidadePosterior: 1,
        responsavelId: g.admin.id,
        observacoes: "Lote legado sem custo"
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
    const sale = (
      await post("/sales", {
        canal: "OUTRO",
        dataVenda: new Date().toISOString(),
        moeda: "USD",
        itens: [{ produtoId: g.product.id, quantidade: 1, precoUnitario: 150 }]
      })
    ).body;
    expect(
      (
        await post(`/sales/${sale.id}/confirm`, {
          lotes: [
            {
              vendaItemId: sale.itens[0].id,
              movimentoEntradaId: unknown.id,
              quantidade: 1
            }
          ]
        })
      ).status
    ).toBe(200);
    const ret = (
      await post(`/sales/${sale.id}/returns`, {
        vendaItemId: sale.itens[0].id,
        quantidade: 1,
        motivo: "Sem custo"
      })
    ).body;
    expect(
      (
        await post(`/sales/returns/${ret.id}/check`, {
          apta: true,
          condicaoComercial: "NOVO",
          funcionamento: "FUNCIONAL"
        })
      ).status
    ).toBe(200);
    const returnLot = await prisma.movimentacaoEstoque.findFirstOrThrow({
      where: { produtoId: g.product.id, tipo: "RETURN_ENTRY" }
    });
    const diagnosis = (
      await request(app).get(`/inventory/lots/${g.product.id}`).set(headers)
    ).body;
    expect(
      diagnosis.lotes.find(
        (l: { movimentoEntradaId: string }) =>
          l.movimentoEntradaId === returnLot.id
      )
    ).toMatchObject({ custoConhecido: false });
    const link = await post(
      `/inventory/lots/entries/${returnLot.id}/purchase-item`,
      { pedidoCompraItemId: g.item.id, motivo: "Tentar religar" }
    );
    expect(link.body.error).toBe("lot_cost_frozen");
    const again = (
      await post("/sales", {
        canal: "OUTRO",
        dataVenda: new Date().toISOString(),
        moeda: "USD",
        itens: [{ produtoId: g.product.id, quantidade: 1, precoUnitario: 150 }]
      })
    ).body;
    const suggestion = (
      await request(app).get(`/sales/${again.id}/lot-suggestion`).set(headers)
    ).body;
    expect(suggestion.itens[0].lotes[0]).toMatchObject({
      movimentoEntradaId: returnLot.id,
      custoConhecido: false
    });
  });
});

describe("revisão local do Codex (24eb581): achados corrigidos", () => {
  it("P1: recebimento concorrente com edição de conteúdo não valida contra o conteúdo antigo", async () => {
    const ctx = await packages();
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    const { setPackageItems } =
      await import("../src/modules/purchase-orders/tracking.service");
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    // setPackageItems toca (UPDATE) a linha do item, não só trava.
    const before = (
      await prisma.pedidoCompraItem.findUniqueOrThrow({
        where: { id: ctx.data.item.id }
      })
    ).updatedAt;
    await setPackageItems(
      ctx.store.id,
      ctx.data.admin.id,
      ctx.data.order.id,
      ctx.a.id,
      {
        itens: [{ pedidoCompraItemId: ctx.data.item.id, quantidade: 1 }],
        motivo: "Toque"
      }
    );
    expect(
      (
        await prisma.pedidoCompraItem.findUniqueOrThrow({
          where: { id: ctx.data.item.id }
        })
      ).updatedAt > before
    ).toBe(true);
    await prisma.pacoteItem.deleteMany({
      where: { pedidoCompraItemId: ctx.data.item.id }
    });
    // Edição em andamento (mesmo efeito de setPackageItems): toca a linha do item e declara as 2 unidades.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const editor = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE "PedidoCompraItem" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${ctx.data.item.id}`;
        await tx.pacoteItem.create({
          data: {
            lojaId: ctx.store.id,
            pacoteExternoId: ctx.a.id,
            pedidoCompraItemId: ctx.data.item.id,
            quantidade: 2
          }
        });
        holding();
        await gate;
      },
      { timeout: 20_000 }
    );
    await held;
    // Pelo conteúdo antigo (nada em pacote), receber 1 unidade sem pacote na base seria válido.
    const receipt = confirmMiami(
      ctx.store.id,
      ctx.admin,
      {
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date()
      },
      randomUUID()
    ).then(
      () => "accepted",
      (error: { code?: string }) => error.code
    );
    for (let attempt = 0; attempt < 200; attempt++) {
      const [{ n }] = await prisma.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%PedidoCompraItem%UPDATE%'`;
      if (n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await editor;
    expect(await receipt).toBe("concurrent_modification");
    // Nova tentativa enxerga o conteúdo novo e exige o pacote.
    await expect(
      confirmMiami(
        ctx.store.id,
        ctx.admin,
        {
          pedidoCompraItemId: ctx.data.item.id,
          quantidadeRecebida: 1,
          recebidoEm: new Date()
        },
        randomUUID()
      )
    ).rejects.toMatchObject({ code: "package_receipt_required" });
    expect(
      await prisma.recebimentoMiami.count({
        where: { pedidoCompraItemId: ctx.data.item.id }
      })
    ).toBe(0);
  });

  it("P1: limpar destino de pacote compartilhado valida o destino do pedido de cada loja", async () => {
    const ctx = await packages();
    const { transition } =
      await import("../src/modules/positions/positions.service");
    const gooderStore = await prisma.loja.findUniqueOrThrow({
      where: { slug: "gooder" }
    });
    const gooder = await createOperationalFixture(prisma, gooderStore.id);
    const gooderHotel = await prisma.posicaoOperacional.create({
      data: {
        localId: ctx.base.localId,
        codigo: `AUD-G-${randomUUID()}`,
        nome: "Hotel Gooder",
        tipo: "TEMPORARIA",
        status: "ATIVA",
        inicioEm: new Date(Date.now() - 86_400_000),
        fimEm: new Date(Date.now() + 86_400_000)
      }
    });
    const purchaseId = (
      await prisma.pedidoCompra.findUniqueOrThrow({
        where: { id: ctx.data.order.id }
      })
    ).compraImportadaId!;
    await prisma.pedidoCompra.update({
      where: { id: gooder.order.id },
      data: { compraImportadaId: purchaseId, destinoPosicaoId: gooderHotel.id }
    });
    cleanups.push(async () => {
      await prisma.pacoteItem.deleteMany({
        where: { pedidoCompraItemId: gooder.item.id }
      });
      await prisma.pedidoCompra.update({
        where: { id: gooder.order.id },
        data: {
          compraImportadaId: null,
          destinoPosicaoId: "posicao-miami-base"
        }
      });
      await gooder.cleanup();
      await prisma.posicaoOperacional.delete({ where: { id: gooderHotel.id } });
    });
    // Pacote A vai para o hotel da Dronz com todas as unidades das duas lojas.
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    await prisma.pacoteItem.create({
      data: {
        lojaId: gooderStore.id,
        pacoteExternoId: ctx.a.id,
        pedidoCompraItemId: gooder.item.id,
        quantidade: 2
      }
    });
    // Nada mais é esperado no hotel da Gooder: ele encerra.
    expect(
      (await transition(ctx.admin, gooderHotel.id, "ENCERRAR")).status
    ).toBe("ENCERRADA");
    // Voltar ao padrão devolveria as unidades da Gooder ao hotel encerrado: recusado.
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: null,
          motivo: "Voltar ao padrão"
        })
      ).body.error
    ).toBe("position_closed");
    expect(
      (
        await prisma.pacoteExterno.findUniqueOrThrow({
          where: { id: ctx.a.id }
        })
      ).destinoPosicaoId
    ).toBe(ctx.hotel.id);
  });
});

describe("revisão local do Codex (bd5e978): achado corrigido", () => {
  it("P1: redução de conteúdo relê o destino do pedido sob trava e não devolve saldo a posição recém-encerrada", async () => {
    const ctx = await packages();
    const { transition } =
      await import("../src/modules/positions/positions.service");
    const { setPackageItems } =
      await import("../src/modules/purchase-orders/tracking.service");
    const newDest = await prisma.posicaoOperacional.create({
      data: {
        localId: ctx.base.localId,
        codigo: `AUD-C-${randomUUID()}`,
        nome: "Novo destino do pedido",
        tipo: "TEMPORARIA",
        status: "ATIVA",
        inicioEm: new Date(Date.now() - 86_400_000),
        fimEm: new Date(Date.now() + 86_400_000)
      }
    });
    cleanups.push(async () => {
      await prisma.pedidoCompra.update({
        where: { id: ctx.data.order.id },
        data: { destinoPosicaoId: ctx.base.id }
      });
      await prisma.posicaoOperacional.delete({ where: { id: newDest.id } });
    });
    // Todas as unidades num pacote destinado ao hotel.
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    // A edição começa e fica parada na trava do pacote (outra edição em curso segura o pacote).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const otherEdit = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PacoteExterno" WHERE id = ${ctx.a.id} FOR UPDATE`;
        holding();
        await gate;
      },
      { timeout: 20_000 }
    );
    await held;
    const edit = setPackageItems(
      ctx.store.id,
      ctx.data.admin.id,
      ctx.data.order.id,
      ctx.a.id,
      {
        itens: [{ pedidoCompraItemId: ctx.data.item.id, quantidade: 1 }],
        motivo: "Redução concorrente"
      }
    ).then(
      () => "accepted",
      (error: { code?: string }) => error.code
    );
    for (let attempt = 0; attempt < 200; attempt++) {
      const [{ n }] = await prisma.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%PacoteExterno%UPDATE%'`;
      if (n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Enquanto isso, o pedido é redirecionado (comando real) e o novo destino encerra: todas as unidades
    // estão no pacote do hotel, então nada é esperado lá.
    const { setDestination } =
      await import("../src/modules/purchase-orders/purchase-orders.service");
    await setDestination(
      ctx.store.id,
      ctx.data.admin.id,
      ctx.data.order.id,
      newDest.id
    );
    expect((await transition(ctx.admin, newDest.id, "ENCERRAR")).status).toBe(
      "ENCERRADA"
    );
    release();
    await otherEdit;
    // A edição relê o destino atual (encerrado) e recusa; o conteúdo continua com as 2 unidades.
    expect(await edit).toBe("position_closed");
    expect(await assigned(ctx.data.item.id)).toBe(2);
  });
});

describe("revisão local do Codex (0dea0d3): achados corrigidos", () => {
  it("P2: recebimento antigo de atribuição desconhecida não bloqueia o recebimento fora de pacote", async () => {
    const ctx = await packages();
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    // Recebimento anterior ao vínculo (era do pacote A, mas foi gravado sem pacote).
    await prisma.recebimentoMiami.create({
      data: {
        lojaId: ctx.store.id,
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        confirmadoPorId: ctx.data.admin.id,
        posicaoId: ctx.base.id
      }
    });
    await prisma.pedidoCompraItem.update({
      where: { id: ctx.data.item.id },
      data: { quantidadeRecebidaMiami: 1 }
    });
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { status: "PARTIALLY_RECEIVED_MIAMI" }
    });
    const receive = () =>
      confirmMiami(
        ctx.store.id,
        ctx.admin,
        {
          pedidoCompraItemId: ctx.data.item.id,
          quantidadeRecebida: 1,
          recebidoEm: new Date()
        },
        randomUUID()
      );
    const unpackaged = await receive();
    expect(unpackaged).toMatchObject({
      pacoteExternoId: null,
      atribuicaoPacoteConhecida: true
    });
    // Total do item atingido: nada mais entra, por nenhum caminho.
    await expect(receive()).rejects.toMatchObject({ code: "conflict" });
  });

  it("P2: recebimento e redirecionamento concorrentes não entram em impasse", async () => {
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    const { setDestination } =
      await import("../src/modules/purchase-orders/purchase-orders.service");
    for (let round = 0; round < 6; round++) {
      const ctx = await packages();
      const results = await Promise.allSettled([
        confirmMiami(
          ctx.store.id,
          ctx.admin,
          {
            pedidoCompraItemId: ctx.data.item.id,
            quantidadeRecebida: 1,
            recebidoEm: new Date()
          },
          randomUUID()
        ),
        setDestination(
          ctx.store.id,
          ctx.data.admin.id,
          ctx.data.order.id,
          ctx.hotel.id
        )
      ]);
      for (const result of results)
        if (result.status === "rejected")
          expect(
            (result.reason as { status?: number; code?: string }).status,
            String(result.reason)
          ).toBe(409);
      // Nunca os dois: recebido na base com o pedido já redirecionado ao hotel.
      const order = await prisma.pedidoCompra.findUniqueOrThrow({
        where: { id: ctx.data.order.id }
      });
      const receipts = await prisma.recebimentoMiami.findMany({
        where: { pedidoCompraItemId: ctx.data.item.id }
      });
      expect(
        receipts.every((r) => r.posicaoId === order.destinoPosicaoId)
      ).toBe(true);
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    }
  });
});

describe("revisão local do Codex (61a359f): achado corrigido", () => {
  it("P2: recebimento por pacote sobreposto às edições de conteúdo e de destino não entra em impasse", async () => {
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    const { setPackageItems, setPackageDestination } =
      await import("../src/modules/purchase-orders/tracking.service");
    for (const editor of ["items", "destination"] as const) {
      for (let round = 0; round < 3; round++) {
        const ctx = await packages();
        expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
        // Uma transação segura a linha do item: o recebimento pega o pedido e espera o item.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let holding!: () => void;
        const held = new Promise<void>((resolve) => (holding = resolve));
        const itemLock = prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "PedidoCompraItem" WHERE id = ${ctx.data.item.id} FOR UPDATE`;
            holding();
            await gate;
          },
          { timeout: 20_000 }
        );
        await held;
        const settle = <T>(p: Promise<T>) =>
          p.then(
            () => "ok",
            (error: { status?: number; code?: string; message?: string }) =>
              error.status === 409
                ? `409:${error.code}`
                : `ERRO:${error.message?.slice(0, 160)}`
          );
        const waiting = async (pattern: string, count: number) => {
          for (let attempt = 0; attempt < 200; attempt++) {
            const [{ n }] = await prisma.$queryRaw<
              { n: number }[]
            >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
            if (n >= count) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };
        const receipt = settle(
          confirmMiami(
            ctx.store.id,
            ctx.admin,
            {
              pedidoCompraItemId: ctx.data.item.id,
              quantidadeRecebida: 1,
              recebidoEm: new Date(),
              pacoteExternoId: ctx.a.id
            },
            randomUUID()
          )
        );
        await waiting("%PedidoCompraItem%UPDATE%", 1);
        // O editor pega o pacote e espera o pedido (que o recebimento segura).
        const edit = settle(
          editor === "items"
            ? setPackageItems(
                ctx.store.id,
                ctx.data.admin.id,
                ctx.data.order.id,
                ctx.a.id,
                {
                  itens: [
                    { pedidoCompraItemId: ctx.data.item.id, quantidade: 2 }
                  ],
                  motivo: "Sobreposição"
                }
              )
            : setPackageDestination(
                ctx.store.id,
                ctx.data.admin.id,
                ctx.data.order.id,
                ctx.a.id,
                {
                  posicaoId: ctx.hotel.id,
                  motivo: "Sobreposição"
                }
              )
        );
        await waiting('%"PedidoCompra"%UPDATE%', 1);
        // Liberado o item, o recebimento precisa do KEY SHARE no pacote que o editor segura.
        release();
        await itemLock;
        const outcomes = await Promise.all([edit, receipt]);
        // Nenhum erro de banco (impasse) vira 500: cada um conclui ou recusa com 409 de negócio/serialização.
        for (const outcome of outcomes)
          expect(outcome.startsWith("ERRO"), `${editor} ${outcome}`).toBe(
            false
          );
        for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
      }
    }
  });
});

describe("revisão local do Codex (3db5c4f): achado corrigido", () => {
  it("P2: recebimento e edição de item do pedido não entram em impasse (ordem pedido → item)", async () => {
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    const { updateItem } =
      await import("../src/modules/purchase-orders/purchase-orders.service");
    for (let round = 0; round < 3; round++) {
      const ctx = await packages();
      // Segura o pedido: o recebimento entra primeiro na fila; a edição do item vem depois.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const orderLock = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "PedidoCompra" WHERE id = ${ctx.data.order.id} FOR UPDATE`;
          holding();
          await gate;
        },
        { timeout: 20_000 }
      );
      await held;
      const settle = <T>(p: Promise<T>) =>
        p.then(
          () => "ok",
          (error: { status?: number; code?: string; message?: string }) =>
            error.status === 409
              ? `409:${error.code}`
              : `ERRO:${error.message?.slice(0, 160)}`
        );
      const waiting = async (count: number) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const [{ n }] = await prisma.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%PedidoCompra%'`;
          if (n >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const receipt = settle(
        confirmMiami(
          ctx.store.id,
          ctx.admin,
          {
            pedidoCompraItemId: ctx.data.item.id,
            quantidadeRecebida: 1,
            recebidoEm: new Date()
          },
          randomUUID()
        )
      );
      await waiting(1);
      const edit = settle(
        updateItem(ctx.store.id, ctx.data.order.id, ctx.data.item.id, {
          observacoes: "Edição concorrente"
        })
      );
      await waiting(2);
      release();
      await orderLock;
      const outcomes = await Promise.all([receipt, edit]);
      for (const outcome of outcomes)
        expect(outcome.startsWith("ERRO"), outcome).toBe(false);
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    }
  });
});

describe("revisão local do Codex (2658b1a): achado corrigido", () => {
  it("P2: aumentar quantidade ou incluir item não cria pendência em destino de pedido encerrado", async () => {
    const ctx = await packages();
    const { transition } =
      await import("../src/modules/positions/positions.service");
    const { updateItem, addItem } =
      await import("../src/modules/purchase-orders/purchase-orders.service");
    const orderDest = await prisma.posicaoOperacional.create({
      data: {
        localId: ctx.base.localId,
        codigo: `AUD-QTY-${randomUUID()}`,
        nome: "Destino do pedido",
        tipo: "TEMPORARIA",
        status: "ATIVA",
        inicioEm: new Date(Date.now() - 86_400_000),
        fimEm: new Date(Date.now() + 86_400_000)
      }
    });
    cleanups.push(async () => {
      await prisma.pedidoCompra.update({
        where: { id: ctx.data.order.id },
        data: { destinoPosicaoId: ctx.base.id }
      });
      await prisma.posicaoOperacional.delete({ where: { id: orderDest.id } });
    });
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { destinoPosicaoId: orderDest.id }
    });
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 2)).status).toBe(200);
    expect((await transition(ctx.admin, orderDest.id, "ENCERRAR")).status).toBe(
      "ENCERRADA"
    );
    await expect(
      updateItem(ctx.store.id, ctx.data.order.id, ctx.data.item.id, {
        quantidade: 3
      })
    ).rejects.toMatchObject({
      code: "position_closed"
    });
    // Reduzir não cria pendência: continua permitido pela regra existente.
    await expect(
      updateItem(ctx.store.id, ctx.data.order.id, ctx.data.item.id, {
        observacoes: "Só observação"
      })
    ).resolves.toBeTruthy();
    const otherProduct = await prisma.produto.create({
      data: {
        lojaId: ctx.store.id,
        categoriaId: ctx.data.category.id,
        codigo: 9_000_000 + Math.floor(Math.random() * 900_000),
        nome: `Produto extra ${randomUUID()}`,
        slug: `extra-${randomUUID()}`,
        precoVenda: 10,
        markup: 25
      }
    });
    cleanups.push(() =>
      prisma.produto.delete({ where: { id: otherProduct.id } })
    );
    await expect(
      addItem(ctx.store.id, ctx.data.order.id, {
        produtoId: otherProduct.id,
        quantidade: 1,
        precoUnitario: 10,
        descontoItem: 0
      })
    ).rejects.toMatchObject({ code: "position_closed" });
    expect(
      (
        await prisma.pedidoCompraItem.findUniqueOrThrow({
          where: { id: ctx.data.item.id }
        })
      ).quantidade
    ).toBe(2);
  });
});

describe("revisão local do Codex (332f28c): achado corrigido", () => {
  it("P2: com recebimento antigo e destino dividido, a posição do pedido não encerra enquanto houver saldo recebível", async () => {
    const ctx = await packages();
    const { closurePendencies, transition } =
      await import("../src/modules/positions/positions.service");
    const { pendingAt, receivableSummary, expectationSelect } =
      await import("../src/modules/positions/expectations");
    const { confirmMiami } =
      await import("../src/modules/logistics/logistics.service");
    const orderDest = await prisma.posicaoOperacional.create({
      data: {
        localId: ctx.base.localId,
        codigo: `AUD-SPLIT-${randomUUID()}`,
        nome: "Destino do pedido",
        tipo: "TEMPORARIA",
        status: "ATIVA",
        inicioEm: new Date(Date.now() - 86_400_000),
        fimEm: new Date(Date.now() + 86_400_000)
      }
    });
    cleanups.push(async () => {
      await prisma.recebimentoMiami.deleteMany({
        where: { pedidoCompraItemId: ctx.data.item.id }
      });
      await prisma.pedidoCompra.update({
        where: { id: ctx.data.order.id },
        data: { destinoPosicaoId: ctx.base.id }
      });
      await prisma.posicaoOperacional.delete({ where: { id: orderDest.id } });
    });
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { destinoPosicaoId: orderDest.id }
    });
    expect(
      (
        await ctx.put(ctx.a.id, "destination", {
          posicaoId: ctx.hotel.id,
          motivo: "Hotel"
        })
      ).status
    ).toBe(200);
    expect((await ctx.content(ctx.a.id, 1)).status).toBe(200);
    // Recebimento antigo no destino do pedido, atribuição desconhecida.
    await prisma.recebimentoMiami.create({
      data: {
        lojaId: ctx.store.id,
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        confirmadoPorId: ctx.data.admin.id,
        posicaoId: orderDest.id
      }
    });
    await prisma.pedidoCompraItem.update({
      where: { id: ctx.data.item.id },
      data: { quantidadeRecebidaMiami: 1 }
    });
    await prisma.pedidoCompra.update({
      where: { id: ctx.data.order.id },
      data: { status: "PARTIALLY_RECEIVED_MIAMI" }
    });
    const item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: ctx.data.item.id },
      select: expectationSelect
    });
    // Pendência coerente com o saldo recebível fora de pacote.
    expect(receivableSummary(item).saldoSemPacote).toBe(1);
    expect(pendingAt(item, orderDest.id)).toBe(1);
    expect(
      (await closurePendencies(prisma, orderDest.id)).map((p) => p.code)
    ).toEqual(["ITEMS_NOT_RECEIVED"]);
    await expect(
      transition(ctx.admin, orderDest.id, "ENCERRAR")
    ).rejects.toMatchObject({ code: "items_not_received" });
    // Recebida a unidade (fora de pacote), nada mais falta em lugar nenhum.
    await confirmMiami(
      ctx.store.id,
      ctx.admin,
      {
        pedidoCompraItemId: ctx.data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date()
      },
      randomUUID()
    );
    expect(await closurePendencies(prisma, orderDest.id)).toEqual([]);
    expect(await closurePendencies(prisma, ctx.hotel.id)).toEqual([]);
  });
});
