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
// Janela isolada: nenhum outro teste grava fatos em 2032.
const WINDOW = {
  from: "2032-01-01T00:00:00.000Z",
  to: "2032-02-01T00:00:00.000Z"
};

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const data of fixtures.splice(0)) {
    const ids = (
      await prisma.venda.findMany({
        where: { itens: { some: { produtoId: data.product.id } } },
        select: { id: true }
      })
    ).map((sale) => sale.id);
    await prisma.vendaItem.deleteMany({ where: { vendaId: { in: ids } } });
    await prisma.venda.deleteMany({ where: { id: { in: ids } } });
    await prisma.pedidoCompraItem.deleteMany({
      where: {
        produtoId: data.product.id,
        pedidoCompraId: { not: data.order.id }
      }
    });
    await prisma.pedidoCompra.deleteMany({
      where: { numeroPedido: { startsWith: `B18-${data.product.id}` } }
    });
    await data.cleanup();
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

async function login(email: string) {
  const app = createApp();
  const session = await request(app)
    .post("/auth/login")
    .send({ email, password: "change-me" });
  const stores = session.body.stores as { id: string; slug: string }[];
  const header = (slug: string) => ({
    Authorization: `Bearer ${session.body.accessToken}`,
    "x-store-id": stores.find((store) => store.slug === slug)!.id
  });
  return { app, header };
}

async function analyticsOnlyUser() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const profile = await prisma.perfil.create({
    data: { code: `TEST_${randomUUID()}`, name: "test" }
  });
  profiles.push(profile.id);
  await prisma.perfilPermissao.create({
    data: {
      perfilId: profile.id,
      permissaoId: (
        await prisma.permissao.findUniqueOrThrow({
          where: { code: "ANALYTICS_VISUALIZAR" }
        })
      ).id
    }
  });
  const email = `b18-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "B18",
      email,
      passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: store.id } },
      perfis: { create: { perfilId: profile.id } }
    }
  });
  users.push(user.id);
  return login(email);
}

// Fatos sintéticos em 2032: pedido USD 100 + pedido BRL 50, lote com 10 dias de lead time,
// venda confirmada sem baixa (sem custo conhecido).
async function facts() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  fixtures.push(data);
  await prisma.pedidoCompra.update({
    where: { id: data.order.id },
    data: { dataCompra: new Date("2032-01-05T12:00:00.000Z"), moeda: "USD" }
  });
  await prisma.pedidoCompra.create({
    data: {
      lojaId: store.id,
      fornecedorId: data.supplier.id,
      numeroPedido: `B18-${data.product.id}-BRL`,
      dataCompra: new Date("2032-01-06T12:00:00.000Z"),
      moeda: "BRL",
      status: "CONFIRMED",
      subtotal: 50,
      total: 50,
      itens: {
        create: {
          produtoId: data.product.id,
          quantidade: 1,
          precoUnitario: 50,
          totalItem: 50
        }
      }
    }
  });
  const stock = await prisma.estoque.create({
    data: { lojaId: store.id, produtoId: data.product.id, quantidadeFisica: 2 }
  });
  await prisma.movimentacaoEstoque.create({
    data: {
      lojaId: store.id,
      produtoId: data.product.id,
      estoqueId: stock.id,
      pedidoCompraItemId: data.item.id,
      tipo: "ENTRY",
      motivo: "PURCHASE_RECEIPT",
      quantidade: 2,
      quantidadeAnterior: 0,
      quantidadePosterior: 2,
      responsavelId: data.admin.id,
      createdAt: new Date("2032-01-15T12:00:00.000Z")
    }
  });
  const sale = await prisma.venda.create({
    data: {
      lojaId: store.id,
      canal: "SHOPEE",
      dataVenda: new Date("2032-01-20T12:00:00.000Z"),
      moeda: "BRL",
      estado: "CONFIRMADA",
      criadoPorId: data.admin.id
    }
  });
  await prisma.vendaItem.create({
    data: {
      lojaId: store.id,
      vendaId: sale.id,
      produtoId: data.product.id,
      quantidade: 1,
      precoUnitario: 300,
      taxaMarketplace: 30
    }
  });
  return data;
}

const line = (
  lines: { codigo: string; dimensao: string | null; moeda: string | null }[],
  codigo: string,
  dimensao: string | null,
  moeda: string | null
) =>
  lines.find(
    (entry) =>
      entry.codigo === codigo &&
      entry.dimensao === dimensao &&
      entry.moeda === moeda
  );

describe("analytics read models (Batch 18)", () => {
  it("dashboard separa moedas e indicadores reconciliam com as fontes", async () => {
    await facts();
    const admin = await login("admin@example.com");
    const dashboard = await request(admin.app)
      .get("/analytics/dashboard")
      .query(WINDOW)
      .set(admin.header("dronz"));
    expect(dashboard.body.orders.total).toEqual({
      USD: "100.00",
      BRL: "50.00"
    });
    const result = await request(admin.app)
      .get("/analytics/indicators")
      .query(WINDOW)
      .set(admin.header("dronz"));
    expect(result.status).toBe(200);
    const lines = result.body.linhas;
    expect(line(lines, "COMPRAS_VALOR", null, "USD")).toMatchObject({
      valor: "100.00",
      amostra: 1
    });
    expect(line(lines, "COMPRAS_VALOR", null, "BRL")).toMatchObject({
      valor: "50.00",
      amostra: 1
    });
    expect(line(lines, "LEAD_TIME_COMPRA_ENTRADA", null, null)).toMatchObject({
      valor: "10.0",
      amostra: 1
    });
    expect(line(lines, "VENDAS_POR_CANAL", "SHOPEE", "BRL")).toMatchObject({
      valor: "270.00",
      amostra: 1
    });
    // Venda sem custo conhecido não gera margem fictícia.
    expect(line(lines, "MARGEM_REALIZADA", "PERCENTUAL", "BRL")).toMatchObject({
      valor: null,
      status: "SEM_AMOSTRA"
    });
    expect(
      line(lines, "MARGEM_REALIZADA", "VENDAS_SEM_CUSTO", "BRL")
    ).toMatchObject({ valor: "1" });
    expect(line(lines, "FLUXO_FINANCEIRO", null, null)).toMatchObject({
      status: "SEM_AMOSTRA"
    });
    expect(result.body.parametros).toMatchObject({
      from: WINDOW.from,
      to: WINDOW.to,
      financeiro: true
    });

    // Filtro de moeda e CSV reproduzem a mesma consulta.
    const brl = await request(admin.app)
      .get("/analytics/indicators")
      .query({ ...WINDOW, moeda: "brl" })
      .set(admin.header("dronz"));
    expect(line(brl.body.linhas, "COMPRAS_VALOR", null, "USD")).toBeUndefined();
    const csv = await request(admin.app)
      .get("/analytics/indicators.csv")
      .query(WINDOW)
      .set(admin.header("dronz"));
    expect(csv.headers["content-type"]).toContain("text/csv");
    const [header, ...rows] = csv.text.trim().split("\n");
    expect(header).toBe("codigo,versao,dimensao,moeda,valor,amostra,status");
    expect(rows).toContain("COMPRAS_VALOR,B18-v1,,USD,100.00,1,OK");
    expect(rows.length).toBe(lines.length);

    // Outra loja não vê os fatos da Dronz.
    const gooder = await request(admin.app)
      .get("/analytics/indicators")
      .query(WINDOW)
      .set(admin.header("gooder"));
    expect(
      line(gooder.body.linhas, "COMPRAS_VALOR", null, "USD")
    ).toBeUndefined();
    expect(
      line(gooder.body.linhas, "LEAD_TIME_COMPRA_ENTRADA", null, null)
    ).toMatchObject({ status: "SEM_AMOSTRA" });
  });

  it("sem acesso financeiro, analytics não expõe valores, preços nem exportação", async () => {
    await facts();
    const user = await analyticsOnlyUser();
    const dashboard = await request(user.app)
      .get("/analytics/dashboard")
      .query(WINDOW)
      .set(user.header("dronz"));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.orders.total).toBeNull();
    expect(dashboard.body.payments.paid).toBeNull();
    for (const type of [
      "payments",
      "costs",
      "purchase-items",
      "purchase-orders",
      "markup"
    ])
      expect(
        (
          await request(user.app)
            .get(`/analytics/reports/${type}`)
            .set(user.header("dronz"))
        ).status,
        type
      ).toBe(403);
    expect(
      (
        await request(user.app)
          .get("/analytics/reports/inventory")
          .set(user.header("dronz"))
      ).status
    ).toBe(200);
    const result = await request(user.app)
      .get("/analytics/indicators")
      .query(WINDOW)
      .set(user.header("dronz"));
    expect(
      result.body.linhas.some(
        (l: { codigo: string }) => l.codigo === "COMPRAS_VALOR"
      )
    ).toBe(false);
    expect(
      result.body.definicoes.every(
        (d: { financeiro: boolean }) => !d.financeiro
      )
    ).toBe(true);
    expect(
      (
        await request(user.app)
          .get("/analytics/indicators.csv")
          .set(user.header("dronz"))
      ).status
    ).toBe(403);
  });
});
