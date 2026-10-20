import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
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

beforeEach(async () => {
  await prisma.produto.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await prisma.categoria.deleteMany({ where: { slug: { startsWith: "test-" } } });
});

afterAll(async () => {
  await prisma.produto.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await prisma.categoria.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await prisma.$disconnect();
});

async function login() {
  const app = createApp();
  const response = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  return { app, response };
}

function cookieValue(setCookieHeader: string | string[] | undefined) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw ? raw.split(";")[0] : "";
}

describe("catalog integration", () => {
  it("cria, lista e edita categorias por loja", async () => {
    const { app, response } = await login();
    const cookie = cookieValue(response.headers["set-cookie"]);
    const accessToken = response.body.accessToken;
    const dronz = response.body.stores.find((store: { slug: string }) => store.slug === "dronz");
    const gooder = response.body.stores.find((store: { slug: string }) => store.slug === "gooder");

    const createDronz = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Cookie", cookie)
      .set("x-store-id", dronz.id)
      .send({ nome: "Test Dronz", slug: "test-dronz", ordem: 1, ativo: true });
    const createGooder = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Cookie", cookie)
      .set("x-store-id", gooder.id)
      .send({ nome: "Test Gooder", slug: "test-gooder", ordem: 1, ativo: true });

    expect(createDronz.status).toBe(201);
    expect(createGooder.status).toBe(201);

    const listDronz = await request(app).get("/categories").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    const listGooder = await request(app).get("/categories").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", gooder.id);
    expect(listDronz.body.items.every((item: { lojaId: string }) => item.lojaId === dronz.id)).toBe(true);
    expect(listGooder.body.items.every((item: { lojaId: string }) => item.lojaId === gooder.id)).toBe(true);

    const edited = await request(app)
      .patch(`/categories/${createDronz.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", dronz.id)
      .send({ nome: "Test Dronz Editado" });
    expect(edited.status).toBe(200);

    const toggled = await request(app)
      .patch(`/categories/${createDronz.body.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", dronz.id);
    expect(toggled.status).toBe(200);

    const duplicate = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", dronz.id)
      .send({ nome: "Duplicate", slug: "test-dronz", ordem: 1 });
    expect(duplicate.status).toBe(409);

    const crossAccess = await request(app)
      .get(`/categories/${createGooder.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", dronz.id);
    expect(crossAccess.status).toBe(404);
  });

  it("cria produtos, filtra por categoria e bloqueia acesso cruzado", async () => {
    const { app, response } = await login();
    const accessToken = response.body.accessToken;
    const dronz = response.body.stores.find((store: { slug: string }) => store.slug === "dronz");
    const gooder = response.body.stores.find((store: { slug: string }) => store.slug === "gooder");
    const catDronz = (await request(app).post("/categories").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id).send({ nome: "Cat D", slug: "test-cat-d", ordem: 1 })).body;
    const catGooder = (await request(app).post("/categories").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", gooder.id).send({ nome: "Cat G", slug: "test-cat-g", ordem: 1 })).body;

    const created = await request(app).post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", dronz.id)
      .send({ codigo: 301, nome: "Produto D", slug: "test-prod-d", categoriaId: catDronz.id, precoVenda: 0, markup: 25, ativo: true });
    const createdGooder = await request(app).post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-store-id", gooder.id)
      .send({ codigo: 302, nome: "Produto G", slug: "test-prod-g", categoriaId: catGooder.id, precoVenda: 49.9, markup: 25, ativo: true });

    expect(created.status).toBe(201);
    expect(createdGooder.status).toBe(201);
    expect(String(created.body.precoVenda)).toBe("0");

    const list = await request(app).get("/products").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(list.body.items.every((item: { lojaId: string }) => item.lojaId === dronz.id)).toBe(true);

    const search = await request(app).get("/products?search=Produto").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(search.status).toBe(200);

    const filtered = await request(app).get(`/products?categoriaId=${catDronz.id}`).set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(filtered.body.items.every((item: { categoriaId: string }) => item.categoriaId === catDronz.id)).toBe(true);

    const edited = await request(app).patch(`/products/${created.body.id}`).set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id).send({ nome: "Produto D Editado", markup: 30 });
    expect(edited.status).toBe(200);

    const toggled = await request(app).patch(`/products/${created.body.id}/status`).set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(toggled.status).toBe(200);

    const crossCategory = await request(app).post("/products").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id).send({ codigo: 303, nome: "Cross", slug: "test-cross", categoriaId: catGooder.id, precoVenda: 1, markup: 25 });
    expect(crossCategory.status).toBe(404);

    const crossGet = await request(app).get(`/products/${createdGooder.body.id}`).set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(crossGet.status).toBe(404);

    const invalidPage = await request(app).get("/products?page=0").set("Authorization", `Bearer ${accessToken}`).set("x-store-id", dronz.id);
    expect(invalidPage.status).toBe(400);
  });

  it("importa produtos candidatos por loja, com simulação prévia, sem duplicar e sem tocar em outra loja", async () => {
    const { app, response } = await login();
    const auth = { Authorization: `Bearer ${response.body.accessToken}` };
    const dronz = response.body.stores.find((store: { slug: string }) => store.slug === "dronz");
    const gooder = response.body.stores.find((store: { slug: string }) => store.slug === "gooder");
    const itens = [
      { nome: "Test Armazenamento X", categoria: "Test Eletrônicos" },
      { nome: "Test Câmera Ação", categoria: "Test Eletrônicos" },
      { nome: "Test Suplemento Y", categoria: "Test Suplementos" },
      { nome: "test armazenamento x", categoria: "Test Eletrônicos" },
      { nome: "Test Sem Título", categoria: null }
    ];
    const post = (store: string, query = "") => request(app).post(`/products/import${query}`).set(auth).set("x-store-id", store);

    const dry = await post(dronz.id, "?dryRun=true").send({ itens });
    expect(dry.body).toEqual({ novos: 4, jaExistentes: 0, repetidosNoArquivo: 1, categoriasNovas: 3 });
    expect(await prisma.produto.count({ where: { slug: { startsWith: "test-" } } })).toBe(0);

    const done = await post(dronz.id).send({ itens });
    expect(done.status).toBe(200);
    expect(done.body).toEqual(dry.body);
    const saved = await prisma.produto.findMany({ where: { lojaId: dronz.id, slug: { startsWith: "test-" } }, include: { categoria: true }, orderBy: { slug: "asc" } });
    expect(saved.map((p) => [p.slug, p.categoria.nome])).toEqual([
      ["test-armazenamento-x", "Test Eletrônicos"],
      ["test-camera-acao", "Test Eletrônicos"],
      ["test-sem-titulo", "Sem categoria"],
      ["test-suplemento-y", "Test Suplementos"]
    ]);
    expect(saved.every((p) => !p.ativo && p.precoVenda.toString() === "0" && p.markup.toString() === "30")).toBe(true);
    expect(new Set(saved.map((p) => p.codigo)).size).toBe(4);

    const again = await post(dronz.id).send({ itens });
    expect(again.body).toEqual({ novos: 0, jaExistentes: 4, repetidosNoArquivo: 1, categoriasNovas: 0 });

    const other = await post(gooder.id).send({ itens: [itens[0]] });
    expect(other.body).toMatchObject({ novos: 1, jaExistentes: 0 });
    expect(await prisma.produto.count({ where: { lojaId: dronz.id, slug: { startsWith: "test-" } } })).toBe(4);

    expect((await post(dronz.id).send({ itens: [] })).status).toBe(400);
    await prisma.produto.deleteMany({ where: { slug: { startsWith: "test-" } } });
    await prisma.categoria.deleteMany({ where: { slug: "sem-categoria" } });
  });
});
