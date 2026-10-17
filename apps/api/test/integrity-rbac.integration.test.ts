import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
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

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
type Fixture = Awaited<ReturnType<typeof createOperationalFixture>>;
const fixtures: Fixture[] = [];
const users: string[] = [];
const profiles: string[] = [];

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await prisma.pagamento.deleteMany({
      where: { pedidoCompraId: fixture.order.id }
    });
    await fixture.cleanup();
  }
  for (const id of users.splice(0)) {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }
  for (const id of profiles.splice(0)) {
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: id } });
    await prisma.perfil.deleteMany({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

const dronz = () => prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });

async function fixture() {
  const data = await createOperationalFixture(prisma, (await dronz()).id);
  fixtures.push(data);
  return data;
}

// Usuário vinculado à Dronz com um perfil; `codes` cria um perfil descartável com essas permissões.
async function userWith(profile: { code: string } | { codes: string[] }) {
  const store = await dronz();
  let perfilId: string;
  if ("code" in profile) {
    perfilId = (
      await prisma.perfil.findUniqueOrThrow({ where: { code: profile.code } })
    ).id;
  } else {
    const created = await prisma.perfil.create({
      data: { code: `TEST_${randomUUID()}`, name: "test" }
    });
    profiles.push(created.id);
    perfilId = created.id;
    for (const code of profile.codes) {
      const permission = await prisma.permissao.findUniqueOrThrow({
        where: { code }
      });
      await prisma.perfilPermissao.create({
        data: { perfilId, permissaoId: permission.id }
      });
    }
  }
  const email = `integrity-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "Integrity",
      email,
      passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: store.id } },
      perfis: { create: { perfilId } }
    }
  });
  users.push(user.id);
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  const headers = {
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": store.id
  };
  return { app, headers, store, user };
}

const settledOk = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((result) => result.status === "fulfilled").length;

describe("integridade transacional sob concorrência real (chamadas paralelas ao serviço)", () => {
  it("alocação em mala nunca excede o recebido em Miami", async () => {
    const data = await fixture();
    const { allocate } =
      await import("../src/modules/logistics/logistics.service");
    await prisma.alocacaoMala.deleteMany({
      where: { pedidoCompraItemId: data.item.id }
    });
    await prisma.pedidoCompraItem.update({
      where: { id: data.item.id },
      data: { quantidadeRecebidaMiami: 1 }
    });
    const volumes = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        prisma.volumeLogistico.create({
          data: {
            lojaId: data.order.lojaId,
            malaId: data.bag.id,
            codigo: `RACE-${n}-${data.item.id}`,
            taraKg: 0
          }
        })
      )
    );
    await Promise.allSettled(
      volumes.map((volume) =>
        allocate(data.order.lojaId, {
          pedidoCompraItemId: data.item.id,
          malaId: data.bag.id,
          volumeLogisticoId: volume.id,
          quantidade: 1
        })
      )
    );
    const total = await prisma.alocacaoMala.aggregate({
      where: { pedidoCompraItemId: data.item.id },
      _sum: { quantidade: true }
    });
    expect(total._sum.quantidade).toBe(1);
  });

  it("saídas concorrentes de estoque respeitam o saldo e o razão de movimentos fecha com o saldo", async () => {
    const data = await fixture();
    const { move } = await import("../src/modules/inventory/inventory.service");
    const stock = await prisma.estoque.create({
      data: {
        lojaId: data.order.lojaId,
        produtoId: data.product.id,
        quantidadeFisica: 2
      }
    });
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(() =>
        move(data.order.lojaId, data.admin.id, {
          produtoId: data.product.id,
          tipo: "EXIT",
          motivo: "SALE",
          quantidade: 1
        })
      )
    );
    const after = await prisma.estoque.findUniqueOrThrow({
      where: { id: stock.id }
    });
    const exits = await prisma.movimentacaoEstoque.count({
      where: { estoqueId: stock.id, tipo: "EXIT" }
    });
    expect(settledOk(results)).toBeLessThanOrEqual(2);
    expect(exits).toBe(settledOk(results));
    expect(after.quantidadeFisica).toBe(2 - exits);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "MOVE_STOCK",
          lojaId: data.order.lojaId,
          entityId: {
            in: (
              await prisma.movimentacaoEstoque.findMany({
                where: { estoqueId: stock.id }
              })
            ).map((m) => m.id)
          }
        }
      })
    ).toBe(exits);
  });

  it("pagamentos concorrentes não ultrapassam o total do pedido", async () => {
    const data = await fixture();
    const { pay } = await import("../src/modules/finance/finance.service");
    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        pay(data.order.lojaId, data.admin.id, data.order.id, {
          formaPagamento: "CASH",
          moeda: "USD",
          valor: 100
        })
      )
    );
    const payments = await prisma.pagamento.findMany({
      where: { pedidoCompraId: data.order.id }
    });
    expect(settledOk(results)).toBe(1);
    expect(
      payments.reduce((sum, payment) => sum + Number(payment.valor), 0)
    ).toBe(100);
  });

  it("estornos concorrentes não ultrapassam o pagamento original", async () => {
    const data = await fixture();
    const { pay, refund } =
      await import("../src/modules/finance/finance.service");
    const original = await pay(
      data.order.lojaId,
      data.admin.id,
      data.order.id,
      {
        formaPagamento: "CASH",
        moeda: "USD",
        valor: 100
      }
    );
    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        refund(data.order.lojaId, data.admin.id, original.id, 60)
      )
    );
    expect(settledOk(results)).toBe(1);
    const refunded = await prisma.pagamento.aggregate({
      where: { estornoDeId: original.id },
      _sum: { valor: true }
    });
    expect(Number(refunded._sum.valor)).toBe(60);
  });

  it("rejeita pagamento em moeda diferente da do pedido", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({ code: "GESTOR_LOJA" });
    const response = await request(app)
      .post("/finance/payments")
      .set(headers)
      .send({
        pedidoCompraId: data.order.id,
        formaPagamento: "CASH",
        moeda: "BRL",
        valor: 10
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("currency_mismatch");
    expect(
      await prisma.pagamento.count({ where: { pedidoCompraId: data.order.id } })
    ).toBe(0);
  });

  it("falha de auditoria desfaz o pagamento", async () => {
    const data = await fixture();
    const { pay } = await import("../src/modules/finance/finance.service");
    const { setAuditFailureForTests } =
      await import("../src/modules/operations/operations.persistence");
    setAuditFailureForTests((input) => input.action === "REGISTER_PAYMENT");
    try {
      await expect(
        pay(data.order.lojaId, data.admin.id, data.order.id, {
          formaPagamento: "CASH",
          moeda: "USD",
          valor: 10
        })
      ).rejects.toThrow();
    } finally {
      setAuditFailureForTests();
    }
    expect(
      await prisma.pagamento.count({ where: { pedidoCompraId: data.order.id } })
    ).toBe(0);
  });
});

describe("autorização por capacidade nos módulos operacionais", () => {
  it("perfil Miami não lê nem altera financeiro, estoque, pedidos, analytics ou simulações", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({ code: "CHECKPOINT_MIAMI" });
    for (const path of [
      "/finance/payments",
      "/purchase-orders",
      "/inventory",
      "/inventory/movements",
      "/analytics/dashboard",
      "/simulations",
      "/products",
      "/suppliers",
      "/categories"
    ]) {
      expect((await request(app).get(path).set(headers)).status, path).toBe(
        403
      );
    }
    const exchange = await request(app)
      .post("/finance/exchange-rates")
      .set(headers)
      .send({
        moedaOrigem: "USD",
        moedaDestino: "BRL",
        valorMercado: 5,
        cotadoEm: new Date().toISOString()
      });
    expect(exchange.status).toBe(403);
    await prisma.estoque.create({
      data: {
        lojaId: data.order.lojaId,
        produtoId: data.product.id,
        quantidadeFisica: 0
      }
    });
    const adjustment = await request(app)
      .post("/inventory/movements")
      .set(headers)
      .send({
        produtoId: data.product.id,
        tipo: "ADJUSTMENT_POSITIVE",
        motivo: "MANUAL_CORRECTION",
        quantidade: 1,
        observacoes: "x"
      });
    expect(adjustment.status).toBe(403);
    const stock = await prisma.estoque.findFirstOrThrow({
      where: { produtoId: data.product.id }
    });
    expect(stock.quantidadeFisica).toBe(0);
  });

  it("perfil Miami localiza pedido por número sem receber valores", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({ code: "CHECKPOINT_MIAMI" });
    const response = await request(app)
      .get("/purchase-orders/search/numero")
      .set(headers)
      .query({ numero: data.order.numeroPedido });
    expect(response.status).toBe(200);
    const [found] = response.body;
    expect(found.id).toBe(data.order.id);
    expect(found).not.toHaveProperty("total");
    expect(found.itens[0]).not.toHaveProperty("precoUnitario");
    expect(found.itens[0].produto).not.toHaveProperty("precoVenda");
    expect(found.itens[0].quantidade).toBe(data.item.quantidade);
  });

  it("gestor de loja vê valores na busca por número", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({ code: "GESTOR_LOJA" });
    const response = await request(app)
      .get("/purchase-orders/search/numero")
      .set(headers)
      .query({ numero: data.order.numeroPedido });
    expect(Number(response.body[0].total)).toBe(100);
  });

  it("movimentar estoque não concede ajuste que cria ou remove saldo", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({
      codes: ["ESTOQUE_VISUALIZAR", "ESTOQUE_MOVIMENTAR"]
    });
    await prisma.estoque.create({
      data: {
        lojaId: data.order.lojaId,
        produtoId: data.product.id,
        quantidadeFisica: 3
      }
    });
    const exit = await request(app)
      .post("/inventory/movements")
      .set(headers)
      .send({
        produtoId: data.product.id,
        tipo: "EXIT",
        motivo: "SALE",
        quantidade: 1
      });
    expect(exit.status).toBe(200);
    for (const tipo of [
      "ADJUSTMENT_POSITIVE",
      "ADJUSTMENT_NEGATIVE",
      "RETURN_ENTRY",
      "RETURN_EXIT"
    ]) {
      const response = await request(app)
        .post("/inventory/movements")
        .set(headers)
        .send({
          produtoId: data.product.id,
          tipo,
          motivo: "MANUAL_CORRECTION",
          quantidade: 1,
          observacoes: "x"
        });
      expect(response.status, tipo).toBe(403);
    }
    expect(
      (
        await prisma.estoque.findFirstOrThrow({
          where: { produtoId: data.product.id }
        })
      ).quantidadeFisica
    ).toBe(2);
  });

  it("leitura financeira não concede registro", async () => {
    const data = await fixture();
    const { app, headers } = await userWith({
      codes: ["FINANCEIRO_VISUALIZAR"]
    });
    expect(
      (await request(app).get("/finance/payments").set(headers)).status
    ).toBe(200);
    const response = await request(app)
      .post("/finance/payments")
      .set(headers)
      .send({
        pedidoCompraId: data.order.id,
        formaPagamento: "CASH",
        moeda: "USD",
        valor: 10
      });
    expect(response.status).toBe(403);
  });
});
