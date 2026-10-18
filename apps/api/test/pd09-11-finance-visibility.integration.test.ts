import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

async function setup() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  cleanups.push(async () => {
    await prisma.pagamento.deleteMany({
      where: { pedidoCompraId: data.order.id, estornoDeId: { not: null } }
    });
    await prisma.pagamento.deleteMany({
      where: { pedidoCompraId: data.order.id }
    });
    await prisma.custoPedidoItem.deleteMany({
      where: { custo: { pedidoCompraId: data.order.id } }
    });
    await prisma.custoPedido.deleteMany({
      where: { pedidoCompraId: data.order.id }
    });
    await prisma.cotacaoCambio.deleteMany({ where: { fonte: "PD-09" } });
    await data.cleanup();
  });
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    data,
    headers: {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": store.id
    }
  };
}

describe("PD-09 a PD-11", () => {
  it("PD-09: cotação antiga ou substituída gera aviso sem bloquear", async () => {
    const { app, data, headers } = await setup();
    const quote = (cotadoEm: string) =>
      request(app)
        .post("/finance/exchange-rates")
        .set(headers)
        .send({
          moedaOrigem: "USD",
          moedaDestino: "BRL",
          valorMercado: 5,
          margem: 0,
          fonte: "PD-09",
          cotadoEm
        });
    const old = await quote(
      new Date(Date.now() - 10 * 86_400_000).toISOString()
    );
    const costs = (cotacaoCambioId: string) =>
      request(app)
        .put(`/finance/orders/${data.order.id}/costs`)
        .set(headers)
        .send({
          cotacaoCambioId,
          iofPercentual: 0,
          taxas: 0,
          custoAdicional: 0
        });
    const withOld = await costs(old.body.id);
    expect(withOld.status).toBe(200);
    expect(withOld.body.avisoCotacao).toBe("COTACAO_ANTIGA");
    const fresh = await quote(new Date().toISOString());
    expect((await costs(old.body.id)).body.avisoCotacao).toBe(
      "COTACAO_SUBSTITUIDA"
    );
    expect((await costs(fresh.body.id)).body.avisoCotacao).toBeNull();
    const list = await request(app)
      .get("/finance/exchange-rates")
      .query({ moedaOrigem: "USD", moedaDestino: "BRL" })
      .set(headers);
    const mine = list.body.filter(
      (q: { fonte: string }) => q.fonte === "PD-09"
    );
    expect(mine.map((q: { vigente: boolean }) => q.vigente)).toEqual([
      true,
      false
    ]);
  });

  it("PD-10: estornos e cancelados saem da lista ativa, mas os totais mostram tudo", async () => {
    const { app, data, headers } = await setup();
    const pay = await request(app)
      .post("/finance/payments")
      .set(headers)
      .send({
        pedidoCompraId: data.order.id,
        formaPagamento: "PAYPAL",
        moeda: "USD",
        valor: 100
      });
    await request(app)
      .post(`/finance/payments/${pay.body.id}/refund`)
      .set(headers)
      .send({ valor: 30 });
    const active = (await request(app).get("/finance/payments").set(headers))
      .body;
    const mine = (items: { pedidoCompraId: string }[]) =>
      items.filter((p) => p.pedidoCompraId === data.order.id);
    expect(mine(active.items)).toHaveLength(1);
    const all = (
      await request(app)
        .get("/finance/payments")
        .query({ incluirCancelados: "true" })
        .set(headers)
    ).body;
    expect(mine(all.items)).toHaveLength(2);
    const usd = active.totais.find((t: { moeda: string }) => t.moeda === "USD");
    expect(Number(usd.bruto) - Number(usd.reembolsado)).toBe(
      Number(usd.liquido)
    );
    await prisma.pedidoCompra.update({
      where: { id: data.order.id },
      data: { status: "CANCELLED" }
    });
    const orders = async (q: object) =>
      (
        await request(app)
          .get("/purchase-orders")
          .query({ numero: data.order.numeroPedido, ...q })
          .set(headers)
      ).body.items;
    expect(await orders({})).toHaveLength(0);
    expect(await orders({ incluirCancelados: "true" })).toHaveLength(1);
  });

  it("PD-11: encargo lançado após a competência fica no mês do pedido, marcado", async () => {
    const { app, data, headers } = await setup();
    await prisma.pedidoCompra.update({
      where: { id: data.order.id },
      data: { dataCompra: new Date("2026-08-10T15:00:00Z") }
    });
    await request(app)
      .put(`/finance/orders/${data.order.id}/costs`)
      .set(headers)
      .send({ iofPercentual: 0, taxas: 5, custoAdicional: 0 });
    const report = (
      await request(app).get("/analytics/reports/costs").set(headers)
    ).body;
    const row = report.find(
      (r: { pedidoCompraId: string }) => r.pedidoCompraId === data.order.id
    );
    expect(row).toMatchObject({
      competencia: "2026-08",
      lancadoAposCompetencia: true
    });
  });
});
