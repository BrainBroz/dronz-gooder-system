import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let loc: typeof import("../src/modules/localizacoes/localizacoes.service"), dronzId: string;

beforeAll(async () => {
  loc = await import("../src/modules/localizacoes/localizacoes.service");
  const dronz = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  dronzId = dronz.id;
});

beforeEach(async () => {
  await prisma.usuarioLocalizacao.deleteMany();
  await prisma.localizacaoLoja.deleteMany();
  await prisma.endereco.deleteMany();
  await prisma.localizacao.deleteMany();
});

afterAll(async () => await prisma.$disconnect());

describe("localizacoes", () => {
  it("timezone IANA validation", async () => {
    const localizacao = await loc.criarLocalizacao({
      nome: "Test",
      tipo: "WAREHOUSE",
      timezone: "America/Sao_Paulo"
    });
    expect(localizacao.timezone).toBe("America/Sao_Paulo");
  });

  it("store-link requirement + isolation", async () => {
    const localizacao = await loc.criarLocalizacao({
      nome: "Test",
      tipo: "WAREHOUSE",
      timezone: "America/Sao_Paulo"
    });
    await loc.vincularLocalizacaoLoja(localizacao.id, dronzId);
    const linked = await prisma.localizacaoLoja.findFirst({
      where: { localizacaoId: localizacao.id, lojaId: dronzId }
    });
    expect(linked).toBeDefined();
  });

  it("owner auto-link", async () => {
    const localizacao = await loc.criarLocalizacao({
      nome: "Test",
      tipo: "WAREHOUSE",
      timezone: "America/Sao_Paulo",
      ownerLojaId: dronzId
    });
    expect(localizacao.ownerLojaId).toBe(dronzId);
  });

  it("address versioning com histórico", async () => {
    const localizacao = await loc.criarLocalizacao({
      nome: "Test",
      tipo: "WAREHOUSE",
      timezone: "America/Sao_Paulo"
    });
    const endereco = await prisma.endereco.create({
      data: {
        localizacaoId: localizacao.id,
        rua: "Rua A",
        cidade: "São Paulo"
      }
    });
    const vigente = await loc.obterEnderecoVigente(localizacao.id);
    expect(vigente?.id).toBe(endereco.id);
  });
});
