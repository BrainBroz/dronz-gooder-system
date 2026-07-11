import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let backfill: typeof import("../src/modules/migration/backfill.service"), recon: typeof import("../src/modules/migration/reconciliation.service"), inventory: typeof import("../src/modules/inventory/inventory.service"), dronzId: string, produtoId: string, userId: string, estoqueId: string;

beforeAll(async () => {
  backfill = await import("../src/modules/migration/backfill.service");
  recon = await import("../src/modules/migration/reconciliation.service");
  inventory = await import("../src/modules/inventory/inventory.service");
  const dronz = await prisma.loja.findUniqueOrThrow({ where: { slug: "dronz" } });
  dronzId = dronz.id;
  produtoId = (await prisma.produto.findUniqueOrThrow({ where: { codigo: 101 } })).id;
  userId = (await prisma.usuario.findFirstOrThrow({ where: { email: "admin@example.com" } })).id;
  const loc = await prisma.localizacao.upsert({
    where: { id: "seed-loc-brasil-dronz" },
    update: { nome: "Abertura Brasil", ativo: true },
    create: { id: "seed-loc-brasil-dronz", nome: "Abertura Brasil", tipo: "WAREHOUSE", timezone: "America/Sao_Paulo", pais: "BR", ownerLojaId: dronzId }
  });
  await prisma.localizacaoLoja.upsert({
    where: { localizacaoId_lojaId: { localizacaoId: loc.id, lojaId: dronzId } },
    update: {},
    create: { localizacaoId: loc.id, lojaId: dronzId }
  });
  estoqueId = (await prisma.estoque.findUniqueOrThrow({ where: { lojaId_produtoId: { lojaId: dronzId, produtoId } } })).id;
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "ledger." } } });
  await prisma.idempotencyRecord.deleteMany();
  await prisma.loteLineage.deleteMany();
  await prisma.lancamentoPatrimonial.deleteMany();
  await prisma.saldoLoteLocalizacao.deleteMany();
  await prisma.lote.deleteMany();
  await prisma.movimentoPatrimonial.deleteMany();
  await prisma.movimentacaoEstoque.deleteMany();
  await prisma.estoque.updateMany({ data: { quantidadeFisica: 0, quantidadeReservada: 0 } });
});

afterAll(async () => await prisma.$disconnect());

describe("migration", () => {
  it("backfill com SELLABLE/RESERVED corretos e idempotência", async () => {
    await prisma.estoque.update({ where: { id: estoqueId }, data: { quantidadeFisica: 5, quantidadeReservada: 2 } });
    const primeira = await backfill.backfillEstoques(userId);
    expect(primeira.processados).toBeGreaterThan(0);
    const segunda = await backfill.backfillEstoques(userId);
    expect(segunda.processados).toBe(0);
  });

  it("shadow write com flag ligada espelha ledger", async () => {
    await prisma.estoque.update({ where: { id: estoqueId }, data: { quantidadeFisica: 5 } });
    await backfill.backfillEstoques(userId);
    process.env.LEDGER_SHADOW_WRITE = "true";
    await inventory.move(dronzId, userId, { produtoId, tipo: "RESERVE", motivo: "RESERVATION", quantidade: 2 });
    const relatorio = await recon.reconciliar(dronzId);
    expect(relatorio.integro).toBe(true);
    delete process.env.LEDGER_SHADOW_WRITE;
  });

  it("shadow write com flag desligada não escreve", async () => {
    await prisma.estoque.update({ where: { id: estoqueId }, data: { quantidadeFisica: 5 } });
    delete process.env.LEDGER_SHADOW_WRITE;
    await inventory.move(dronzId, userId, { produtoId, tipo: "RESERVE", motivo: "RESERVATION", quantidade: 1 });
    expect(await prisma.movimentoPatrimonial.count()).toBe(0);
  });

  it("rollback conjunto (falha ledger reverte legado)", async () => {
    await prisma.estoque.update({ where: { id: estoqueId }, data: { quantidadeFisica: 5 } });
    await backfill.backfillEstoques(userId);
    process.env.LEDGER_SHADOW_WRITE = "true";
    const lote = await prisma.lote.findFirstOrThrow({ where: { legacyEntity: "Estoque", legacyId: estoqueId } });
    await prisma.lancamentoPatrimonial.deleteMany({ where: { loteId: lote.id } });
    await expect(inventory.move(dronzId, userId, { produtoId, tipo: "EXIT", motivo: "SALE", quantidade: 4 })).rejects.toThrow();
    const estoque = await prisma.estoque.findUniqueOrThrow({ where: { id: estoqueId } });
    expect(estoque.quantidadeFisica).toBe(5);
    delete process.env.LEDGER_SHADOW_WRITE;
  });
});
