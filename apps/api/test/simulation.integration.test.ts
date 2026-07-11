import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});

afterAll(async () => {
  await prisma.simulacaoViagem.deleteMany({
    where: { nome: { startsWith: "SIM-" } },
  });
  await prisma.$disconnect();
});

async function session() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
    h = (id: string) => ({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": id,
    });
  return { app, d, h };
}

describe("simulation travel", () => {
  it("1. SEM_RISCO — cenário padrão sem tributação aplicada", async () => {
    const { app, d, h } = await session();

    const created = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Sem Risco",
        quantidadeViajantes: 1,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Mac Studio",
            custoUnitario: 8000,
            quantidade: 2,
            precoVendaUnitario: 10000,
            pesoUnitarioKg: 4,
          },
          {
            nomeItem: "Macbook Pro",
            custoUnitario: 8075,
            quantidade: 1,
            precoVendaUnitario: 15000,
            pesoUnitarioKg: 2.5,
          },
          {
            nomeItem: "Power Beats Pro",
            custoUnitario: 0,
            quantidade: 5,
            precoVendaUnitario: 1000,
            pesoUnitarioKg: 0.1,
          },
        ],
        custos: {
          comissao: 400,
          passagens: 600,
          hotel: 800,
          carro: 300,
          alimentacao: 400,
        },
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.quantidadeViajantes).toBe(1);

    const simulacaoId = created.body.id;
    const calculo = await request(app)
      .post(`/simulations/${simulacaoId}/calcular`)
      .set(h(d.id));

    expect(calculo.status).toBe(200);

    const result = calculo.body.calculo;
    expect(result.cotaTotalIsentaUsd).toBe("1000");
    expect(parseFloat(result.tributacaoPrevistaBrl)).toBeGreaterThan(0);
    expect(parseFloat(result.lucroFinalDeclarando)).toBeCloseTo(10530, -1);
    expect(parseFloat(result.percentualLucroDeclarando)).toBeGreaterThan(0);

    const del = await request(app)
      .delete(`/simulations/${simulacaoId}`)
      .set(h(d.id));
    expect(del.status).toBe(200);
  });

  it("2. SIMULACAO abaixo da cota — sem tributação pois valor é menor", async () => {
    const { app, d, h } = await session();

    const created = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Abaixo Cota",
        quantidadeViajantes: 1,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Item Baixo Valor",
            custoUnitario: 500,
            quantidade: 1,
            precoVendaUnitario: 800,
            pesoUnitarioKg: 0.5,
          },
        ],
        custos: { comissao: 100 },
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(created.status).toBe(201);

    const calculo = await request(app)
      .post(`/simulations/${created.body.id}/calcular`)
      .set(h(d.id));

    const result = calculo.body.calculo;
    expect(parseFloat(result.excedenteTributavelUsd)).toBeCloseTo(0, 1);
    expect(parseFloat(result.tributacaoPrevistaBrl)).toBeCloseTo(0, 1);

    await request(app)
      .delete(`/simulations/${created.body.id}`)
      .set(h(d.id));
  });

  it("3. SIMULACAO acima da cota — com tributação sobre excedente", async () => {
    const { app, d, h } = await session();

    const created = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Acima Cota",
        quantidadeViajantes: 1,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Item Alto Valor",
            custoUnitario: 8000,
            quantidade: 1,
            precoVendaUnitario: 12000,
            pesoUnitarioKg: 2,
          },
        ],
        custos: { comissao: 500 },
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(created.status).toBe(201);

    const calculo = await request(app)
      .post(`/simulations/${created.body.id}/calcular`)
      .set(h(d.id));

    const result = calculo.body.calculo;
    const excedenteTributavel = parseFloat(result.excedenteTributavelUsd);
    expect(excedenteTributavel).toBeGreaterThan(0);

    const tributacaoPrevista = parseFloat(result.tributacaoPrevistaBrl);
    expect(tributacaoPrevista).toBeGreaterThan(0);

    await request(app)
      .delete(`/simulations/${created.body.id}`)
      .set(h(d.id));
  });

  it("4. EFETIVADA — tributação manual aplicada ao lucro", async () => {
    const { app, d, h } = await session();

    const created = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Efetivada",
        quantidadeViajantes: 1,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Item",
            custoUnitario: 5000,
            quantidade: 1,
            precoVendaUnitario: 8000,
            pesoUnitarioKg: 1,
          },
        ],
        custos: { comissao: 200 },
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(created.status).toBe(201);

    const simulacaoId = created.body.id;
    const calculo1 = await request(app)
      .post(`/simulations/${simulacaoId}/calcular`)
      .set(h(d.id));

    const lucroSemTributacao = parseFloat(calculo1.body.calculo.lucroFinalDeclarando);

    const atualizar = await request(app)
      .post(`/simulations/${simulacaoId}/atualizar-tributacao`)
      .set(h(d.id))
      .send({
        riscoEfetivado: true,
        tributacaoEfetivadaBrl: 1000,
      });

    expect(atualizar.status).toBe(200);
    expect(atualizar.body.riscoEfetivado).toBe(true);
    expect(parseFloat(atualizar.body.tributacaoEfetivadaBrl)).toBe(1000);

    const calculo2 = await request(app)
      .post(`/simulations/${simulacaoId}/calcular`)
      .set(h(d.id));

    const lucroComTributacao = parseFloat(calculo2.body.calculo.lucroFinalNaoDeclarando);
    expect(lucroComTributacao).toBeLessThan(lucroSemTributacao);
    expect(lucroSemTributacao - lucroComTributacao).toBeCloseTo(1000, 0);

    await request(app)
      .delete(`/simulations/${simulacaoId}`)
      .set(h(d.id));
  });

  it("5. Cota por múltiplos viajantes — cota ampliada", async () => {
    const { app, d, h } = await session();

    const created = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Multiplos Viajantes",
        quantidadeViajantes: 3,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Item",
            custoUnitario: 8000,
            quantidade: 1,
            precoVendaUnitario: 12000,
            pesoUnitarioKg: 2,
          },
        ],
        custos: { comissao: 500 },
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.quantidadeViajantes).toBe(3);

    const calculo = await request(app)
      .post(`/simulations/${created.body.id}/calcular`)
      .set(h(d.id));

    const result = calculo.body.calculo;
    expect(result.cotaTotalIsentaUsd).toBe("3000");
    expect(parseFloat(result.excedenteTributavelUsd)).toBeGreaterThanOrEqual(0);

    await request(app)
      .delete(`/simulations/${created.body.id}`)
      .set(h(d.id));
  });

  it("6. Isolamento por lojaId", async () => {
    const app = createApp();
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
    const dronz = login.body.stores.find((x: { slug: string }) => x.slug === "dronz");
    const gooder = login.body.stores.find((x: { slug: string }) => x.slug === "gooder");
    const h = (id: string) => ({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": id,
    });

    const createdDronz = await request(app)
      .post("/simulations")
      .set(h(dronz.id))
      .send({
        nome: "SIM-Dronz Only",
        quantidadeViajantes: 1,
        riscoEfetivado: false,
        tributacaoEfetivadaBrl: 0,
        itens: [
          {
            nomeItem: "Produto Dronz",
            custoUnitario: 1000,
            quantidade: 1,
            precoVendaUnitario: 1500,
            pesoUnitarioKg: 1,
          },
        ],
        custos: {},
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });

    expect(createdDronz.status).toBe(201);

    const tryAccessGooder = await request(app)
      .get(`/simulations/${createdDronz.body.id}`)
      .set(h(gooder.id));
    expect(tryAccessGooder.status).toBe(500);

    const listGooder = await request(app)
      .get("/simulations")
      .set(h(gooder.id));
    expect(listGooder.status).toBe(200);
    expect(
      listGooder.body.some((s: { id: string; nome: string }) => s.nome === "SIM-Dronz Only")
    ).toBe(false);

    await request(app)
      .delete(`/simulations/${createdDronz.body.id}`)
      .set(h(dronz.id));
  });

  it("isola simulacoes por loja", async () => {
    const app = createApp();
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "change-me" });
    const dronz = login.body.stores.find((x: { slug: string }) => x.slug === "dronz");
    const gooder = login.body.stores.find((x: { slug: string }) => x.slug === "gooder");
    const h = (id: string) => ({
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": id,
    });

    // cria simulacao em dronz
    const createdDronz = await request(app)
      .post("/simulations")
      .set(h(dronz.id))
      .send({
        nome: "SIM-Dronz Only",
        itens: [
          {
            nomeItem: "Produto Dronz",
            custoUnitario: 100,
            quantidade: 1,
            precoVendaUnitario: 200,
            pesoUnitarioKg: 1,
          },
        ],
        custos: {},
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });
    expect(createdDronz.status).toBe(201);

    // tenta acessar em gooder
    const tryAccessGooder = await request(app)
      .get(`/simulations/${createdDronz.body.id}`)
      .set(h(gooder.id));
    expect(tryAccessGooder.status).toBe(500); // nao encontrado

    // lista em gooder nao retorna simulacao de dronz
    const listGooder = await request(app)
      .get("/simulations")
      .set(h(gooder.id));
    expect(listGooder.status).toBe(200);
    expect(
      listGooder.body.some(
        (s: { id: string; nome: string }) => s.nome === "SIM-Dronz Only"
      )
    ).toBe(false);
  });

  it("rejeita dados invalidos", async () => {
    const { app, d, h } = await session();

    // nome vazio
    const noName = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "",
        itens: [
          {
            nomeItem: "Item",
            custoUnitario: 100,
            quantidade: 1,
            precoVendaUnitario: 200,
            pesoUnitarioKg: 1,
          },
        ],
        custos: {},
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });
    expect(noName.status).toBe(400);

    // itens vazio
    const noItems = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Test",
        itens: [],
        custos: {},
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });
    expect(noItems.status).toBe(400);

    // quantidade negativa
    const negQtde = await request(app)
      .post("/simulations")
      .set(h(d.id))
      .send({
        nome: "SIM-Test",
        itens: [
          {
            nomeItem: "Item",
            custoUnitario: 100,
            quantidade: -1,
            precoVendaUnitario: 200,
            pesoUnitarioKg: 1,
          },
        ],
        custos: {},
        parametros: {
          custoEnvioPorKgUsd: 46.17,
          cotacaoDolar: 5.7,
        },
      });
    expect(negQtde.status).toBe(400);
  });
});
