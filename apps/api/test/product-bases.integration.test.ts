import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const clean = () => prisma.produtoBase.deleteMany({ where: { slug: { startsWith: "test-" } } });

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

async function admin() {
  const app = createApp();
  const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "change-me" });
  return { app, auth: { Authorization: `Bearer ${login.body.accessToken}` }, stores: login.body.stores as { id: string; slug: string }[] };
}

describe("base geral de produtos", () => {
  it("importa com simulação prévia, completa peso sem sobrescrever e é a mesma para as duas lojas", async () => {
    const { app, auth, stores } = await admin();
    const itens = [
      { nome: "Test Fone A", categoria: "Test Fones", pesoKg: 0.1 },
      { nome: "Test Notebook B", categoria: "Test Notebooks", pesoKg: null },
      { nome: "test fone a", categoria: "Test Fones", pesoKg: 0.2 },
      { nome: "Test Sem Categoria", categoria: null, pesoKg: 1.5 }
    ];
    const post = (query = "", body: object = { itens }) => request(app).post(`/product-bases/import${query}`).set(auth).send(body);

    expect((await post("?dryRun=true")).body).toEqual({ novos: 3, jaExistentes: 0, repetidosNoArquivo: 1, pesosPreenchidos: 0 });
    expect(await prisma.produtoBase.count({ where: { slug: { startsWith: "test-" } } })).toBe(0);
    expect((await post()).body).toEqual({ novos: 3, jaExistentes: 0, repetidosNoArquivo: 1, pesosPreenchidos: 0 });

    // Segunda rodada: o notebook ganha peso; o fone, que já tinha 0.1, não muda.
    const again = await post("", { itens: [{ nome: "Test Notebook B", categoria: null, pesoKg: 2.2 }, { nome: "Test Fone A", categoria: null, pesoKg: 9 }] });
    expect(again.body).toEqual({ novos: 0, jaExistentes: 2, repetidosNoArquivo: 0, pesosPreenchidos: 1 });
    const saved = await prisma.produtoBase.findMany({ where: { slug: { startsWith: "test-" } }, orderBy: { slug: "asc" } });
    expect(saved.map((p) => [p.slug, p.categoria, p.pesoKg?.toString() ?? null])).toEqual([
      ["test-fone-a", "Test Fones", "0.1"],
      ["test-notebook-b", "Test Notebooks", "2.2"],
      ["test-sem-categoria", null, "1.5"]
    ]);

    // Sem loja: o mesmo resultado com o cabeçalho de qualquer loja, e sem cabeçalho.
    const lists = await Promise.all(
      [{}, ...stores.map((store) => ({ "x-store-id": store.id }))].map((headers) =>
        request(app).get("/product-bases?search=Test&limit=200").set(auth).set(headers)
      )
    );
    expect(new Set(lists.map((r) => r.body.total)).size).toBe(1);
    expect(lists[0]!.body.total).toBe(3);
    expect(lists[0]!.body.categorias).toEqual(expect.arrayContaining(["Test Fones", "Test Notebooks"]));
    expect((await request(app).get("/product-bases?semPeso=true&search=Test").set(auth)).body.total).toBe(0);
  });

  it("atualiza peso, categoria e nome; valida entradas e exige login", async () => {
    const { app, auth } = await admin();
    await request(app).post("/product-bases/import").set(auth).send({ itens: [{ nome: "Test Câmera", categoria: null, pesoKg: null }] });
    const item = await prisma.produtoBase.findFirstOrThrow({ where: { slug: "test-camera" } });
    const patch = (body: object) => request(app).patch(`/product-bases/${item.id}`).set(auth).send(body);

    const ok = await patch({ pesoKg: 0.45, categoria: "Test Câmeras" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pesoKg: "0.45", categoria: "Test Câmeras" });
    expect((await patch({ nome: "Test Câmera Pro" })).body.slug).toBe("test-camera-pro");
    expect((await patch({ pesoKg: -1 })).status).toBe(400);
    expect((await patch({ lojaId: "x" })).status).toBe(400);
    expect((await request(app).patch("/product-bases/nao-existe").set(auth).send({ pesoKg: 1 })).status).toBe(404);
    expect((await request(app).post("/product-bases/import").set(auth).send({ itens: [] })).status).toBe(400);
    expect((await request(app).get("/product-bases")).status).toBe(401);
  });
});
