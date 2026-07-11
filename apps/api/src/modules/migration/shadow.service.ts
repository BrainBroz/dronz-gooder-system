import {
  MovimentacaoEstoqueMotivo,
  MovimentacaoEstoqueTipo
} from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { registrarMovimento, type Tx } from "../ledger/ledger.service";

export const MIGRATION_VERSION = "v1";

export async function getLocalizacaoAbertura(tx: Tx, lojaId: string) {
  const loc = await tx.localizacao.findFirst({
    where: { ownerLojaId: lojaId, nome: "Abertura Brasil", ativo: true }
  });
  if (!loc) throw new AppError(409, "opening_location_missing");
  return loc;
}

export async function getOrCreateShadowLote(
  tx: Tx,
  d: { lojaId: string; produtoId: string; estoqueId: string }
) {
  const existente = await tx.lote.findFirst({
    where: {
      legacyEntity: "Estoque",
      legacyId: d.estoqueId,
      migrationVersion: MIGRATION_VERSION
    }
  });
  if (existente) return existente;
  return tx.lote.create({
    data: {
      lojaId: d.lojaId,
      produtoId: d.produtoId,
      origem: "OPENING_BALANCE",
      condicao: "UNKNOWN",
      costStatus: "UNKNOWN",
      legacyEntity: "Estoque",
      legacyId: d.estoqueId,
      migrationVersion: MIGRATION_VERSION
    }
  });
}

export async function shadowWriteMovimentacao(
  tx: Tx,
  d: {
    lojaId: string;
    produtoId: string;
    estoqueId: string;
    tipo: MovimentacaoEstoqueTipo;
    motivo: MovimentacaoEstoqueMotivo;
    quantidade: number;
    responsavelId: string;
  }
) {
  const lote = await getOrCreateShadowLote(tx, d);
  const loc = await getLocalizacaoAbertura(tx, d.lojaId);
  const base = {
    lojaId: d.lojaId,
    realizadoPorId: d.responsavelId,
    observacoes: `shadow:${d.tipo}:${d.motivo}`
  };
  const sellable = { conta: "SELLABLE" as const, localizacaoId: loc.id };
  const reserved = { conta: "RESERVED" as const, localizacaoId: loc.id };

  switch (d.tipo) {
    case "ENTRY":
    case "RETURN_ENTRY":
    case "ADJUSTMENT_POSITIVE":
      return registrarMovimento(
        {
          ...base,
          tipo: "ADJUSTMENT_POSITIVE",
          lancamentos: [
            {
              loteId: lote.id,
              conta: "WRITTEN_OFF",
              quantidadeDelta: -d.quantidade
            },
            { loteId: lote.id, ...sellable, quantidadeDelta: d.quantidade }
          ]
        },
        tx
      );
    case "RESERVE":
      return registrarMovimento(
        {
          ...base,
          tipo: "RESERVE",
          lancamentos: [
            { loteId: lote.id, ...sellable, quantidadeDelta: -d.quantidade },
            { loteId: lote.id, ...reserved, quantidadeDelta: d.quantidade }
          ]
        },
        tx
      );
    case "RELEASE_RESERVATION":
      return registrarMovimento(
        {
          ...base,
          tipo: "RESERVE_RELEASE",
          lancamentos: [
            { loteId: lote.id, ...reserved, quantidadeDelta: -d.quantidade },
            { loteId: lote.id, ...sellable, quantidadeDelta: d.quantidade }
          ]
        },
        tx
      );
    case "EXIT":
      if (d.motivo === "SALE") {
        await registrarMovimento(
          {
            ...base,
            tipo: "RESERVE",
            lancamentos: [
              { loteId: lote.id, ...sellable, quantidadeDelta: -d.quantidade },
              { loteId: lote.id, ...reserved, quantidadeDelta: d.quantidade }
            ]
          },
          tx
        );
        return registrarMovimento(
          {
            ...base,
            tipo: "SALE_SETTLEMENT",
            lancamentos: [
              { loteId: lote.id, ...reserved, quantidadeDelta: -d.quantidade },
              { loteId: lote.id, conta: "SOLD", quantidadeDelta: d.quantidade }
            ]
          },
          tx
        );
      }
      if (d.motivo === "DAMAGE" || d.motivo === "LOSS") {
        return registrarMovimento(
          {
            ...base,
            tipo: "LOSS",
            lancamentos: [
              { loteId: lote.id, ...sellable, quantidadeDelta: -d.quantidade },
              { loteId: lote.id, conta: "LOST", quantidadeDelta: d.quantidade }
            ]
          },
          tx
        );
      }
      return ajusteNegativo();
    case "RETURN_EXIT":
    case "ADJUSTMENT_NEGATIVE":
      return ajusteNegativo();
    default:
      throw new AppError(409, "shadow_unsupported_type");
  }

  function ajusteNegativo() {
    return registrarMovimento(
      {
        ...base,
        tipo: "ADJUSTMENT_NEGATIVE",
        lancamentos: [
          { loteId: lote.id, ...sellable, quantidadeDelta: -d.quantidade },
          {
            loteId: lote.id,
            conta: "WRITTEN_OFF",
            quantidadeDelta: d.quantidade
          }
        ]
      },
      tx
    );
  }
}
