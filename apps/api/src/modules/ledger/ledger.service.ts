import {
  ContaPatrimonial,
  MovimentoPatrimonialTipo,
  Prisma
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  assertLancamentosValidos,
  assertSaldoDominio,
  chavesDeLock,
  normalizarLocalizacao
} from "./ledger.rules";

export type Tx = Prisma.TransactionClient;

export type LancamentoInput = {
  loteId: string;
  conta: ContaPatrimonial;
  localizacaoId?: string | null;
  quantidadeDelta: number;
};

export type RegistrarMovimentoInput = {
  lojaId: string;
  tipo: MovimentoPatrimonialTipo;
  realizadoPorId: string;
  observacoes?: string;
  compensaMovimentoId?: string;
  lancamentos: LancamentoInput[];
};

const MAX_RETRIES = 3;
const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]);

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    const pgCode = (error.meta as { code?: string } | undefined)?.code;
    return pgCode !== undefined && RETRYABLE_PG_CODES.has(pgCode);
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Núcleo do ledger (ARQUITETURA_OPERACIONAL_V2 §3.1, §3.4, §5).
 *
 * Registra um MovimentoPatrimonial com seus LancamentoPatrimonial e atualiza a
 * projeção SaldoLoteLocalizacao na MESMA transação. Protocolo obrigatório:
 *   1. advisory locks transacionais por lojaId+produtoId+loteId (ordem determinística);
 *   2. SELECT ... FOR UPDATE nas linhas de saldo afetadas (ordem determinística);
 *   3. validação de invariantes dentro da transação;
 *   4. gravação de movimento, lançamentos e projeções juntos;
 *   5. retry apenas para deadlock/serialização (máx. 3, backoff exponencial + jitter).
 *
 * Aceita uma transação externa (`tx`) para compor com CheckpointEvento (§6.4)
 * e com o shadow write da migração (§16 Fase 2). Nesse caso o retry é do chamador.
 */
export async function registrarMovimento(
  input: RegistrarMovimentoInput,
  tx?: Tx
) {
  if (tx) return executarMovimento(tx, input);

  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(
        (trx) => executarMovimento(trx, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      attempt += 1;
      if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
      const backoff = 2 ** attempt * 25 + Math.floor(Math.random() * 25);
      await sleep(backoff);
    }
  }
}

async function executarMovimento(tx: Tx, input: RegistrarMovimentoInput) {
  const { lojaId, lancamentos } = input;
  if (lancamentos.length === 0) throw new AppError(400, "empty_movement");

  // Carrega e valida lotes (mesma loja; nunca lotes de lojas diferentes — §4.2).
  const loteIds = [...new Set(lancamentos.map((l) => l.loteId))];
  const lotes = await tx.lote.findMany({
    where: { id: { in: loteIds }, lojaId }
  });
  if (lotes.length !== loteIds.length)
    throw new AppError(404, "lote_not_found");
  const loteById = new Map(lotes.map((l) => [l.id, l]));

  assertLancamentosValidos(input, loteById);

  // 1. Advisory locks em ordem lexicográfica determinística (§3.4).
  for (const chave of chavesDeLock(lojaId, lotes)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
  }

  // 2. Lock pessimista das linhas de saldo afetadas, em ordem estável por id.
  await tx.$executeRaw`
    SELECT id FROM "SaldoLoteLocalizacao"
    WHERE "lojaId" = ${lojaId} AND "loteId" IN (${Prisma.join(loteIds)})
    ORDER BY id
    FOR UPDATE`;

  // 3. Grava o fato imutável: movimento + lançamentos.
  const movimento = await tx.movimentoPatrimonial.create({
    data: {
      lojaId,
      tipo: input.tipo,
      realizadoPorId: input.realizadoPorId,
      observacoes: input.observacoes,
      compensaMovimentoId: input.compensaMovimentoId
    }
  });

  await tx.lancamentoPatrimonial.createMany({
    data: lancamentos.map((l) => ({
      lojaId,
      movimentoId: movimento.id,
      loteId: l.loteId,
      produtoId: loteById.get(l.loteId)!.produtoId,
      conta: l.conta,
      localizacaoId: normalizarLocalizacao(l.conta, l.localizacaoId),
      quantidadeDelta: l.quantidadeDelta
    }))
  });

  // 4. Atualiza a projeção agregando deltas por chave (lote, conta, localização).
  const porChave = new Map<
    string,
    { loteId: string; conta: ContaPatrimonial; localizacaoId: string | null; delta: number }
  >();
  for (const l of lancamentos) {
    const localizacaoId = normalizarLocalizacao(l.conta, l.localizacaoId);
    const chave = `${l.loteId}|${l.conta}|${localizacaoId ?? ""}`;
    const atual = porChave.get(chave);
    if (atual) atual.delta += l.quantidadeDelta;
    else
      porChave.set(chave, {
        loteId: l.loteId,
        conta: l.conta,
        localizacaoId,
        delta: l.quantidadeDelta
      });
  }

  const chavesOrdenadas = [...porChave.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  for (const [, item] of chavesOrdenadas) {
    if (item.delta === 0) continue;
    const existente = await tx.saldoLoteLocalizacao.findFirst({
      where: {
        lojaId,
        loteId: item.loteId,
        conta: item.conta,
        localizacaoId: item.localizacaoId
      }
    });
    // 5. Invariante de domínio validado ANTES da escrita, sob lock (§5.1);
    //    o CHECK do banco permanece como rede de segurança final.
    const novoSaldo = (existente?.saldo ?? 0) + item.delta;
    assertSaldoDominio(item.conta, novoSaldo);
    if (existente) {
      await tx.saldoLoteLocalizacao.update({
        where: { id: existente.id },
        data: { saldo: novoSaldo, version: { increment: 1 } }
      });
    } else {
      await tx.saldoLoteLocalizacao.create({
        data: {
          lojaId,
          loteId: item.loteId,
          produtoId: loteById.get(item.loteId)!.produtoId,
          conta: item.conta,
          localizacaoId: item.localizacaoId,
          saldo: novoSaldo
        }
      });
    }
  }

  // 5. Auditoria na MESMA transação (§12/§17): usuário, loja, entidade, resultado.
  await tx.auditLog.create({
    data: {
      usuarioId: input.realizadoPorId,
      lojaId,
      action: "ledger.movimento",
      entity: "MovimentoPatrimonial",
      entityId: movimento.id,
      data: {
        tipo: input.tipo,
        lotes: loteIds,
        lancamentos: lancamentos.length
      }
    }
  });

  return tx.movimentoPatrimonial.findUniqueOrThrow({
    where: { id: movimento.id },
    include: { lancamentos: true }
  });
}

// ─── Comandos (§5.3) ──────────────────────────────────────────────────────────

/** Incorporação patrimonial: EXTERNAL_SUPPLIER -q / OWNED_IN_TRANSIT +q. */
export async function incorporatePatrimony(
  d: {
    lojaId: string;
    loteId: string;
    quantidade: number;
    realizadoPorId: string;
    observacoes?: string;
  },
  tx?: Tx
) {
  assertQuantidadePositiva(d.quantidade);
  return registrarMovimento(
    {
      lojaId: d.lojaId,
      tipo: "INCORPORATION",
      realizadoPorId: d.realizadoPorId,
      observacoes: d.observacoes,
      lancamentos: [
        {
          loteId: d.loteId,
          conta: "EXTERNAL_SUPPLIER",
          quantidadeDelta: -d.quantidade
        },
        {
          loteId: d.loteId,
          conta: "OWNED_IN_TRANSIT",
          quantidadeDelta: d.quantidade
        }
      ]
    },
    tx
  );
}

/** Cancelamento de incorporação: movimento inverso (§5.3). */
export async function cancelIncorporation(
  d: {
    lojaId: string;
    loteId: string;
    quantidade: number;
    realizadoPorId: string;
    observacoes?: string;
    compensaMovimentoId?: string;
  },
  tx?: Tx
) {
  assertQuantidadePositiva(d.quantidade);
  return registrarMovimento(
    {
      lojaId: d.lojaId,
      tipo: "INCORPORATION_CANCEL",
      realizadoPorId: d.realizadoPorId,
      observacoes: d.observacoes,
      compensaMovimentoId: d.compensaMovimentoId,
      lancamentos: [
        {
          loteId: d.loteId,
          conta: "OWNED_IN_TRANSIT",
          quantidadeDelta: -d.quantidade
        },
        {
          loteId: d.loteId,
          conta: "EXTERNAL_SUPPLIER",
          quantidadeDelta: d.quantidade
        }
      ]
    },
    tx
  );
}

/** Transferência entre contas/localizações. Origem e destino não podem ser iguais. */
export async function transfer(
  d: {
    lojaId: string;
    loteId: string;
    quantidade: number;
    contaOrigem: ContaPatrimonial;
    localizacaoOrigemId?: string | null;
    contaDestino: ContaPatrimonial;
    localizacaoDestinoId?: string | null;
    realizadoPorId: string;
    observacoes?: string;
  },
  tx?: Tx
) {
  assertQuantidadePositiva(d.quantidade);
  const origem = `${d.contaOrigem}|${d.localizacaoOrigemId ?? ""}`;
  const destino = `${d.contaDestino}|${d.localizacaoDestinoId ?? ""}`;
  if (origem === destino) throw new AppError(400, "same_origin_destination");
  return registrarMovimento(
    {
      lojaId: d.lojaId,
      tipo: "TRANSFER",
      realizadoPorId: d.realizadoPorId,
      observacoes: d.observacoes,
      lancamentos: [
        {
          loteId: d.loteId,
          conta: d.contaOrigem,
          localizacaoId: d.localizacaoOrigemId,
          quantidadeDelta: -d.quantidade
        },
        {
          loteId: d.loteId,
          conta: d.contaDestino,
          localizacaoId: d.localizacaoDestinoId,
          quantidadeDelta: d.quantidade
        }
      ]
    },
    tx
  );
}

function assertQuantidadePositiva(q: number) {
  if (!Number.isInteger(q) || q <= 0) throw new AppError(400, "bad_quantity");
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Saldo pela fonte de verdade: soma dos lançamentos (§3.1). */
export async function computeSaldo(filtro: {
  lojaId: string;
  loteId?: string;
  produtoId?: string;
  conta?: ContaPatrimonial;
  localizacaoId?: string | null;
}) {
  const agregado = await prisma.lancamentoPatrimonial.aggregate({
    where: {
      lojaId: filtro.lojaId,
      ...(filtro.loteId ? { loteId: filtro.loteId } : {}),
      ...(filtro.produtoId ? { produtoId: filtro.produtoId } : {}),
      ...(filtro.conta ? { conta: filtro.conta } : {}),
      ...(filtro.localizacaoId !== undefined
        ? { localizacaoId: filtro.localizacaoId }
        : {})
    },
    _sum: { quantidadeDelta: true }
  });
  return agregado._sum.quantidadeDelta ?? 0;
}

/**
 * Reconstrói os saldos de um lote a partir do ledger, agrupados por
 * conta+localização — base da reconciliação: se projeção e ledger divergirem,
 * o ledger vence e a projeção é reconstruída (§3.1).
 */
export async function reconstructSaldos(lojaId: string, loteId: string) {
  const grupos = await prisma.lancamentoPatrimonial.groupBy({
    by: ["conta", "localizacaoId"],
    where: { lojaId, loteId },
    _sum: { quantidadeDelta: true }
  });
  return grupos
    .map((g) => ({
      conta: g.conta,
      localizacaoId: g.localizacaoId,
      saldo: g._sum.quantidadeDelta ?? 0
    }))
    .sort((a, b) =>
      `${a.conta}|${a.localizacaoId ?? ""}` < `${b.conta}|${b.localizacaoId ?? ""}`
        ? -1
        : 1
    );
}

/** Leitura da projeção materializada. */
export function getProjecao(lojaId: string, loteId: string) {
  return prisma.saldoLoteLocalizacao.findMany({
    where: { lojaId, loteId },
    orderBy: [{ conta: "asc" }, { localizacaoId: "asc" }]
  });
}

/**
 * Patrimônio atual por produto (§5.2):
 * OWNED_IN_TRANSIT + OWNED_AT_LOCATION + QUARANTINE + SELLABLE + RESERVED + RETURN_IN_TRANSIT.
 */
export async function patrimonioAtual(lojaId: string, produtoId: string) {
  const contas: ContaPatrimonial[] = [
    "OWNED_IN_TRANSIT",
    "OWNED_AT_LOCATION",
    "QUARANTINE",
    "SELLABLE",
    "RESERVED",
    "RETURN_IN_TRANSIT"
  ];
  const agregado = await prisma.lancamentoPatrimonial.aggregate({
    where: { lojaId, produtoId, conta: { in: contas } },
    _sum: { quantidadeDelta: true }
  });
  return agregado._sum.quantidadeDelta ?? 0;
}
