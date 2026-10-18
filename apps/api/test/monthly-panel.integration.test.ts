import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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
const purchases: string[] = [];
const users: string[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  await prisma.atribuicaoCompraItem.deleteMany({
    where: { itemExterno: { compraImportadaId: { in: purchases } } }
  });
  await prisma.compraImportadaItem.deleteMany({
    where: { compraImportadaId: { in: purchases } }
  });
  await prisma.compraImportada.deleteMany({
    where: { id: { in: purchases.splice(0) } }
  });
  for (const id of users.splice(0)) {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

async function purchase(input: {
  dataPedido: string;
  moeda?: string;
  totalExterno?: number;
  titulo?: string;
  quantidade: number;
  preco: number;
  cancelada?: number;
  dronz?: number;
  gooder?: number;
  materializadoDronz?: number;
}) {
  const [dronz, gooder] = await Promise.all(
    ["dronz", "gooder"].map((slug) =>
      prisma.loja.findUniqueOrThrow({ where: { slug } })
    )
  );
  const admin = await prisma.usuario.findUniqueOrThrow({
    where: { email: "admin@example.com" }
  });
  const moeda = input.moeda ?? "USD";
  const created = await prisma.compraImportada.create({
    data: {
      numeroPedido: `PAINEL-${randomUUID()}`,
      quantidade: input.quantidade,
      moeda,
      plataforma: "AMAZON",
      dataPedido: new Date(input.dataPedido),
      estado: "IMPORTADA",
      ...(input.totalExterno !== undefined
        ? { totalExterno: input.totalExterno }
        : {}),
      itens: {
        create: {
          identityFingerprint: randomUUID(),
          identityStrategy: "FINGERPRINT",
          titulo: input.titulo ?? "Drone",
          quantidade: input.quantidade,
          quantidadeCancelada: input.cancelada ?? 0,
          precoUnitario: input.preco,
          moeda
        }
      }
    },
    include: { itens: true }
  });
  purchases.push(created.id);
  const item = created.itens[0]!;
  for (const [loja, quantidade, materializada] of [
    [dronz, input.dronz, input.materializadoDronz],
    [gooder, input.gooder, 0]
  ] as const)
    if (quantidade)
      await prisma.atribuicaoCompraItem.create({
        data: {
          itemExternoId: item.id,
          lojaId: loja.id,
          quantidade,
          quantidadeMaterializada: materializada ?? 0,
          atribuidoPorId: admin.id
        }
      });
  return created;
}

async function admin() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  return {
    app,
    headers: { Authorization: `Bearer ${login.body.accessToken}` }
  };
}

describe("painel mensal de compras (Batch 13)", () => {
  it("usa dataPedido no fuso de São Paulo (X-13), separa moedas e reparte por loja sem inventar rateio", async () => {
    await purchase({
      dataPedido: "2031-03-15T15:00:00.000Z",
      quantidade: 10,
      preco: 100,
      cancelada: 1,
      dronz: 6,
      gooder: 2,
      materializadoDronz: 6,
      totalExterno: 1050
    });
    // 01/04 02:00 UTC = 31/03 23:00 em São Paulo: competência março.
    await purchase({
      dataPedido: "2031-04-01T02:00:00.000Z",
      quantidade: 1,
      preco: 10,
      gooder: 1
    });
    // 01/04 04:00 UTC = 01/04 01:00 em São Paulo: competência abril.
    await purchase({
      dataPedido: "2031-04-01T04:00:00.000Z",
      quantidade: 1,
      preco: 999
    });
    await purchase({
      dataPedido: "2031-03-20T15:00:00.000Z",
      moeda: "BRL",
      quantidade: 2,
      preco: 50
    });
    const { app, headers } = await admin();
    const march = await request(app)
      .get("/imported-purchases/monthly")
      .set(headers)
      .query({ ano: 2031, mes: 3 });
    expect(march.status).toBe(200);
    expect(march.body.competencia).toMatchObject({
      timezone: "America/Sao_Paulo",
      inicio: "2031-03-01T03:00:00.000Z",
      fim: "2031-04-01T03:00:00.000Z"
    });
    const usd = march.body.moedas.find(
      (entry: { moeda: string }) => entry.moeda === "USD"
    );
    const brl = march.body.moedas.find(
      (entry: { moeda: string }) => entry.moeda === "BRL"
    );
    expect(usd).toMatchObject({
      pedidos: 2,
      linhas: 2,
      unidades: 11,
      bruto: "1010.00",
      cancelado: "100.00",
      liquido: "910.00",
      pendenteAtribuicao: "100.00",
      materializado: "600.00",
      naoRateado: "50.00"
    });
    const store = (slug: string) =>
      usd.lojas.find((entry: { slug: string }) => entry.slug === slug);
    expect(store("dronz")).toMatchObject({
      valor: "600.00",
      unidades: 6,
      pedidos: 1
    });
    expect(store("gooder")).toMatchObject({
      valor: "210.00",
      unidades: 3,
      pedidos: 2
    });
    expect(brl).toMatchObject({
      bruto: "100.00",
      pendenteAtribuicao: "100.00"
    });
    const april = await request(app)
      .get("/imported-purchases/monthly")
      .set(headers)
      .query({ ano: 2031, mes: 4 });
    expect(
      april.body.moedas.find(
        (entry: { moeda: string }) => entry.moeda === "USD"
      ).bruto
    ).toBe("999.00");
    const onlyBrl = await request(app)
      .get("/imported-purchases/monthly")
      .set(headers)
      .query({ ano: 2031, mes: 3, moeda: "brl" });
    expect(
      onlyBrl.body.moedas.map((entry: { moeda: string }) => entry.moeda)
    ).toEqual(["BRL"]);
  });

  it("CSV tem colunas estáveis, neutraliza fórmula e mantém cabeçalho em mês vazio", async () => {
    await purchase({
      dataPedido: "2031-05-10T15:00:00.000Z",
      quantidade: 3,
      preco: 20,
      titulo: '=HYPERLINK("x")',
      dronz: 1
    });
    const { app, headers } = await admin();
    const csv = await request(app)
      .get("/imported-purchases/monthly.csv")
      .set(headers)
      .query({ ano: 2031, mes: 5 });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const [header, row] = csv.text.trim().split("\n");
    expect(header).toBe(
      "data_pedido,plataforma,conta,merchant,pedido,linha,titulo,moeda,quantidade,cancelada,reembolsada,preco_unitario,valor_bruto,qtd_dronz,valor_dronz,qtd_gooder,valor_gooder,qtd_pendente,valor_pendente,qtd_materializada,estado"
    );
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain("2031-05-10,AMAZON");
    expect(row).toContain(
      ",3,0,0,20.00,60.00,1,20.00,0,0.00,2,40.00,0,IMPORTADA"
    );
    const empty = await request(app)
      .get("/imported-purchases/monthly.csv")
      .set(headers)
      .query({ ano: 2031, mes: 6 });
    expect(empty.text).toBe(`${header}\n`);
  });

  it("exige permissão de compras importadas e valida a competência", async () => {
    const { app, headers } = await admin();
    expect(
      (
        await request(app)
          .get("/imported-purchases/monthly")
          .set(headers)
          .query({ ano: 2031, mes: 13 })
      ).status
    ).toBe(400);
    const store = await prisma.loja.findUniqueOrThrow({
      where: { slug: "dronz" }
    });
    const email = `painel-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({
      data: {
        name: "Sem acesso",
        email,
        passwordHash: await bcrypt.hash("change-me", 12),
        lojas: { create: { lojaId: store.id } }
      }
    });
    users.push(user.id);
    const login = await request(app)
      .post("/auth/login")
      .send({ email, password: "change-me" });
    const denied = await request(app)
      .get("/imported-purchases/monthly")
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .query({ ano: 2031, mes: 3 });
    expect(denied.status).toBe(403);
  });
});
