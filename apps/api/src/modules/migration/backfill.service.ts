import { prisma } from "../../lib/prisma";
import {
  getLocalizacaoAbertura,
  getOrCreateShadowLote,
  MIGRATION_VERSION
} from "./shadow.service";
import { registrarMovimento } from "../ledger/ledger.service";

export async function backfillEstoques(realizadoPorId: string) {
  const estoques = await prisma.estoque.findMany({
    orderBy: { id: "asc" }
  });

  let processados = 0;
  let pulados = 0;

  for (const estoque of estoques) {
    const jaMigrado = await prisma.lote.findFirst({
      where: {
        legacyEntity: "Estoque",
        legacyId: estoque.id,
        migrationVersion: MIGRATION_VERSION
      }
    });
    if (jaMigrado) {
      pulados += 1;
      continue;
    }

    const sellable = estoque.quantidadeFisica - estoque.quantidadeReservada;
    const reservado = estoque.quantidadeReservada;

    await prisma.$transaction(async (tx) => {
      const lote = await getOrCreateShadowLote(tx, {
        lojaId: estoque.lojaId,
        produtoId: estoque.produtoId,
        estoqueId: estoque.id
      });

      if (sellable === 0 && reservado === 0) return;

      const loc = await getLocalizacaoAbertura(tx, estoque.lojaId);
      const lancamentos = [];
      if (sellable > 0) {
        lancamentos.push(
          {
            loteId: lote.id,
            conta: "WRITTEN_OFF" as const,
            quantidadeDelta: -sellable
          },
          {
            loteId: lote.id,
            conta: "SELLABLE" as const,
            localizacaoId: loc.id,
            quantidadeDelta: sellable
          }
        );
      }
      if (reservado > 0) {
        lancamentos.push(
          {
            loteId: lote.id,
            conta: "WRITTEN_OFF" as const,
            quantidadeDelta: -reservado
          },
          {
            loteId: lote.id,
            conta: "RESERVED" as const,
            localizacaoId: loc.id,
            quantidadeDelta: reservado
          }
        );
      }
      await registrarMovimento(
        {
          lojaId: estoque.lojaId,
          tipo: "OPENING_BACKFILL",
          realizadoPorId,
          observacoes: `backfill:${MIGRATION_VERSION}:Estoque:${estoque.id} (abertura vendável autorizada §16)`,
          lancamentos
        },
        tx
      );
    });
    processados += 1;
  }

  return { processados, pulados, total: estoques.length };
}
