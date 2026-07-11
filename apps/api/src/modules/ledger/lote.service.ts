import { AppError } from "../../lib/app-error";
import type { Tx } from "./ledger.service";

export async function criarLote(
  tx: Tx,
  d: {
    lojaId: string;
    produtoId: string;
    origem: string;
    pedidoCompraItemId?: string;
    condicao?: string;
    costStatus?: string;
    moedaOriginal?: string;
    valorUnitarioOriginal?: string;
  }
) {
  return tx.lote.create({
    data: {
      lojaId: d.lojaId,
      produtoId: d.produtoId,
      origem: d.origem as unknown as typeof import("@prisma/client").LoteOrigem,
      pedidoCompraItemId: d.pedidoCompraItemId,
      condicao: (d.condicao || "UNKNOWN") as unknown as typeof import("@prisma/client").LoteCondicao,
      costStatus: (d.costStatus || "UNKNOWN") as unknown as typeof import("@prisma/client").LoteCostStatus,
      moedaOriginal: d.moedaOriginal,
      valorUnitarioOriginal: d.valorUnitarioOriginal ? parseFloat(d.valorUnitarioOriginal) : undefined
    }
  });
}

export async function splitLote(
  tx: Tx,
  d: {
    loteParentId: string;
    splits: Array<{ quantidade: number; lancamentos?: Record<string, unknown>[] }>;
    realizadoPorId: string;
  }
) {
  const parent = await tx.lote.findUniqueOrThrow({
    where: { id: d.loteParentId }
  });

  // Validate total quantidade
  const totalAllocated = d.splits.reduce((sum, s) => sum + s.quantidade, 0);
  const parentSaldo = await tx.lancamentoPatrimonial.groupBy({
    by: ["conta"],
    where: { loteId: parent.id },
    _sum: { quantidadeDelta: true }
  });
  const totalInParent = parentSaldo.reduce((sum, s) => sum + (s._sum.quantidadeDelta || 0), 0);

  if (Math.abs(totalAllocated - totalInParent) > 0) {
    throw new AppError(409, "split_allocation_mismatch");
  }

  // Mark parent as CLOSED_SPLIT
  await tx.lote.update({
    where: { id: parent.id },
    data: { lifecycleStatus: "CLOSED_SPLIT" }
  });

  // Create children and transfer saldos
  const filhos: { id: string }[] = [];
  for (const split of d.splits) {
    if (split.quantidade === 0) {
      throw new AppError(400, "split_cannot_have_zero");
    }

    const filho = await criarLote(tx, {
      lojaId: parent.lojaId,
      produtoId: parent.produtoId,
      origem: "SPLIT",
      condicao: parent.condicao,
      costStatus: parent.costStatus
    });
    filhos.push({ id: filho.id });

    // Create lineage
    await tx.loteLineage.create({
      data: {
        lojaId: parent.lojaId,
        parentLoteId: parent.id,
        childLoteId: filho.id,
        tipoOperacao: "SPLIT"
      }
    });

    // Transfer saldos proporcionally or explicitly
    if (split.lancamentos && split.lancamentos.length > 0) {
      for (const lanc of split.lancamentos) {
        await tx.lancamentoPatrimonial.create({
          data: {
            lojaId: parent.lojaId,
            produtoId: parent.produtoId,
            loteId: filho.id,
            conta: lanc.conta,
            localizacaoId: lanc.localizacaoId,
            quantidadeDelta: lanc.quantidadeDelta
          }
        });
      }
    } else {
      // Proportional transfer
      for (const saldoBucket of parentSaldo) {
        const proportion = split.quantidade / totalInParent;
        const transferAmount = Math.floor((saldoBucket._sum.quantidadeDelta || 0) * proportion);
        if (transferAmount !== 0) {
          await tx.lancamentoPatrimonial.create({
            data: {
              lojaId: parent.lojaId,
              produtoId: parent.produtoId,
              loteId: filho.id,
              conta: saldoBucket.conta,
              quantidadeDelta: transferAmount
            }
          });
        }
      }
    }
  }

  return filhos;
}

export async function mergeLotes(
  tx: Tx,
  d: {
    lotesParentIds: string[];
    realizadoPorId: string;
  }
) {
  const parents = await tx.lote.findMany({
    where: { id: { in: d.lotesParentIds } }
  });

  if (parents.length < 2) {
    throw new AppError(400, "merge_requires_at_least_two");
  }

  // Validate compatibility
  const first = parents[0];
  for (const p of parents.slice(1)) {
    if (
      p.lojaId !== first.lojaId ||
      p.produtoId !== first.produtoId ||
      p.condicao !== first.condicao ||
      p.costStatus !== first.costStatus ||
      p.origem !== first.origem
    ) {
      throw new AppError(409, "merge_incompatible_lotes");
    }
  }

  // Mark parents as CLOSED_MERGED
  for (const p of parents) {
    await tx.lote.update({
      where: { id: p.id },
      data: { lifecycleStatus: "CLOSED_MERGED" }
    });
  }

  // Create child lote
  const child = await criarLote(tx, {
    lojaId: first.lojaId,
    produtoId: first.produtoId,
    origem: "MERGE",
    condicao: first.condicao,
    costStatus: first.costStatus
  });

  // Create lineage for all parents
  for (const p of parents) {
    await tx.loteLineage.create({
      data: {
        lojaId: first.lojaId,
        parentLoteId: p.id,
        childLoteId: child.id,
        tipoOperacao: "MERGE"
      }
    });
  }

  // Transfere TODOS os buckets de cada pai para o filho, agregados por conta.
  const buckets: { [key: string]: number } = {};

  for (const p of parents) {
    const parentSaldos = await tx.lancamentoPatrimonial.groupBy({
      by: ["conta"],
      where: { loteId: p.id },
      _sum: { quantidadeDelta: true }
    });

    for (const saldo of parentSaldos) {
      const key = saldo.conta;
      buckets[key] = (buckets[key] || 0) + (saldo._sum.quantidadeDelta || 0);
    }
  }

  for (const [conta, total] of Object.entries(buckets)) {
    if (total !== 0) {
      await tx.lancamentoPatrimonial.create({
        data: {
          lojaId: first.lojaId,
          produtoId: first.produtoId,
          loteId: child.id,
          conta: conta,
          quantidadeDelta: total
        }
      });
    }
  }

  return child;
}

export async function reverterFechamento(
  tx: Tx,
  d: {
    loteId: string;
    realizadoPorId: string;
  }
) {
  const lote = await tx.lote.findUniqueOrThrow({
    where: { id: d.loteId }
  });

  if (lote.lifecycleStatus === "ACTIVE") {
    throw new AppError(400, "lote_already_active");
  }

  // Check if any child has moved since closure
  const lineages = await tx.loteLineage.findMany({
    where: { parentLoteId: lote.id }
  });

  for (const lineage of lineages) {
    const childSaldos = await tx.lancamentoPatrimonial.findMany({
      where: { loteId: lineage.childLoteId }
    });
    if (childSaldos.length > 0) {
      throw new AppError(409, "cannot_revert_moved_child");
    }
  }

  // Restore lote status
  await tx.lote.update({
    where: { id: lote.id },
    data: { lifecycleStatus: "ACTIVE" }
  });

  // Delete lineage records
  await tx.loteLineage.deleteMany({
    where: { parentLoteId: lote.id }
  });
}

export async function getLineage(tx: Tx, loteId: string) {
  return tx.loteLineage.findMany({
    where: { OR: [{ parentLoteId: loteId }, { childLoteId: loteId }] }
  });
}
