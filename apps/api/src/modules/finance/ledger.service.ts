import { createHash } from "node:crypto";
import {
  Prisma,
  type DespesaCategoria,
  type ImpactoDespesa,
  type StatusConciliacaoFinanceira,
  type TipoContaFinanceira,
  type TipoLancamentoCartao,
  type TipoTransacaoFonte
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import {
  audit,
  idempotentMutation
} from "../operations/operations.persistence";

// Batch 16: contas, faturas de cartão, fontes externas, conciliação e despesas classificadas.
// Compra, pagamento ao fornecedor, dívida do cartão e pagamento da fatura são relações distintas:
// nenhuma delas cria um segundo custo ou uma segunda despesa do mesmo fato.
const ORIGIN = "API_FINANCE";
const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal.Value[]) =>
  values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0)
  );
const SUGGESTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const lastDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const clampedDate = (year: number, month: number, day: number) => {
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const y = normalized.getUTCFullYear(),
    m = normalized.getUTCMonth() + 1;
  return new Date(Date.UTC(y, m - 1, Math.min(day, lastDay(y, m))));
};

// Regra contratual de dias inexistentes: fechamento/vencimento caem no último dia do mês curto.
// A fatura de `mes` fecha nesse mês; vence no mesmo mês se o dia de vencimento for posterior ao
// fechamento, senão no mês seguinte.
export function statementPeriod(
  ano: number,
  mes: number,
  diaFechamento: number,
  diaVencimento: number
) {
  const fim = clampedDate(ano, mes, diaFechamento);
  const previousClose = clampedDate(ano, mes - 1, diaFechamento);
  const inicio = new Date(previousClose.getTime() + 24 * 60 * 60 * 1000);
  const vencimento = clampedDate(
    ano,
    diaVencimento > diaFechamento ? mes : mes + 1,
    diaVencimento
  );
  return { inicio, fim, vencimento };
}

export const listAccounts = (lojaId: string) =>
  prisma.contaFinanceira.findMany({
    where: { lojaId },
    orderBy: { apelido: "asc" }
  });

export function createAccount(
  lojaId: string,
  userId: string,
  data: {
    tipo: TipoContaFinanceira;
    apelido: string;
    moedaPrincipal: string;
    referenciaExterna?: string;
    emissor?: string;
    ultimosQuatro?: string;
    diaFechamento?: number;
    diaVencimento?: number;
    limite?: number;
  },
  key?: string
) {
  if (
    data.tipo === "CARTAO" &&
    (!data.ultimosQuatro || !data.diaFechamento || !data.diaVencimento)
  )
    throw new AppError(400, "card_fields_required");
  return idempotentMutation({
    lojaId,
    operation: "CREATE_FINANCIAL_ACCOUNT",
    entityId: data.apelido,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      if (
        await tx.contaFinanceira.findFirst({
          where: { lojaId, apelido: data.apelido }
        })
      )
        throw new AppError(409, "account_already_exists");
      const created = await tx.contaFinanceira.create({
        data: {
          lojaId,
          ...data,
          limite: data.limite === undefined ? undefined : money(data.limite)
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_FATURAS",
        action: "CREATE_FINANCIAL_ACCOUNT",
        entity: "ContaFinanceira",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

type StatementWithRelations = Prisma.FaturaCartaoGetPayload<{
  include: { lancamentos: true; pagamentos: true };
}>;

function statementTotals(statement: StatementWithRelations) {
  const debitos = sum(
    statement.lancamentos
      .filter((entry) => entry.tipo !== "CREDITO")
      .map((entry) => entry.valor)
  );
  const creditos = sum(
    statement.lancamentos
      .filter((entry) => entry.tipo === "CREDITO")
      .map((entry) => entry.valor)
  );
  const pagos = sum(statement.pagamentos.map((payment) => payment.valor));
  return {
    debitos: debitos.toFixed(2),
    creditos: creditos.toFixed(2),
    pagos: pagos.toFixed(2),
    saldo: debitos.minus(creditos).minus(pagos).toFixed(2)
  };
}

const withTotals = (statement: StatementWithRelations) => ({
  ...statement,
  totais: statementTotals(statement)
});

export async function listStatements(lojaId: string, contaId: string) {
  const statements = await prisma.faturaCartao.findMany({
    where: { lojaId, contaId },
    include: { lancamentos: true, pagamentos: true },
    orderBy: { inicio: "desc" }
  });
  return statements.map(withTotals);
}

export async function getStatement(lojaId: string, id: string) {
  const statement = await prisma.faturaCartao.findFirst({
    where: { id, lojaId },
    include: {
      lancamentos: { orderBy: { data: "asc" } },
      pagamentos: { orderBy: { pagoEm: "asc" } }
    }
  });
  if (!statement) throw new AppError(404, "not_found");
  return withTotals(statement);
}

export function openStatement(
  lojaId: string,
  userId: string,
  contaId: string,
  data: { ano: number; mes: number },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "OPEN_CARD_STATEMENT",
    entityId: contaId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const account = await tx.contaFinanceira.findFirst({
        where: { id: contaId, lojaId }
      });
      if (!account) throw new AppError(404, "not_found");
      if (account.tipo !== "CARTAO" || account.estado !== "ATIVA")
        throw new AppError(409, "account_not_active_card");
      const period = statementPeriod(
        data.ano,
        data.mes,
        account.diaFechamento!,
        account.diaVencimento!
      );
      if (
        await tx.faturaCartao.findFirst({
          where: { contaId, inicio: period.inicio }
        })
      )
        throw new AppError(409, "statement_already_exists");
      const created = await tx.faturaCartao.create({
        data: { lojaId, contaId, moeda: account.moedaPrincipal, ...period }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_FATURAS",
        action: "OPEN_CARD_STATEMENT",
        entity: "FaturaCartao",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

async function lockedStatement(
  tx: Prisma.TransactionClient,
  lojaId: string,
  id: string
) {
  await tx.$queryRaw`SELECT id FROM "FaturaCartao" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  const statement = await tx.faturaCartao.findFirst({
    where: { id, lojaId },
    include: { lancamentos: true, pagamentos: true }
  });
  if (!statement) throw new AppError(404, "not_found");
  return statement;
}

export function addCardEntry(
  lojaId: string,
  userId: string,
  faturaId: string,
  data: {
    tipo: TipoLancamentoCartao;
    valor: number;
    data: Date;
    descricao?: string;
    pagamentoId?: string;
    parcelaNumero?: number;
    parcelaTotal?: number;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "ADD_CARD_ENTRY",
    entityId: faturaId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const statement = await lockedStatement(tx, lojaId, faturaId);
      if (statement.estado !== "ABERTA")
        throw new AppError(409, "statement_not_open");
      const valor = money(data.valor);
      if (data.pagamentoId) {
        // Lançamento ligado a pagamento de compra: as parcelas repartem esse pagamento e não podem
        // ultrapassá-lo; o custo da compra continua sendo um só.
        await tx.$queryRaw`SELECT id FROM "Pagamento" WHERE id = ${data.pagamentoId} AND "lojaId" = ${lojaId} FOR UPDATE`;
        const payment = await tx.pagamento.findFirst({
          where: { id: data.pagamentoId, lojaId, estornoDeId: null },
          include: { lancamentosCartao: true }
        });
        if (!payment) throw new AppError(404, "payment_not_found");
        if (payment.formaPagamento !== "CREDIT_CARD")
          throw new AppError(409, "payment_not_card");
        if (data.tipo !== "DEBITO")
          throw new AppError(400, "payment_entry_must_be_debit");
        if (payment.moeda !== statement.moeda)
          throw new AppError(409, "currency_mismatch");
        const totals = new Set(
          payment.lancamentosCartao.map((entry) => entry.parcelaTotal ?? 1)
        );
        if (totals.size && !totals.has(data.parcelaTotal ?? 1))
          throw new AppError(409, "installment_plan_mismatch");
        const posted = sum(
          payment.lancamentosCartao.map((entry) => entry.valor)
        );
        if (posted.plus(valor).greaterThan(payment.valor))
          throw new AppError(409, "entry_exceeds_payment");
        if (
          payment.lancamentosCartao.some(
            (entry) => (entry.parcelaNumero ?? 1) === (data.parcelaNumero ?? 1)
          )
        )
          throw new AppError(409, "installment_already_posted");
      }
      const created = await tx.lancamentoCartao.create({
        data: { lojaId, faturaId, ...data, valor }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_FATURAS",
        action: "ADD_CARD_ENTRY",
        entity: "LancamentoCartao",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}

export function closeStatement(
  lojaId: string,
  userId: string,
  faturaId: string,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CLOSE_CARD_STATEMENT",
    entityId: faturaId,
    key,
    payload: {},
    execute: async (tx, correlationId) => {
      const statement = await lockedStatement(tx, lojaId, faturaId);
      if (statement.estado !== "ABERTA")
        throw new AppError(409, "statement_not_open");
      const totals = statementTotals(statement);
      const estado = new Prisma.Decimal(totals.saldo).lessThanOrEqualTo(0)
        ? "QUITADA"
        : "FECHADA";
      await tx.faturaCartao.update({
        where: { id: faturaId },
        data: { estado }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_FATURAS",
        action: "CLOSE_CARD_STATEMENT",
        entity: "FaturaCartao",
        entityId: faturaId,
        correlationId,
        idempotencyKey: key,
        before: { estado: statement.estado },
        after: { estado, totais: totals },
        origin: ORIGIN
      });
      return { ...statement, estado, totais: totals };
    }
  });
}

export function payStatement(
  lojaId: string,
  userId: string,
  faturaId: string,
  data: {
    valor: number;
    pagoEm: Date;
    contaOrigemId?: string;
    referencia?: string;
  },
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "PAY_CARD_STATEMENT",
    entityId: faturaId,
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      const statement = await lockedStatement(tx, lojaId, faturaId);
      if (statement.estado === "QUITADA")
        throw new AppError(409, "statement_already_paid");
      if (
        data.contaOrigemId &&
        !(await tx.contaFinanceira.findFirst({
          where: { id: data.contaOrigemId, lojaId }
        }))
      )
        throw new AppError(404, "account_not_found");
      const valor = money(data.valor);
      const saldo = new Prisma.Decimal(statementTotals(statement).saldo);
      // Excedente seria crédito no cartão; sem contrato de crédito separado, é rejeitado.
      if (valor.greaterThan(saldo))
        throw new AppError(409, "statement_overpayment");
      const created = await tx.pagamentoFatura.create({
        data: { lojaId, faturaId, ...data, valor }
      });
      const estado =
        statement.estado === "FECHADA" && valor.equals(saldo)
          ? "QUITADA"
          : statement.estado;
      if (estado !== statement.estado)
        await tx.faturaCartao.update({
          where: { id: faturaId },
          data: { estado }
        });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_FATURAS",
        action: "PAY_CARD_STATEMENT",
        entity: "PagamentoFatura",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: { ...created, estadoFatura: estado },
        origin: ORIGIN
      });
      return { ...created, estadoFatura: estado };
    }
  });
}

type SourceInput = {
  contaId: string;
  provider: string;
  transactionId: string;
  tipo: TipoTransacaoFonte;
  moeda: string;
  bruto: number;
  taxa?: number;
  liquido?: number;
  occurredAt: Date;
  statusFonte?: string;
  contraparte?: string;
};

// Sugere o pagamento manual equivalente; nunca concilia sozinho (igualdade de valor/data não basta).
async function suggestion(
  tx: Prisma.TransactionClient,
  lojaId: string,
  source: {
    tipo: TipoTransacaoFonte;
    moeda: string;
    bruto: Prisma.Decimal;
    occurredAt: Date;
  }
): Promise<{
  estado: StatusConciliacaoFinanceira;
  sugeridoPagamentoId?: string;
  motivo?: string;
}> {
  if (source.tipo !== "COMPRA" && source.tipo !== "REEMBOLSO")
    return { estado: "SEM_PAGAMENTO_ASSOCIADO", motivo: "tipo_sem_obrigacao" };
  const candidates = await tx.pagamento.findMany({
    where: {
      lojaId,
      moeda: source.moeda,
      valor: source.bruto,
      status: { not: "CANCELLED" },
      estornoDeId: source.tipo === "REEMBOLSO" ? { not: null } : null,
      pagoEm: {
        gte: new Date(source.occurredAt.getTime() - SUGGESTION_WINDOW_MS),
        lte: new Date(source.occurredAt.getTime() + SUGGESTION_WINDOW_MS)
      }
    },
    include: { conciliacoes: { where: { estado: "CONCILIADO" } } },
    orderBy: [{ pagoEm: "asc" }, { id: "asc" }]
  });
  if (!candidates.length) return { estado: "SEM_PAGAMENTO_ASSOCIADO" };
  const free = candidates.filter((payment) => !payment.conciliacoes.length);
  if (!free.length)
    return {
      estado: "POSSIVEL_DUPLICIDADE",
      sugeridoPagamentoId: candidates[0]!.id,
      motivo: "pagamento_ja_conciliado"
    };
  return free.length === 1
    ? { estado: "PENDENTE_REVISAO", sugeridoPagamentoId: free[0]!.id }
    : { estado: "PENDENTE_REVISAO", motivo: "multiplos_candidatos" };
}

export function registerSourceTransaction(
  lojaId: string,
  userId: string,
  data: SourceInput
) {
  const normalized = {
    ...data,
    moeda: data.moeda.toUpperCase(),
    bruto: money(data.bruto).toFixed(2),
    taxa: data.taxa === undefined ? null : money(data.taxa).toFixed(2),
    liquido: data.liquido === undefined ? null : money(data.liquido).toFixed(2),
    occurredAt: data.occurredAt.toISOString(),
    statusFonte: data.statusFonte ?? null,
    contraparte: data.contraparte ?? null
  };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  // A identidade da fonte (conta, provider, transactionId) é a própria chave de idempotência.
  return idempotentMutation({
    lojaId,
    operation: "REGISTER_SOURCE_TRANSACTION",
    entityId: `${data.contaId}:${data.provider}:${data.transactionId}`,
    payload: normalized,
    execute: async (tx, correlationId) => {
      await tx.$queryRaw`SELECT id FROM "ContaFinanceira" WHERE id = ${data.contaId} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const account = await tx.contaFinanceira.findFirst({
        where: { id: data.contaId, lojaId }
      });
      if (!account) throw new AppError(404, "account_not_found");
      const latest = await tx.transacaoFinanceiraFonte.findFirst({
        where: {
          contaId: data.contaId,
          provider: data.provider,
          transactionId: data.transactionId
        },
        include: { conciliacao: true },
        orderBy: { versao: "desc" }
      });
      if (latest?.payloadHash === payloadHash)
        return {
          transacao: latest,
          conciliacao: latest.conciliacao,
          replay: true
        };
      if (latest)
        await tx.transacaoFinanceiraFonte.update({
          where: { id: latest.id },
          data: { substituidaEm: new Date() }
        });
      const created = await tx.transacaoFinanceiraFonte.create({
        data: {
          lojaId,
          contaId: data.contaId,
          provider: data.provider,
          transactionId: data.transactionId,
          versao: (latest?.versao ?? 0) + 1,
          tipo: data.tipo,
          moeda: normalized.moeda,
          bruto: normalized.bruto,
          taxa: normalized.taxa,
          liquido: normalized.liquido,
          occurredAt: data.occurredAt,
          statusFonte: data.statusFonte,
          contraparte: data.contraparte,
          payloadHash
        }
      });
      // Fonte alterada depois de conciliada volta para revisão humana, apontando o vínculo anterior.
      const review =
        latest?.conciliacao?.estado === "CONCILIADO"
          ? {
              estado: "PENDENTE_REVISAO" as const,
              sugeridoPagamentoId: latest.conciliacao.pagamentoId ?? undefined,
              motivo: "fonte_alterada"
            }
          : await suggestion(tx, lojaId, created);
      const conciliacao = await tx.conciliacaoFinanceira.create({
        data: { lojaId, transacaoFonteId: created.id, ...review }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_CONCILIAR",
        action: latest
          ? "VERSION_SOURCE_TRANSACTION"
          : "REGISTER_SOURCE_TRANSACTION",
        entity: "TransacaoFinanceiraFonte",
        entityId: created.id,
        correlationId,
        before: latest ? { id: latest.id, versao: latest.versao } : undefined,
        after: { transacao: created, conciliacao },
        origin: ORIGIN
      });
      return { transacao: created, conciliacao, replay: false };
    }
  });
}

export const listReconciliations = (
  lojaId: string,
  estado?: StatusConciliacaoFinanceira
) =>
  prisma.conciliacaoFinanceira.findMany({
    where: { lojaId, ...(estado ? { estado } : {}) },
    include: {
      transacao: {
        include: { conta: { select: { apelido: true, tipo: true } } }
      },
      pagamento: true
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

async function openReconciliation(
  tx: Prisma.TransactionClient,
  lojaId: string,
  id: string
) {
  await tx.$queryRaw`SELECT id FROM "ConciliacaoFinanceira" WHERE id = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  const item = await tx.conciliacaoFinanceira.findFirst({
    where: { id, lojaId },
    include: { transacao: true }
  });
  if (!item) throw new AppError(404, "not_found");
  if (item.estado === "CONCILIADO" || item.estado === "IGNORADO")
    throw new AppError(409, "reconciliation_already_reviewed");
  if (item.transacao.substituidaEm)
    throw new AppError(409, "source_superseded");
  return item;
}

export function confirmReconciliation(
  lojaId: string,
  userId: string,
  id: string,
  pagamentoId: string,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "CONFIRM_RECONCILIATION",
    entityId: id,
    key,
    payload: { pagamentoId },
    execute: async (tx, correlationId) => {
      const item = await openReconciliation(tx, lojaId, id);
      // Bloqueia o pagamento: duas fontes concorrentes não podem conciliar o mesmo pagamento.
      await tx.$queryRaw`SELECT id FROM "Pagamento" WHERE id = ${pagamentoId} AND "lojaId" = ${lojaId} FOR UPDATE`;
      const payment = await tx.pagamento.findFirst({
        where: { id: pagamentoId, lojaId },
        include: { conciliacoes: { where: { estado: "CONCILIADO" } } }
      });
      if (!payment) throw new AppError(404, "payment_not_found");
      if (payment.moeda !== item.transacao.moeda)
        throw new AppError(409, "currency_mismatch");
      if (!payment.valor.equals(item.transacao.bruto))
        throw new AppError(409, "amount_mismatch");
      if (payment.conciliacoes.some((entry) => entry.id !== id))
        throw new AppError(409, "payment_already_reconciled");
      const updated = await tx.conciliacaoFinanceira.update({
        where: { id },
        data: {
          estado: "CONCILIADO",
          pagamentoId,
          revisadoPorId: userId,
          revisadoEm: new Date()
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_CONCILIAR",
        action: "CONFIRM_RECONCILIATION",
        entity: "ConciliacaoFinanceira",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        before: {
          estado: item.estado,
          sugeridoPagamentoId: item.sugeridoPagamentoId
        },
        after: updated,
        origin: ORIGIN
      });
      return updated;
    }
  });
}

export function ignoreReconciliation(
  lojaId: string,
  userId: string,
  id: string,
  motivo: string,
  key?: string
) {
  return idempotentMutation({
    lojaId,
    operation: "IGNORE_RECONCILIATION",
    entityId: id,
    key,
    payload: { motivo },
    execute: async (tx, correlationId) => {
      const item = await openReconciliation(tx, lojaId, id);
      const updated = await tx.conciliacaoFinanceira.update({
        where: { id },
        data: {
          estado: "IGNORADO",
          motivo,
          revisadoPorId: userId,
          revisadoEm: new Date()
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_CONCILIAR",
        action: "IGNORE_RECONCILIATION",
        entity: "ConciliacaoFinanceira",
        entityId: id,
        correlationId,
        idempotencyKey: key,
        reason: motivo,
        before: { estado: item.estado },
        after: updated,
        origin: ORIGIN
      });
      return updated;
    }
  });
}

export const listExpenses = (lojaId: string, inicio?: Date, fim?: Date) =>
  prisma.despesa.findMany({
    where: {
      lojaId,
      ...(inicio || fim ? { dataDespesa: { gte: inicio, lt: fim } } : {})
    },
    orderBy: { dataDespesa: "desc" },
    take: 500
  });

// Origem vinculada decide o impacto aceitável: compra/pagamento já é custo de aquisição e
// pagamento de fatura só liquida dívida do cartão; nenhum deles vira despesa de resultado.
const ORIGIN_RULES: Record<string, ImpactoDespesa[]> = {
  PEDIDO_COMPRA: ["CUSTO_AQUISICAO"],
  PAGAMENTO: ["CUSTO_AQUISICAO", "TRANSFERENCIA"],
  PAGAMENTO_FATURA: ["TRANSFERENCIA"]
};

export function createExpense(
  lojaId: string,
  userId: string,
  data: {
    categoria: DespesaCategoria;
    impacto: ImpactoDespesa;
    descricao: string;
    valor: number;
    moeda: string;
    dataDespesa: Date;
    observacoes?: string;
    origemTipo?: keyof typeof ORIGIN_RULES;
    origemId?: string;
  },
  key?: string
) {
  if (!!data.origemTipo !== !!data.origemId)
    throw new AppError(400, "expense_origin_incomplete");
  if (data.origemTipo && !ORIGIN_RULES[data.origemTipo]!.includes(data.impacto))
    throw new AppError(409, "expense_double_counting");
  return idempotentMutation({
    lojaId,
    operation: "CREATE_EXPENSE",
    entityId: data.origemId ?? "manual",
    key,
    payload: data,
    execute: async (tx, correlationId) => {
      if (data.origemTipo) {
        const where = { id: data.origemId, lojaId };
        const exists =
          data.origemTipo === "PEDIDO_COMPRA"
            ? await tx.pedidoCompra.findFirst({ where })
            : data.origemTipo === "PAGAMENTO"
              ? await tx.pagamento.findFirst({ where })
              : await tx.pagamentoFatura.findFirst({ where });
        if (!exists) throw new AppError(404, "expense_origin_not_found");
        if (
          await tx.despesa.findFirst({
            where: {
              lojaId,
              origemTipo: data.origemTipo,
              origemId: data.origemId
            }
          })
        )
          throw new AppError(409, "expense_origin_already_classified");
      }
      const created = await tx.despesa.create({
        data: {
          lojaId,
          ...data,
          moeda: data.moeda.toUpperCase(),
          valor: money(data.valor)
        }
      });
      await audit(tx, {
        usuarioId: userId,
        lojaId,
        permissionCode: "FINANCEIRO_DESPESAS",
        action: "CREATE_EXPENSE",
        entity: "Despesa",
        entityId: created.id,
        correlationId,
        idempotencyKey: key,
        after: created,
        origin: ORIGIN
      });
      return created;
    }
  });
}
