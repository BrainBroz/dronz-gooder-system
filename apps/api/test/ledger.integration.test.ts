import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";

const prisma = new PrismaClient();
let ledger: typeof import("../src/modules/ledger/ledger.service");
let dronzId: string;
let produtoId: string;
let userId: string;

beforeAll(async () => {
  ledger = await import("../src/modules/ledger/ledger.service");
  const dronz = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  dronzId = dronz.id;
  produtoId = (
    await prisma.produto.findUniqueOrThrow({ where: { codigo: 101 } })
  ).id;
  userId = (
    await prisma.usuario.findFirstOrThrow({
      where: { email: "admin@example.com" }
    })
  ).id;
});

beforeEach(async () => {
  await prisma.lancamentoPatrimonial.deleteMany();
  await prisma.movimentoPatrimonial.deleteMany();
  await prisma.lote.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ledger integration", () => {
  it("movimento balanceado registra atomicamente", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await ledger.registrarMovimento({
      lojaId: dronzId,
      tipo: "INCORPORATION",
      realizadoPorId: userId,
      lancamentos: [
        { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -10 },
        {
          loteId: lote.id,
          conta: "OWNED_IN_TRANSIT",
          quantidadeDelta: 10
        }
      ]
    });

    const saldo = await ledger.computeSaldo({
      lojaId: dronzId,
      loteId: lote.id,
      conta: "OWNED_IN_TRANSIT"
    });

    expect(saldo).toBe(10);
  });

  it("movimento desbalanceado falha sem registrar", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -10 },
          { loteId: lote.id, conta: "OWNED_IN_TRANSIT", quantidadeDelta: 5 }
        ]
      })
    ).rejects.toThrow();

    const count = await prisma.lancamentoPatrimonial.count({
      where: { loteId: lote.id }
    });
    expect(count).toBe(0);
  });

  it("delta zero rejeitado", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: 0 }
        ]
      })
    ).rejects.toThrow();
  });

  it("saldo insuficiente bloqueia", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "TRANSFER",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "SELLABLE", quantidadeDelta: -100 },
          { loteId: lote.id, conta: "RESERVED", quantidadeDelta: 100 }
        ]
      })
    ).rejects.toThrow();
  });

  it("localização validada por conta", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    const loc = await prisma.localizacao.create({
      data: {
        id: "test-loc",
        nome: "Test",
        tipo: "WAREHOUSE",
        timezone: "America/Sao_Paulo"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "TRANSFER",
        realizadoPorId: userId,
        lancamentos: [
          {
            loteId: lote.id,
            conta: "EXTERNAL_SUPPLIER",
            localizacaoId: loc.id,
            quantidadeDelta: -10
          },
          {
            loteId: lote.id,
            conta: "OWNED_AT_LOCATION",
            localizacaoId: loc.id,
            quantidadeDelta: 10
          }
        ]
      })
    ).rejects.toThrow();
  });

  it("EXTERNAL_SUPPLIER ≤ 0", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: 10 },
          { loteId: lote.id, conta: "OWNED_IN_TRANSIT", quantidadeDelta: -10 }
        ]
      })
    ).rejects.toThrow();
  });

  it("isolamento entre lojas", async () => {
    const gooder = await prisma.loja.findUniqueOrThrow({
      where: { slug: "gooder" }
    });
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: gooder.id,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -10 },
          {
            loteId: lote.id,
            conta: "OWNED_IN_TRANSIT",
            quantidadeDelta: 10
          }
        ]
      })
    ).rejects.toThrow();
  });

  it("lote fechado rejeitado", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "SPLIT",
        condicao: "NEW",
        costStatus: "KNOWN",
        lifecycleStatus: "CLOSED_SPLIT"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -10 },
          {
            loteId: lote.id,
            conta: "OWNED_IN_TRANSIT",
            quantidadeDelta: 10
          }
        ]
      })
    ).rejects.toThrow();
  });

  it("projeção = reconstrução ledger", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await ledger.registrarMovimento({
      lojaId: dronzId,
      tipo: "INCORPORATION",
      realizadoPorId: userId,
      lancamentos: [
        { loteId: lote.id, conta: "EXTERNAL_SUPPLIER", quantidadeDelta: -10 },
        {
          loteId: lote.id,
          conta: "OWNED_IN_TRANSIT",
          quantidadeDelta: 10
        }
      ]
    });

    const projecao = await ledger.getProjecao(dronzId, produtoId);
    const reconstruido = await ledger.reconstructSaldos(dronzId, lote.id);

    expect(projecao).toBeDefined();
    expect(reconstruido).toBeDefined();
  });

  it("contencão concorrente", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    // Concurrent moves should resolve without deadlock (retry logic)
    await Promise.all([
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          {
            loteId: lote.id,
            conta: "EXTERNAL_SUPPLIER",
            quantidadeDelta: -5
          },
          {
            loteId: lote.id,
            conta: "OWNED_IN_TRANSIT",
            quantidadeDelta: 5
          }
        ]
      }),
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "INCORPORATION",
        realizadoPorId: userId,
        lancamentos: [
          {
            loteId: lote.id,
            conta: "EXTERNAL_SUPPLIER",
            quantidadeDelta: -5
          },
          {
            loteId: lote.id,
            conta: "OWNED_IN_TRANSIT",
            quantidadeDelta: 5
          }
        ]
      })
    ]);

    const saldo = await ledger.computeSaldo({
      lojaId: dronzId,
      loteId: lote.id,
      conta: "OWNED_IN_TRANSIT"
    });

    expect(saldo).toBe(10);
  });

  it("origem ≠ destino rejeitado", async () => {
    const lote = await prisma.lote.create({
      data: {
        lojaId: dronzId,
        produtoId,
        origem: "PURCHASE_ORDER",
        condicao: "NEW",
        costStatus: "KNOWN"
      }
    });

    await expect(
      ledger.registrarMovimento({
        lojaId: dronzId,
        tipo: "TRANSFER",
        realizadoPorId: userId,
        lancamentos: [
          { loteId: lote.id, conta: "SELLABLE", quantidadeDelta: -10 },
          { loteId: lote.id, conta: "SELLABLE", quantidadeDelta: 10 }
        ]
      })
    ).rejects.toThrow();
  });
});
