import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
let settingsService: typeof import("../src/modules/economic-settings/economic-settings.service");
const TEST_SOURCE = "TESTE-SIMULADOR";
const users: string[] = [];
const profiles: string[] = [];
const categories: string[] = [];

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
  settingsService = await import("../src/modules/economic-settings/economic-settings.service");
});

async function cleanEconomicData() {
  await prisma.simulacaoCompra.deleteMany({});
  await prisma.taxaMarketplaceParametro.deleteMany({});
  await prisma.parametroEconomico.deleteMany({});
  await prisma.cotacaoCambio.deleteMany({ where: { fonte: { in: [TEST_SOURCE, settingsService.DOLAR_FONTE] } } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanEconomicData();
  await prisma.produto.deleteMany({ where: { categoriaId: { in: categories } } });
  await prisma.categoria.deleteMany({ where: { id: { in: categories.splice(0) } } });
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

const stores = async () => ({
  dronz: await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } }),
  gooder: await prisma.loja.findUniqueOrThrow({ where: { slug: "gooder" } })
});

async function admin(storeId?: string) {
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  const id = storeId ?? (await stores()).dronz.id;
  return { app, headers: { Authorization: `Bearer ${login.body.accessToken}`, "x-store-id": id } };
}

async function userWith(codes: string[]) {
  const { dronz } = await stores();
  const perfil = await prisma.perfil.create({ data: { code: `TEST_${randomUUID()}`, name: "test" } });
  profiles.push(perfil.id);
  for (const code of codes) {
    const permission = await prisma.permissao.findUniqueOrThrow({ where: { code } });
    await prisma.perfilPermissao.create({ data: { perfilId: perfil.id, permissaoId: permission.id } });
  }
  const email = `simulador-${randomUUID()}@example.com`;
  const user = await prisma.usuario.create({
    data: {
      name: "Simulador",
      email,
      passwordHash: await bcrypt.hash("change-me", 12),
      lojas: { create: { lojaId: dronz.id } },
      perfis: { create: { perfilId: perfil.id } }
    }
  });
  users.push(user.id);
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email, password: "change-me" });
  return { app, headers: { Authorization: `Bearer ${login.body.accessToken}`, "x-store-id": dronz.id } };
}

async function product(lojaId: string, nome: string) {
  const suffix = randomUUID();
  const category = await prisma.categoria.create({ data: { lojaId, nome: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  categories.push(category.id);
  return prisma.produto.create({
    data: {
      lojaId,
      categoriaId: category.id,
      codigo: 2_000_000 + Number.parseInt(suffix.slice(0, 7), 16),
      nome,
      slug: `p-${suffix}`,
      precoVenda: 900,
      markup: 25,
      peso: 0.5
    }
  });
}

const settings = (frete = "10") => ({
  acrescimoCambialBrl: "0.20",
  frete: { valorPorKg: frete, moeda: "USD" },
  markupAlertaPercentual: "25",
  notaFiscalPercentual: "5",
  notaFiscalBase: null,
  iofPercentual: null,
  observacoes: null,
  taxasMarketplace: [
    { canal: "MERCADO_LIVRE", modalidade: "A_VISTA", parcelas: null, percentual: "12", descricao: null },
    { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16", descricao: null }
  ]
});

async function quote(lojaId: string, referencia = 5) {
  const adminUser = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  return prisma.cotacaoCambio.create({
    data: {
      lojaId,
      responsavelId: adminUser.id,
      moedaOrigem: "USD",
      moedaDestino: "BRL",
      valorMercado: referencia,
      margem: 0.2,
      valor: referencia + 0.2,
      fonte: TEST_SOURCE,
      cotadoEm: new Date()
    }
  });
}

const simulation = (produtoId: string, cotacaoCambioId: string, extra: object = {}) => ({
  produtoId,
  quantidade: 3,
  compra: { precoUnitario: "100", moeda: "USD" },
  pesoUnitarioKg: "0.5",
  cambio: { origem: "COTACAO_REGISTRADA", cotacaoCambioId },
  frete: { valorPorKg: "10", moeda: "USD" },
  encargosCompra: [],
  venda: {
    precoUnitarioBrl: "900",
    marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16" },
    notaFiscal: { modo: "PERCENTUAL_VENDA_BRUTA", percentual: "5" },
    outrosEncargos: []
  },
  markupAlertaPercentual: "25",
  ...extra
});

describe("Configurações econômicas", () => {
  it("grava versões sem alterar as anteriores e audita", async () => {
    const { app, headers } = await admin();
    const empty = await request(app).get("/economic-settings").set(headers);
    expect(empty.status).toBe(200);
    expect(empty.body.vigente).toBeNull();
    expect(empty.body.referenciasPO).toMatchObject({
      acrescimoCambialBrl: "0.20",
      notaFiscalPercentual: "5",
      notaFiscalBase: "VENDA_BRUTA",
      markupAlertaPercentual: "30",
      frete: { valorPorKg: "90", moeda: "USD" },
      taxas: [{ modalidade: "PARCELADO", percentual: "16" }]
    });

    const v1 = await request(app).post("/economic-settings").set(headers).send(settings("10"));
    expect(v1.status).toBe(201);
    expect(v1.body.versao).toBe(1);
    const v2 = await request(app).post("/economic-settings").set(headers).send(settings("12.5"));
    expect(v2.body.versao).toBe(2);

    const current = await request(app).get("/economic-settings").set(headers);
    expect(current.body.vigente.versao).toBe(2);
    expect(current.body.vigente.freteValorPorKg).toBe("12.5");
    expect(current.body.vigente.freteMoeda).toBe("USD");
    expect(current.body.vigente.taxasMarketplace).toHaveLength(2);
    expect(current.body.versoes.map((v: { versao: number }) => v.versao)).toEqual([2, 1]);
    const first = await prisma.parametroEconomico.findUniqueOrThrow({ where: { id: v1.body.id } });
    expect(first.freteValorPorKg?.toString()).toBe("10");
    expect(await prisma.auditLog.count({ where: { action: "SAVE_ECONOMIC_SETTINGS", entityId: v2.body.id } })).toBe(1);
  });

  it("rejeita taxa duplicada, parcelas incoerentes e frete sem moeda", async () => {
    const { app, headers } = await admin();
    const taxa = settings().taxasMarketplace[0];
    expect((await request(app).post("/economic-settings").set(headers).send({ ...settings(), taxasMarketplace: [taxa, taxa] })).status).toBe(422);
    expect(
      (await request(app).post("/economic-settings").set(headers).send({ ...settings(), taxasMarketplace: [{ ...taxa, parcelas: 3 }] })).status
    ).toBe(422);
    expect((await request(app).post("/economic-settings").set(headers).send({ ...settings(), frete: { valorPorKg: "10" } })).status).toBe(400);
    expect(await prisma.parametroEconomico.count()).toBe(0);
  });

  it("limite de alerta de markup não fica abaixo do mínimo contratual de 25%", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    expect((await request(app).post("/economic-settings").set(headers).send({ ...settings(), markupAlertaPercentual: "24.99" })).status).toBe(400);
    expect((await request(app).post("/economic-settings").set(headers).send({ ...settings(), markupAlertaPercentual: "30" })).status).toBe(201);
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    expect(
      (await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(mac.id, q.id, { markupAlertaPercentual: "0" }))).status
    ).toBe(400);
    // R$ 100 de custo vendido a R$ 110 (markup 10%) fica abaixo do piso e gera alerta.
    const cheap = await request(app)
      .post("/purchase-simulations/calculate")
      .set(headers)
      .send(
        simulation(mac.id, q.id, {
          compra: { precoUnitario: "100", moeda: "BRL" },
          frete: { valorPorKg: "0", moeda: "BRL" },
          venda: { ...simulation(mac.id, q.id).venda, precoUnitarioBrl: "110" }
        })
      );
    expect(cheap.body.resultado.indicadores).toMatchObject({ markupPercentual: "10.00", abaixoDoLimite: true });
  });

  it("isola por loja e exige permissão financeira para gravar", async () => {
    const { dronz, gooder } = await stores();
    const { app, headers } = await admin(dronz.id);
    await request(app).post("/economic-settings").set(headers).send(settings());
    const other = await request(app).get("/economic-settings").set({ ...headers, "x-store-id": gooder.id });
    expect(other.body.vigente).toBeNull();

    const viewer = await userWith(["SIMULACAO_VISUALIZAR"]);
    expect((await request(viewer.app).get("/economic-settings").set(viewer.headers)).status).toBe(200);
    expect((await request(viewer.app).post("/economic-settings").set(viewer.headers).send(settings())).status).toBe(403);
    const nobody = await userWith(["CATALOGO_VISUALIZAR"]);
    expect((await request(nobody.app).get("/economic-settings").set(nobody.headers)).status).toBe(403);
  });

  it("captura o dólar comercial do dia, soma o acréscimo uma vez e não duplica no mesmo dia", async () => {
    const { app, headers } = await admin();
    await request(app).post("/economic-settings").set(headers).send(settings());
    vi.spyOn(settingsService.dolarSource, "fetchLatest").mockResolvedValue({ valor: 5.0564, cotadoEm: new Date() });
    const first = await request(app).post("/economic-settings/exchange-rate/dolar").set(headers).send({});
    expect(first.status).toBe(201);
    expect(first.body.jaRegistrada).toBe(false);
    expect(first.body.cotacao.valorMercado).toBe("5.0564");
    expect(first.body.cotacao.margem).toBe("0.2");
    expect(first.body.cotacao.valor).toBe("5.2564");
    expect(first.body.cotacao.fonte).toBe(settingsService.DOLAR_FONTE);
    const again = await request(app).post("/economic-settings/exchange-rate/dolar").set(headers).send({});
    expect(again.body.jaRegistrada).toBe(true);
    expect(await prisma.cotacaoCambio.count({ where: { fonte: settingsService.DOLAR_FONTE } })).toBe(1);

    const current = await request(app).get("/economic-settings/exchange-rate").set(headers);
    expect(current.body.cotacao).toMatchObject({ referencia: "5.056400", acrescimo: "0.200000", operacional: "5.256400" });
  });

  it("repetir a captura com a mesma chave devolve o registro gravado sem nova consulta à fonte", async () => {
    const { app, headers } = await admin();
    await request(app).post("/economic-settings").set(headers).send(settings());
    const fetchLatest = vi.spyOn(settingsService.dolarSource, "fetchLatest").mockResolvedValueOnce({ valor: 5.0564, cotadoEm: new Date() });
    const keyed = { ...headers, "Idempotency-Key": randomUUID() };
    const first = await request(app).post("/economic-settings/exchange-rate/dolar").set(keyed).send({});
    expect(first.status).toBe(201);
    // A resposta se perdeu e a fonte caiu: a repetição ainda recupera o mesmo registro.
    fetchLatest.mockRejectedValue(new Error("offline"));
    const again = await request(app).post("/economic-settings/exchange-rate/dolar").set(keyed).send({});
    expect(again.status).toBe(201);
    expect(again.body.cotacao.id).toBe(first.body.cotacao.id);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    const conflict = await request(app).post("/economic-settings/exchange-rate/dolar").set(keyed).send({ acrescimoCambialBrl: "0.3" });
    expect(conflict.status).toBe(409);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(await prisma.cotacaoCambio.count({ where: { fonte: settingsService.DOLAR_FONTE } })).toBe(1);
  });

  it("sem acréscimo configurado, com fonte indisponível ou resposta inválida, não inventa cotação", async () => {
    const { app, headers } = await admin();
    const fetchLatest = vi.spyOn(settingsService.dolarSource, "fetchLatest");
    expect((await request(app).post("/economic-settings/exchange-rate/dolar").set(headers).send({})).body.error).toBe(
      "acrescimo_cambial_nao_configurado"
    );
    expect(fetchLatest).not.toHaveBeenCalled();
    fetchLatest.mockRejectedValueOnce(new Error("offline"));
    const down = await request(app).post("/economic-settings/exchange-rate/dolar").set(headers).send({ acrescimoCambialBrl: "0.2" });
    expect(down.status).toBe(502);
    fetchLatest.mockRestore();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ chart: { result: [{ meta: {} }] } })));
    const invalid = await request(app).post("/economic-settings/exchange-rate/dolar").set(headers).send({ acrescimoCambialBrl: "0.2" });
    expect(invalid.body.error).toBe("dolar_resposta_invalida");
    expect(await prisma.cotacaoCambio.count({ where: { fonte: settingsService.DOLAR_FONTE } })).toBe(0);
  });
});

describe("Simulador de compra", () => {
  it("calcula com a cotação registrada da loja, sem gravar nada", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const mac = await product(dronz.id, "MacBook Air M3 13 512GB Prata");
    const q = await quote(dronz.id);
    const r = await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(mac.id, q.id));
    expect(r.status).toBe(200);
    expect(r.body.resultado.natureza).toBe("ESTIMATIVA");
    expect(r.body.resultado.cambio.operacional).toBe("5.200000");
    expect(r.body.resultado.porUnidade.custo).toBe("546.00");
    expect(r.body.resultado.total.custo).toBe("1638.00");
    expect(r.body.entrada.produto).toEqual({ id: mac.id, nome: mac.nome, codigo: mac.codigo });
    expect(await prisma.simulacaoCompra.count()).toBe(0);
  });

  it("busca de produto por parte do nome encontra a variante no catálogo da loja", async () => {
    const { dronz, gooder } = await stores();
    const { app, headers } = await admin();
    await product(dronz.id, "MacBook Air M3 13 512GB Prata");
    await product(dronz.id, "MacBook Air M3 13 512GB Meia-noite");
    await product(gooder.id, "MacBook Pro Gooder");
    const found = await request(app).get("/products").query({ search: "mac" }).set(headers);
    const names = found.body.items.map((item: { nome: string }) => item.nome);
    expect(names).toEqual(expect.arrayContaining(["MacBook Air M3 13 512GB Prata", "MacBook Air M3 13 512GB Meia-noite"]));
    expect(names).not.toContain("MacBook Pro Gooder");
  });

  it("não aceita produto, cotação ou parâmetros de outra loja", async () => {
    const { dronz, gooder } = await stores();
    const { app, headers } = await admin(dronz.id);
    const foreign = await product(gooder.id, "Produto Gooder");
    const mine = await product(dronz.id, "Produto Dronz");
    const foreignQuote = await quote(gooder.id);
    const myQuote = await quote(dronz.id);
    expect((await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(foreign.id, myQuote.id))).status).toBe(404);
    expect((await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(mine.id, foreignQuote.id))).status).toBe(404);
    const otherHeaders = { ...headers, "x-store-id": gooder.id };
    const otherSettings = await request(app).post("/economic-settings").set(otherHeaders).send(settings());
    expect(
      (await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(mine.id, myQuote.id, { parametroEconomicoId: otherSettings.body.id })))
        .status
    ).toBe(404);
  });

  it("salva com snapshot: mudar configuração e cotação depois não altera a simulação", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const v1 = await request(app).post("/economic-settings").set(headers).send(settings("10"));
    const mac = await product(dronz.id, "MacBook Air");
    const q = await quote(dronz.id);
    const saved = await request(app)
      .post("/purchase-simulations")
      .set(headers)
      .send(simulation(mac.id, q.id, { parametroEconomicoId: v1.body.id }));
    expect(saved.status).toBe(201);

    await request(app).post("/economic-settings").set(headers).send(settings("20"));
    await quote(dronz.id, 6);
    const loaded = await request(app).get(`/purchase-simulations/${saved.body.id}`).set(headers);
    expect(loaded.body.parametroEconomicoId).toBe(v1.body.id);
    expect(loaded.body.entrada.frete).toEqual({ valorPorKg: "10", moeda: "USD" });
    expect(loaded.body.entrada.cambio).toEqual({ referencia: "5", acrescimo: "0.2" });
    expect(loaded.body.resultado.porUnidade.custo).toBe("546.00");
    const listed = await request(app).get("/purchase-simulations").set(headers);
    expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(saved.body.id);
    expect(await prisma.auditLog.count({ where: { action: "SAVE_PURCHASE_SIMULATION", entityId: saved.body.id } })).toBe(1);
  });

  it("simular e salvar não criam compra, estoque, venda, pagamento ou movimento logístico", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const counts = () =>
      Promise.all([
        prisma.pedidoCompra.count(),
        prisma.pedidoCompraItem.count(),
        prisma.estoque.count(),
        prisma.movimentacaoEstoque.count(),
        prisma.venda.count(),
        prisma.pagamento.count(),
        prisma.alocacaoMala.count(),
        prisma.recebimento.count()
      ]);
    const before = await counts();
    await request(app).post("/purchase-simulations/calculate").set(headers).send(simulation(mac.id, q.id));
    await request(app).post("/purchase-simulations").set(headers).send(simulation(mac.id, q.id));
    expect(await counts()).toEqual(before);
  });

  it("envio duplicado com a mesma chave grava uma vez; chave reutilizada com outro conteúdo é conflito", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const keyed = { ...headers, "Idempotency-Key": randomUUID() };
    const [a, b] = await Promise.all([
      request(app).post("/purchase-simulations").set(keyed).send(simulation(mac.id, q.id)),
      request(app).post("/purchase-simulations").set(keyed).send(simulation(mac.id, q.id))
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.simulacaoCompra.count()).toBe(1);
    const conflict = await request(app).post("/purchase-simulations").set(keyed).send(simulation(mac.id, q.id, { quantidade: 4 }));
    expect(conflict.status).toBe(409);
  });

  it("repetir um salvamento já gravado devolve o registro mesmo se o produto foi excluído depois", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const keyed = { ...headers, "Idempotency-Key": randomUUID() };
    const first = await request(app).post("/purchase-simulations").set(keyed).send(simulation(mac.id, q.id));
    expect(first.status).toBe(201);
    await prisma.produto.delete({ where: { id: mac.id } });
    const again = await request(app).post("/purchase-simulations").set(keyed).send(simulation(mac.id, q.id));
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.simulacaoCompra.count()).toBe(1);
    // Sem chave (ou com chave nova) o produto excluído continua sendo recusado.
    expect((await request(app).post("/purchase-simulations").set(headers).send(simulation(mac.id, q.id))).status).toBe(404);
  });

  it("permissões: visualizar calcula mas não salva; sem permissão não acessa", async () => {
    const { dronz } = await stores();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const viewer = await userWith(["SIMULACAO_VISUALIZAR"]);
    expect((await request(viewer.app).post("/purchase-simulations/calculate").set(viewer.headers).send(simulation(mac.id, q.id))).status).toBe(200);
    expect((await request(viewer.app).post("/purchase-simulations").set(viewer.headers).send(simulation(mac.id, q.id))).status).toBe(403);
    const nobody = await userWith(["CATALOGO_VISUALIZAR"]);
    expect((await request(nobody.app).post("/purchase-simulations/calculate").set(nobody.headers).send(simulation(mac.id, q.id))).status).toBe(403);
    expect((await request(nobody.app).get("/purchase-simulations").set(nobody.headers)).status).toBe(403);
  });

  it("só a permissão de gerenciar simulações basta para abrir, calcular e salvar", async () => {
    const { dronz } = await stores();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const manager = await userWith(["SIMULACAO_GERENCIAR"]);
    expect((await request(manager.app).get("/economic-settings").set(manager.headers)).status).toBe(200);
    expect((await request(manager.app).get("/economic-settings/exchange-rate").set(manager.headers)).status).toBe(200);
    expect((await request(manager.app).post("/purchase-simulations/calculate").set(manager.headers).send(simulation(mac.id, q.id))).status).toBe(200);
    expect((await request(manager.app).post("/purchase-simulations").set(manager.headers).send(simulation(mac.id, q.id))).status).toBe(201);
    expect((await request(manager.app).post("/economic-settings").set(manager.headers).send(settings())).status).toBe(403);
  });

  it("simulação de outra loja não é encontrada", async () => {
    const { dronz, gooder } = await stores();
    const { app, headers } = await admin(dronz.id);
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const saved = await request(app).post("/purchase-simulations").set(headers).send(simulation(mac.id, q.id));
    const other = await request(app).get(`/purchase-simulations/${saved.body.id}`).set({ ...headers, "x-store-id": gooder.id });
    expect(other.status).toBe(404);
    const otherList = await request(app).get("/purchase-simulations").set({ ...headers, "x-store-id": gooder.id });
    expect(otherList.body).toMatchObject({ items: [], total: 0 });
  });

  it("taxa de marketplace ainda não informada volta como pendência, com o custo calculado", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const mac = await product(dronz.id, "MacBook");
    const q = await quote(dronz.id);
    const r = await request(app)
      .post("/purchase-simulations/calculate")
      .set(headers)
      .send(
        simulation(mac.id, q.id, {
          venda: { ...simulation(mac.id, q.id).venda, marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: null } }
        })
      );
    expect(r.status).toBe(200);
    expect(r.body.resultado.status).toBe("INCOMPLETO");
    expect(r.body.resultado.porUnidade.custo).toBe("546.00");
    expect(r.body.resultado.porUnidade.lucro).toBeNull();
    const informedWithoutPlan = await request(app)
      .post("/purchase-simulations/calculate")
      .set(headers)
      .send(
        simulation(mac.id, q.id, {
          venda: { ...simulation(mac.id, q.id).venda, marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: null, percentual: "16" } }
        })
      );
    expect(informedWithoutPlan.status).toBe(400);
  });

  it("produto livre (ainda sem cadastro) e cotação informada também são simuláveis", async () => {
    const { app, headers } = await admin();
    const r = await request(app)
      .post("/purchase-simulations/calculate")
      .set(headers)
      .send(
        simulation("x", "x", {
          produtoId: null,
          produtoNome: "Item novo",
          cambio: { origem: "INFORMADA", referencia: "5", acrescimo: "0.20", fonte: "Cotação do dia" }
        })
      );
    expect(r.status).toBe(200);
    expect(r.body.entrada.produto).toEqual({ id: null, nome: "Item novo", codigo: null });
    expect(r.body.entrada.cambioOrigem).toEqual({ origem: "INFORMADA", fonte: "Cotação do dia" });
    expect(r.body.resultado.porUnidade.compra).toBe("520.00");
  });

  it("lista paginada: simulações antigas continuam acessíveis depois de muitas gravações", async () => {
    const { dronz } = await stores();
    const { app, headers } = await admin();
    const adminUser = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const base = Date.UTC(2026, 9, 1);
    await prisma.simulacaoCompra.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        lojaId: dronz.id,
        nome: `Simulação ${index + 1}`,
        produtoNome: "Item",
        entrada: {},
        resultado: { total: {} },
        criadoPorId: adminUser.id,
        createdAt: new Date(base + index * 60_000)
      }))
    });
    const first = await request(app).get("/purchase-simulations").query({ page: 1, limit: 50 }).set(headers);
    expect(first.body).toMatchObject({ total: 51, page: 1, limit: 50 });
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].nome).toBe("Simulação 51");
    const second = await request(app).get("/purchase-simulations").query({ page: 2, limit: 50 }).set(headers);
    expect(second.body.items.map((item: { nome: string }) => item.nome)).toEqual(["Simulação 1"]);
    expect((await request(app).get("/purchase-simulations").query({ limit: 101 }).set(headers)).status).toBe(400);
  });

  it("acréscimo vazio em cotação informada é pendência; zero só quando informado", async () => {
    const { app, headers } = await admin();
    const informed = (acrescimo: string | null) =>
      request(app)
        .post("/purchase-simulations/calculate")
        .set(headers)
        .send(simulation("x", "x", { produtoId: null, produtoNome: "Item", cambio: { origem: "INFORMADA", referencia: "5", acrescimo, fonte: null } }));
    const pending = await informed(null);
    expect(pending.status).toBe(200);
    expect(pending.body.resultado.status).toBe("INCOMPLETO");
    expect(pending.body.resultado.pendencias.map((p: { campo: string }) => p.campo)).toContain("cambio.acrescimo");
    expect(pending.body.resultado.porUnidade.compra).toBeNull();
    expect(pending.body.resultado.cambio).toBeNull();
    const zero = await informed("0");
    expect(zero.body.resultado.porUnidade.compra).toBe("500.00");
    expect(zero.body.resultado.cambio.operacional).toBe("5.000000");
  });
});
