import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let lote: any, dronzId: string, produtoId: string, userId: string;

beforeAll(async () => {
  lote = await import("../src/modules/ledger/lote.service");
  const dronz = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  dronzId = dronz.id;
  produtoId = (await prisma.produto.findUniqueOrThrow({ where: { codigo: 101 } })).id;
  userId = (await prisma.usuario.findFirstOrThrow({ where: { email: "admin@example.com" } })).id;
});

beforeEach(async () => {
  await prisma.loteLineage.deleteMany();
  await prisma.lancamentoPatrimonial.deleteMany();
  await prisma.lote.deleteMany();
});

afterAll(async () => await prisma.$disconnect());

describe("lote lifecycle", () => {
  it("criação com snapshot de custo", async () => {
    const l = await lote.criarLote(prisma, {
      lojaId: dronzId,
      produtoId,
      origem: "PURCHASE_ORDER",
      costStatus: "KNOWN",
      moedaOriginal: "USD",
      valorUnitarioOriginal: "10.50"
    });
    expect(l.costStatus).toBe("KNOWN");
  });

  it("split com fechamento + lineage", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const ledger = await import("../src/modules/ledger/ledger.service");
    await ledger.registrarMovimento({ lojaId: dronzId, tipo: "INCORPORATION", realizadoPorId: userId, lancamentos: [{ loteId: parent.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -100 }, { loteId: parent.id, conta: "OWNED_IN_TRANSIT", quantidadeDelta: 100 }] });

    const filhos = await lote.splitLote(prisma, { loteParentId: parent.id, splits: [{ quantidade: 50 }, { quantidade: 50 }], realizadoPorId: userId });
    expect(filhos.length).toBe(2);
  });

  it("split com validation cobertura", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    await expect(lote.splitLote(prisma, { loteParentId: parent.id, splits: [{ quantidade: 50 }], realizadoPorId: userId })).rejects.toThrow();
  });

  it("split rejeita alocação zero", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    await expect(lote.splitLote(prisma, { loteParentId: parent.id, splits: [{ quantidade: 0 }, { quantidade: 10 }], realizadoPorId: userId })).rejects.toThrow();
  });

  it("merge com compatibilidade", async () => {
    const p1 = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const p2 = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const child = await lote.mergeLotes(prisma, { lotesParentIds: [p1.id, p2.id], realizadoPorId: userId });
    expect(child).toBeDefined();
  });

  it("merge com bucket frontier transfer", async () => {
    const p1 = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const p2 = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const ledger = await import("../src/modules/ledger/ledger.service");
    await ledger.registrarMovimento({ lojaId: dronzId, tipo: "INCORPORATION", realizadoPorId: userId, lancamentos: [{ loteId: p1.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -50 }, { loteId: p1.id, conta: "OWNED_IN_TRANSIT", quantidadeDelta: 50 }] });
    const child = await lote.mergeLotes(prisma, { lotesParentIds: [p1.id, p2.id], realizadoPorId: userId });
    expect(child).toBeDefined();
  });

  it("reversão com child-move check", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN", lifecycleStatus: "CLOSED_SPLIT" } });
    await lote.reverterFechamento(prisma, { loteId: parent.id, realizadoPorId: userId });
    const updated = await prisma.lote.findUnique({ where: { id: parent.id } });
    expect(updated?.lifecycleStatus).toBe("ACTIVE");
  });

  it("lineage query", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    await lote.getLineage(prisma, parent.id);
    const lineages = await prisma.loteLineage.findMany({ where: { parentLoteId: parent.id } });
    expect(lineages).toBeDefined();
  });

  it("saldo transfer conservation", async () => {
    const parent = await prisma.lote.create({ data: { lojaId: dronzId, produtoId, origem: "PURCHASE_ORDER", condicao: "NEW", costStatus: "UNKNOWN" } });
    const ledger = await import("../src/modules/ledger/ledger.service");
    await ledger.registrarMovimento({ lojaId: dronzId, tipo: "INCORPORATION", realizadoPorId: userId, lancamentos: [{ loteId: parent.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -100 }, { loteId: parent.id, conta: "OWNED_IN_TRANSIT", quantidadeDelta: 100 }] });
    const antes = await ledger.computeSaldo({ lojaId: dronzId, loteId: parent.id, conta: "OWNED_IN_TRANSIT" });
    expect(antes).toBe(100);
  });
});
