import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const purchases: string[] = [];
const TEST_SOURCE = "teste-purchase-control";
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  await prisma.projecaoCompraItem.deleteMany({ where: { itemExterno: { compraImportadaId: { in: purchases } } } });
  await prisma.atribuicaoCompraItem.deleteMany({ where: { itemExterno: { compraImportadaId: { in: purchases } } } });
  await prisma.compraImportadaItem.deleteMany({ where: { compraImportadaId: { in: purchases } } });
  await prisma.compraImportada.deleteMany({ where: { id: { in: purchases.splice(0) } } });
  await prisma.produtoBase.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await prisma.taxaMarketplaceParametro.deleteMany({});
  await prisma.parametroEconomico.deleteMany({});
  await prisma.cotacaoCambio.deleteMany({ where: { fonte: TEST_SOURCE } });
});
afterAll(() => prisma.$disconnect());

type Calc = { status: string; porUnidade: Record<string, string | null>; total: Record<string, string | null> };
type Body = {
  linhas: { titulo: string; quantidade: number; precoUnitario: string; pesoKgUsado: string | null; produtoBase: { nome: string } | null; calculo: Calc }[];
  totais: Record<string, string | number | null>;
};

const stores = async () => ({
  dronz: await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } }),
  gooder: await prisma.loja.findUniqueOrThrow({ where: { slug: "gooder" } })
});

async function setup() {
  const { dronz, gooder } = await stores();
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  const auth = { Authorization: `Bearer ${login.body.accessToken}` };
  const as = (loja: { id: string }) => ({ ...auth, "x-store-id": loja.id });
  const settings = {
    acrescimoCambialBrl: "0.20",
    frete: { valorPorKg: "90", moeda: "USD" },
    markupAlertaPercentual: "30",
    notaFiscalPercentual: "5",
    notaFiscalBase: "VENDA_BRUTA",
    iofPercentual: null,
    observacoes: null,
    taxasMarketplace: [{ canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: "16", descricao: null }]
  };
  expect((await request(app).post("/economic-settings").set(as(dronz)).send(settings)).status).toBe(201);
  await prisma.cotacaoCambio.create({
    data: { lojaId: dronz.id, responsavelId: admin.id, moedaOrigem: "USD", moedaDestino: "BRL", valorMercado: 5, margem: 0.2, valor: 5.2, fonte: TEST_SOURCE, cotadoEm: new Date() }
  });
  // US$ 100 × 2 unidades, todas atribuídas à Dronz, pedido em março de 2031.
  const created = await prisma.compraImportada.create({
    data: {
      numeroPedido: `CONTROLE-${randomUUID()}`,
      quantidade: 2,
      moeda: "USD",
      plataforma: "AMAZON",
      dataPedido: new Date("2031-03-15T15:00:00.000Z"),
      estado: "IMPORTADA",
      itens: { create: { identityFingerprint: randomUUID(), identityStrategy: "FINGERPRINT", titulo: "Apple AirPods Pro 3", quantidade: 2, precoUnitario: 100, moeda: "USD" } }
    },
    include: { itens: true }
  });
  purchases.push(created.id);
  const item = created.itens[0]!;
  await prisma.atribuicaoCompraItem.create({ data: { itemExternoId: item.id, lojaId: dronz.id, quantidade: 2, atribuidoPorId: admin.id } });
  return { app, auth, as, dronz, gooder, item };
}

describe("controle de compras (projeção por linha)", () => {
  it("projeta custo, taxas e sobra; peso e frete real mudam o cálculo; a base empresta e aprende o peso", async () => {
    const { app, as, dronz, item } = await setup();
    const get = async () => {
      const response = await request(app).get("/purchase-control").set(as(dronz)).query({ ano: 2031, mes: 3 });
      expect(response.status).toBe(200);
      return response.body as Body;
    };
    const put = (body: object) => request(app).put(`/purchase-control/items/${item.id}`).set(as(dronz)).send(body);

    // Sem venda nem peso: a linha existe, mas é marcada incompleta e não entra nos totais.
    const empty = await get();
    expect(empty.linhas).toHaveLength(1);
    expect(empty.linhas[0]).toMatchObject({ titulo: "Apple AirPods Pro 3", quantidade: 2, precoUnitario: "100" });
    expect(empty.linhas[0].calculo.status).toBe("INCOMPLETO");
    expect(empty.totais).toMatchObject({ linhas: 1, linhasIncompletas: 1, custo: "0.00" });

    // Venda R$ 1.000 e 0,5 kg: custo 100×5,20 + 90×0,5×5,20 = 754; taxa 160 + nota 50 + envio 30 → sobra 6 por unidade.
    expect((await put({ vendaUnitariaBrl: 1000, pesoKg: 0.5 })).status).toBe(200);
    const projected = (await get()).linhas[0].calculo;
    expect(projected.status).toBe("COMPLETO");
    expect(projected.porUnidade).toMatchObject({ custo: "754.00", taxaMarketplace: "160.00", notaFiscal: "50.00", outrosEncargosVenda: "30.00", lucro: "6.00" });
    expect(projected.total.lucro).toBe("12.00");

    // Frete realmente pago (US$ 50 no total) substitui a estimativa por peso: custo unitário 520 + 130 = 650.
    await put({ freteRealUsd: 50 });
    const real = await get();
    expect(real.linhas[0].calculo.porUnidade).toMatchObject({ custo: "650.00", lucro: "110.00" });
    expect(real.totais).toMatchObject({ linhasIncompletas: 0, custo: "1300.00", vendaBruta: "2000.00", lucro: "220.00" });

    // Base de produtos: sem peso próprio a linha usa o da base; peso digitado depois ensina a base.
    const base = await prisma.produtoBase.create({ data: { nome: "Test AirPods Pro 3", slug: "test-airpods-pro-3", pesoKg: "0.100" } });
    await put({ produtoBaseId: base.id, pesoKg: null, freteRealUsd: null });
    expect((await get()).linhas[0]).toMatchObject({ pesoKgUsado: "0.1", produtoBase: { nome: "Test AirPods Pro 3" } });
    await put({ pesoKg: 0.35 });
    expect((await prisma.produtoBase.findUniqueOrThrow({ where: { id: base.id } })).pesoKg?.toString()).toBe("0.35");
  });

  it("é por loja, valida entradas e exige login", async () => {
    const { app, as, gooder, item } = await setup();
    const other = await request(app).get("/purchase-control").set(as(gooder)).query({ ano: 2031, mes: 3 });
    expect(other.body.linhas).toEqual([]);
    expect((await request(app).put(`/purchase-control/items/${item.id}`).set(as(gooder)).send({ vendaUnitariaBrl: 10 })).status).toBe(404);
    const { dronz } = await stores();
    const put = (body: object) => request(app).put(`/purchase-control/items/${item.id}`).set(as(dronz)).send(body);
    expect((await put({ vendaUnitariaBrl: -1 })).status).toBe(400);
    expect((await put({ lojaId: "x" })).status).toBe(400);
    expect((await put({ produtoBaseId: "nao-existe" })).status).toBe(404);
    expect((await request(app).get("/purchase-control").set(as(dronz)).query({ ano: 2031, mes: 13 })).status).toBe(400);
    expect((await request(app).get("/purchase-control").query({ ano: 2031, mes: 3 })).status).toBe(401);
  });
});
