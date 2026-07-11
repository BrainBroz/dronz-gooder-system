import {
  MovimentacaoEstoqueMotivo,
  MovimentacaoEstoqueTipo
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { flags } from "../../lib/feature-flags";
import { shadowWriteMovimentacao } from "../migration/shadow.service";
export const list = (lojaId: string) =>
  prisma.estoque.findMany({
    where: { lojaId },
    include: { produto: true },
    orderBy: { produto: { nome: "asc" } }
  });
export const movements = (lojaId: string) =>
  prisma.movimentacaoEstoque.findMany({
    where: { lojaId },
    orderBy: { createdAt: "desc" }
  });
export async function move(
  lojaId: string,
  userId: string,
  d: {
    produtoId: string;
    tipo: MovimentacaoEstoqueTipo;
    motivo: MovimentacaoEstoqueMotivo;
    quantidade: number;
    observacoes?: string;
  }
) {
  if (d.quantidade < 1) throw new AppError(400, "bad_request");
  if (
    ["ADJUSTMENT_POSITIVE", "ADJUSTMENT_NEGATIVE"].includes(d.tipo) &&
    !d.observacoes
  )
    throw new AppError(400, "bad_request");
  return prisma.$transaction(async (tx) => {
    const stock = await tx.estoque.findUnique({
      where: { lojaId_produtoId: { lojaId, produtoId: d.produtoId } }
    });
    if (!stock) throw new AppError(404, "not_found");
    let physical = stock.quantidadeFisica,
      reserved = stock.quantidadeReservada;
    switch (d.tipo) {
      case "RESERVE":
        reserved += d.quantidade;
        break;
      case "RELEASE_RESERVATION":
        reserved -= d.quantidade;
        break;
      case "EXIT":
      case "RETURN_EXIT":
        physical -= d.quantidade;
        break;
      case "ADJUSTMENT_POSITIVE":
      case "RETURN_ENTRY":
        physical += d.quantidade;
        break;
      case "ADJUSTMENT_NEGATIVE":
        physical -= d.quantidade;
        break;
      default:
        throw new AppError(409, "conflict");
    }
    if (physical < 0 || reserved < 0 || physical - reserved < 0)
      throw new AppError(409, "insufficient_stock");
    await tx.estoque.update({
      where: { id: stock.id },
      data: { quantidadeFisica: physical, quantidadeReservada: reserved }
    });
    const movimentacao = await tx.movimentacaoEstoque.create({
      data: {
        lojaId,
        produtoId: d.produtoId,
        estoqueId: stock.id,
        tipo: d.tipo,
        motivo: d.motivo,
        quantidade: d.quantidade,
        quantidadeAnterior: stock.quantidadeFisica,
        quantidadePosterior: physical,
        responsavelId: userId,
        observacoes: d.observacoes
      }
    });
    // Shadow write (§16 Fase 2): ledger na MESMA transação — rollback conjunto.
    if (flags.ledgerShadowWrite) {
      await shadowWriteMovimentacao(tx, {
        lojaId,
        produtoId: d.produtoId,
        estoqueId: stock.id,
        tipo: d.tipo,
        motivo: d.motivo,
        quantidade: d.quantidade,
        responsavelId: userId
      });
    }
    return movimentacao;
  });
}
