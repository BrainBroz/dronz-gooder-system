import { prisma } from "../../lib/prisma";

export type Divergencia = {
  produtoId: string;
  campo: "fisico" | "reservado" | "disponivel" | "quarentena";
  legado: number;
  ledger: number;
};

export async function reconciliar(lojaId: string) {
  const estoques = await prisma.estoque.findMany({ where: { lojaId } });
  const divergencias: Divergencia[] = [];

  for (const estoque of estoques) {
    const grupos = await prisma.lancamentoPatrimonial.groupBy({
      by: ["conta"],
      where: { lojaId, produtoId: estoque.produtoId },
      _sum: { quantidadeDelta: true }
    });
    const saldo = (conta: string) =>
      grupos.find((g) => g.conta === conta)?._sum.quantidadeDelta ?? 0;

    const sellable = saldo("SELLABLE");
    const reserved = saldo("RESERVED");
    const quarantine = saldo("QUARANTINE");

    if (estoque.quantidadeFisica !== sellable + reserved)
      divergencias.push({
        produtoId: estoque.produtoId,
        campo: "fisico",
        legado: estoque.quantidadeFisica,
        ledger: sellable + reserved
      });
    if (estoque.quantidadeReservada !== reserved)
      divergencias.push({
        produtoId: estoque.produtoId,
        campo: "reservado",
        legado: estoque.quantidadeReservada,
        ledger: reserved
      });
    const disponivelLegado =
      estoque.quantidadeFisica - estoque.quantidadeReservada;
    if (disponivelLegado !== sellable)
      divergencias.push({
        produtoId: estoque.produtoId,
        campo: "disponivel",
        legado: disponivelLegado,
        ledger: sellable
      });
    if (quarantine !== 0)
      divergencias.push({
        produtoId: estoque.produtoId,
        campo: "quarentena",
        legado: 0,
        ledger: quarantine
      });
  }

  const relatorio = {
    lojaId,
    timestamp: new Date().toISOString(),
    comparados: estoques.length,
    divergencias,
    integro: divergencias.length === 0
  };

  await prisma.auditLog.create({
    data: {
      lojaId,
      action: "ledger.reconciliation",
      entity: "Estoque",
      data: {
        comparados: relatorio.comparados,
        divergentes: divergencias.length,
        integro: relatorio.integro,
        divergencias: divergencias.slice(0, 50) as object[]
      }
    }
  });

  return relatorio;
}

export async function metricasShadow(lojaId: string) {
  const porTipo = await prisma.movimentoPatrimonial.groupBy({
    by: ["tipo"],
    where: { lojaId },
    _count: { _all: true }
  });
  const ultimaReconciliacao = await prisma.auditLog.findFirst({
    where: { lojaId, action: "ledger.reconciliation" },
    orderBy: { createdAt: "desc" }
  });
  return {
    lojaId,
    movimentosPorTipo: Object.fromEntries(
      porTipo.map((t) => [t.tipo, t._count._all])
    ),
    ultimaReconciliacao: ultimaReconciliacao
      ? {
          em: ultimaReconciliacao.createdAt,
          resumo: ultimaReconciliacao.data
        }
      : null
  };
}
