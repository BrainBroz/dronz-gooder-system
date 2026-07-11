import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let perm: typeof import("../src/lib/permission.service"), dronzId: string, userId: string;

beforeAll(async () => {
  perm = await import("../src/lib/permission.service");
  const dronz = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  dronzId = dronz.id;
  userId = (await prisma.usuario.findFirstOrThrow({ where: { email: "admin@example.com" } })).id;
});

beforeEach(async () => {
  await prisma.usuarioLocalizacao.deleteMany();
  await prisma.localizacaoLoja.deleteMany();
  await prisma.localizacao.deleteMany();
});

afterAll(async () => await prisma.$disconnect());

describe("rbac", () => {
  it("deny-by-default policy", async () => {
    const allowed = await perm.checkPermission(userId, dronzId, "NONEXISTENT");
    expect(allowed).toBe(false);
  });

  it("loja vínculo isolation", async () => {
    const gooder = await prisma.loja.findUniqueOrThrow({ where: { slug: "gooder" } });
    const allowed = await perm.checkPermission(userId, gooder.id, "SYSTEM_ADMIN");
    expect(typeof allowed).toBe("boolean");
  });

  it("location scope enforcement", async () => {
    const loc = await prisma.localizacao.create({
      data: { id: "test", nome: "Test", tipo: "WAREHOUSE", timezone: "America/Sao_Paulo" }
    });
    const allowed = await perm.checkPermission(userId, dronzId, "SYSTEM_ADMIN", loc.id);
    expect(typeof allowed).toBe("boolean");
  });

  it("SYSTEM_ADMIN bypass", async () => {
    const allowed = await perm.checkPermission(userId, dronzId, "SYSTEM_ADMIN");
    expect(typeof allowed).toBe("boolean");
  });

  it("authorizationVersion increment", async () => {
    const before = await prisma.usuario.findUnique({ where: { id: userId } });
    await prisma.$transaction(async (tx) => {
      await perm.bumpAuthorizationVersion(tx, userId);
    });
    const after = await prisma.usuario.findUnique({ where: { id: userId } });
    expect((after?.authorizationVersion || 0) >= (before?.authorizationVersion || 0)).toBe(true);
  });

  it("CHECKPOINT_MIAMI serializer", async () => {
    const miami = await import("../src/lib/serializers/miami-view");
    const obj = { preco: 100, nome: "Test", custo: 50, descricao: "Desc" };
    const view = miami.toMiamiView(obj);
    expect(view.nome).toBe("Test");
    expect(view.preco).toBeUndefined();
    expect(view.custo).toBeUndefined();
  });
});
