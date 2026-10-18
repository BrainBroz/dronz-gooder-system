import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const users: string[] = [];
const profiles: string[] = [];
const PREFIX = "B16-";

beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  const accounts = { conta: { apelido: { startsWith: PREFIX } } };
  await prisma.conciliacaoFinanceira.deleteMany({
    where: { transacao: accounts }
  });
  await prisma.transacaoFinanceiraFonte.deleteMany({ where: accounts });
  await prisma.despesa.deleteMany({
    where: { descricao: { startsWith: PREFIX } }
  });
  await prisma.lancamentoCartao.deleteMany({ where: { fatura: accounts } });
  await prisma.pagamentoFatura.deleteMany({ where: { fatura: accounts } });
  await prisma.faturaCartao.deleteMany({ where: accounts });
  await prisma.contaFinanceira.deleteMany({
    where: { apelido: { startsWith: PREFIX } }
  });
  const orders = { pedido: { numeroPedido: { startsWith: PREFIX } } };
  await prisma.pagamento.deleteMany({
    where: { ...orders, estornoDeId: { not: null } }
  });
  await prisma.pagamento.deleteMany({ where: orders });
  await prisma.pedidoCompraItem.deleteMany({ where: orders });
  await prisma.pedidoCompra.deleteMany({
    where: { numeroPedido: { startsWith: PREFIX } }
  });
  await prisma.fornecedor.deleteMany({
    where: { nome: `${PREFIX}fornecedor` }
  });
  for (const id of users.splice(0)) {
    await prisma.refreshToken.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
    await prisma.usuarioLoja.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }
  for (const id of profiles.splice(0)) {
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: id } });
    await prisma.perfil.deleteMany({ where: { id } });
  }
});
afterAll(() => prisma.$disconnect());

async function admin() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const store = login.body.stores.find(
    (entry: { slug: string }) => entry.slug === "dronz"
  );
  return {
    app,
    store,
    userId: login.body.user.id as string,
    headers: {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": store.id
    }
  };
}

// Pedido de USD 100 (10 × 10) na Dronz.
async function order(ctx: Awaited<ReturnType<typeof admin>>) {
  const supplier =
    (await prisma.fornecedor.findFirst({
      where: { lojaId: ctx.store.id, nome: `${PREFIX}fornecedor` }
    })) ??
    (await prisma.fornecedor.create({
      data: { lojaId: ctx.store.id, nome: `${PREFIX}fornecedor` }
    }));
  const product = await prisma.produto.findFirstOrThrow({
    where: { lojaId: ctx.store.id }
  });
  const created = await request(ctx.app)
    .post("/purchase-orders")
    .set(ctx.headers)
    .send({
      fornecedorId: supplier.id,
      numeroPedido: `${PREFIX}${randomUUID()}`,
      dataCompra: "2026-10-01",
      itens: [{ produtoId: product.id, quantidade: 10, precoUnitario: 10 }]
    });
  expect(created.status).toBe(201);
  return created.body as { id: string; moeda: string };
}

const pay = (
  ctx: Awaited<ReturnType<typeof admin>>,
  pedidoCompraId: string,
  valor: number,
  extra: Record<string, unknown> = {}
) =>
  request(ctx.app)
    .post("/finance/payments")
    .set(ctx.headers)
    .send({
      pedidoCompraId,
      formaPagamento: "PAYPAL",
      moeda: "USD",
      valor,
      pagoEm: "2026-10-05T12:00:00.000Z",
      ...extra
    });

async function account(
  ctx: Awaited<ReturnType<typeof admin>>,
  body: Record<string, unknown> = { tipo: "PAYPAL" }
) {
  const created = await request(ctx.app)
    .post("/finance/accounts")
    .set(ctx.headers)
    .send({
      apelido: `${PREFIX}${randomUUID()}`,
      moedaPrincipal: "USD",
      ...body
    });
  expect(created.status).toBe(201);
  return created.body as { id: string };
}

describe("financeiro e conciliação (Batch 16)", () => {
  it("40 + 60 quita a obrigação de 100, 1 a mais é rejeitado e reembolso parcial preserva bruto e líquido", async () => {
    const ctx = await admin();
    const o = await order(ctx);
    expect((await pay(ctx, o.id, 40)).body.status).toBe("PARTIAL");
    const second = await pay(ctx, o.id, 60);
    expect(second.body.status).toBe("PAID");
    expect((await pay(ctx, o.id, 1)).status).toBe(409);
    const refund = () =>
      request(ctx.app)
        .post(`/finance/payments/${second.body.id}/refund`)
        .set({ ...ctx.headers, "Idempotency-Key": `refund-${o.id}` })
        .send({ valor: 20 });
    const first = await refund();
    expect(first.status).toBe(201);
    // Replay com a mesma chave não repete o crédito.
    expect((await refund()).body.id).toBe(first.body.id);
    const obligation = await request(ctx.app)
      .get(`/finance/orders/${o.id}/obligation`)
      .set(ctx.headers);
    expect(obligation.body).toMatchObject({
      total: "100.00",
      pago: "100.00",
      reembolsado: "20.00",
      liquido: "80.00",
      restante: "0.00",
      estado: "PAID"
    });
    // Reembolso parcial não marca o pagamento original como REFUNDED nem reabre a dívida.
    expect(
      (
        await prisma.pagamento.findUniqueOrThrow({
          where: { id: second.body.id }
        })
      ).status
    ).toBe("PAID");
    expect((await pay(ctx, o.id, 20)).body.error).toBe("overpayment");
  });

  it("fonte de pagamento já registrado manualmente concilia sem duplicar; replay é idempotente e mudança cria versão", async () => {
    const ctx = await admin();
    const o = await order(ctx);
    const manual = await pay(ctx, o.id, 100);
    const paypal = await account(ctx);
    const source = {
      contaId: paypal.id,
      provider: "PAYPAL",
      transactionId: `TX-${randomUUID()}`,
      tipo: "COMPRA",
      moeda: "usd",
      bruto: 100,
      taxa: 3.2,
      occurredAt: "2026-10-06T10:00:00.000Z"
    };
    const registered = await request(ctx.app)
      .post("/finance/source-transactions")
      .set(ctx.headers)
      .send(source);
    expect(registered.status).toBe(201);
    expect(registered.body.conciliacao).toMatchObject({
      estado: "PENDENTE_REVISAO",
      sugeridoPagamentoId: manual.body.id
    });
    const replay = await request(ctx.app)
      .post("/finance/source-transactions")
      .set(ctx.headers)
      .send(source);
    expect(replay.body).toMatchObject({ replay: true });
    expect(replay.body.transacao.id).toBe(registered.body.transacao.id);
    const confirmed = await request(ctx.app)
      .post(
        `/finance/reconciliations/${registered.body.conciliacao.id}/confirm`
      )
      .set(ctx.headers)
      .send({ pagamentoId: manual.body.id });
    expect(confirmed.body.estado).toBe("CONCILIADO");
    expect(
      await prisma.pagamento.count({ where: { pedidoCompraId: o.id } })
    ).toBe(1);

    // Segunda fonte do mesmo valor: o único candidato já está conciliado.
    const duplicate = await request(ctx.app)
      .post("/finance/source-transactions")
      .set(ctx.headers)
      .send({ ...source, transactionId: `TX-${randomUUID()}` });
    expect(duplicate.body.conciliacao.estado).toBe("POSSIVEL_DUPLICIDADE");
    expect(
      (
        await request(ctx.app)
          .post(
            `/finance/reconciliations/${duplicate.body.conciliacao.id}/confirm`
          )
          .set(ctx.headers)
          .send({ pagamentoId: manual.body.id })
      ).body.error
    ).toBe("payment_already_reconciled");

    // Moeda divergente bloqueia a conciliação.
    const brl = await request(ctx.app)
      .post("/finance/source-transactions")
      .set(ctx.headers)
      .send({ ...source, transactionId: `TX-${randomUUID()}`, moeda: "BRL" });
    expect(brl.body.conciliacao.estado).toBe("SEM_PAGAMENTO_ASSOCIADO");
    expect(
      (
        await request(ctx.app)
          .post(`/finance/reconciliations/${brl.body.conciliacao.id}/confirm`)
          .set(ctx.headers)
          .send({ pagamentoId: manual.body.id })
      ).body.error
    ).toBe("currency_mismatch");

    // Conteúdo alterado: nova versão, anterior preservada, volta para revisão humana.
    const changed = await request(ctx.app)
      .post("/finance/source-transactions")
      .set(ctx.headers)
      .send({ ...source, statusFonte: "REVERSED" });
    expect(changed.body.transacao.versao).toBe(2);
    expect(changed.body.conciliacao).toMatchObject({
      estado: "PENDENTE_REVISAO",
      motivo: "fonte_alterada",
      sugeridoPagamentoId: manual.body.id
    });
    expect(
      (
        await prisma.transacaoFinanceiraFonte.findUniqueOrThrow({
          where: { id: registered.body.transacao.id }
        })
      ).substituidaEm
    ).not.toBeNull();
    const ignored = await request(ctx.app)
      .post(`/finance/reconciliations/${brl.body.conciliacao.id}/ignore`)
      .set(ctx.headers)
      .send({ motivo: "Lançamento de outra empresa" });
    expect(ignored.body.estado).toBe("IGNORADO");
  });

  it("duas fontes concorrentes não conciliam o mesmo pagamento", async () => {
    const ctx = await admin();
    const o = await order(ctx);
    const manual = await pay(ctx, o.id, 100);
    const paypal = await account(ctx);
    const { registerSourceTransaction, confirmReconciliation } =
      await import("../src/modules/finance/ledger.service");
    const sources = await Promise.all(
      [1, 2].map((index) =>
        registerSourceTransaction(ctx.store.id, ctx.userId, {
          contaId: paypal.id,
          provider: "PAYPAL",
          transactionId: `TX-${index}-${randomUUID()}`,
          tipo: "COMPRA",
          moeda: "USD",
          bruto: 100,
          occurredAt: new Date("2026-10-06T10:00:00.000Z")
        }).catch(() => null)
      )
    );
    const ids = sources
      .filter((entry) => entry)
      .map((entry) => entry!.conciliacao!.id);
    const results = await Promise.allSettled(
      ids.map((id) =>
        confirmReconciliation(ctx.store.id, ctx.userId, id, manual.body.id)
      )
    );
    expect(
      await prisma.conciliacaoFinanceira.count({
        where: { pagamentoId: manual.body.id, estado: "CONCILIADO" }
      })
    ).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  });

  it("parcelas de cartão repartem o pagamento sem duplicar custo e a fatura quita por pagamentos parciais", async () => {
    const ctx = await admin();
    const o = await order(ctx);
    const card = await account(ctx, {
      tipo: "CARTAO",
      emissor: "Banco Teste",
      ultimosQuatro: "4242",
      diaFechamento: 31,
      diaVencimento: 10
    });
    const statement = await request(ctx.app)
      .post(`/finance/accounts/${card.id}/statements`)
      .set(ctx.headers)
      .send({ ano: 2027, mes: 2 });
    expect(statement.status).toBe(201);
    // Fechamento 31 em fevereiro cai no último dia; vencimento 10 vai para o mês seguinte.
    expect(statement.body).toMatchObject({
      inicio: "2027-02-01T00:00:00.000Z",
      fim: "2027-02-28T00:00:00.000Z",
      vencimento: "2027-03-10T00:00:00.000Z"
    });
    const payment = await pay(ctx, o.id, 90, { formaPagamento: "CREDIT_CARD" });
    const entry = (parcelaNumero: number, valor = 30) =>
      request(ctx.app)
        .post(`/finance/statements/${statement.body.id}/entries`)
        .set(ctx.headers)
        .send({
          tipo: "DEBITO",
          valor,
          data: "2027-02-10T12:00:00.000Z",
          pagamentoId: payment.body.id,
          parcelaNumero,
          parcelaTotal: 3
        });
    expect((await entry(1)).status).toBe(201);
    expect((await entry(1)).body.error).toBe("installment_already_posted");
    expect((await entry(2, 61)).body.error).toBe("entry_exceeds_payment");
    expect((await entry(2)).status).toBe(201);
    const paypalPayment = await pay(ctx, o.id, 10);
    expect(
      (
        await request(ctx.app)
          .post(`/finance/statements/${statement.body.id}/entries`)
          .set(ctx.headers)
          .send({
            tipo: "DEBITO",
            valor: 10,
            data: "2027-02-10T12:00:00.000Z",
            pagamentoId: paypalPayment.body.id
          })
      ).body.error
    ).toBe("payment_not_card");
    const closed = await request(ctx.app)
      .post(`/finance/statements/${statement.body.id}/close`)
      .set(ctx.headers);
    expect(closed.body).toMatchObject({
      estado: "FECHADA",
      totais: { debitos: "60.00", saldo: "60.00" }
    });
    const payStatement = (valor: number) =>
      request(ctx.app)
        .post(`/finance/statements/${statement.body.id}/payments`)
        .set(ctx.headers)
        .send({ valor, pagoEm: "2027-03-09T12:00:00.000Z" });
    expect((await payStatement(20)).body.estadoFatura).toBe("FECHADA");
    expect((await payStatement(41)).body.error).toBe("statement_overpayment");
    expect((await payStatement(40)).body.estadoFatura).toBe("QUITADA");
    // O custo da compra continua sendo o pedido; a fatura não criou pagamento nem despesa.
    const obligation = await request(ctx.app)
      .get(`/finance/orders/${o.id}/obligation`)
      .set(ctx.headers);
    expect(obligation.body).toMatchObject({ pago: "100.00", estado: "PAID" });
    const statementPayment = await prisma.pagamentoFatura.findFirstOrThrow({
      where: { faturaId: statement.body.id }
    });
    const expense = (impacto: string) =>
      request(ctx.app)
        .post("/finance/expenses")
        .set(ctx.headers)
        .send({
          categoria: "OPERACIONAL",
          impacto,
          descricao: `${PREFIX}quitação de fatura`,
          valor: 20,
          moeda: "USD",
          dataDespesa: "2027-03-09T12:00:00.000Z",
          origemTipo: "PAGAMENTO_FATURA",
          origemId: statementPayment.id
        });
    expect((await expense("DESPESA_RESULTADO")).body.error).toBe(
      "expense_double_counting"
    );
    expect((await expense("TRANSFERENCIA")).status).toBe(201);
    expect((await expense("TRANSFERENCIA")).body.error).toBe(
      "expense_origin_already_classified"
    );
  });

  it("cartão exige últimos quatro dígitos e cada escrita exige sua capacidade", async () => {
    const ctx = await admin();
    expect(
      (
        await request(ctx.app)
          .post("/finance/accounts")
          .set(ctx.headers)
          .send({
            tipo: "CARTAO",
            apelido: `${PREFIX}x`,
            moedaPrincipal: "USD",
            ultimosQuatro: "4242424242424242",
            diaFechamento: 1,
            diaVencimento: 10
          })
      ).status
    ).toBe(400);
    const profile = await prisma.perfil.create({
      data: { code: `TEST_${randomUUID()}`, name: "test" }
    });
    profiles.push(profile.id);
    for (const code of ["FINANCEIRO_VISUALIZAR", "FINANCEIRO_REGISTRAR"])
      await prisma.perfilPermissao.create({
        data: {
          perfilId: profile.id,
          permissaoId: (
            await prisma.permissao.findUniqueOrThrow({ where: { code } })
          ).id
        }
      });
    const email = `b16-${randomUUID()}@example.com`;
    const user = await prisma.usuario.create({
      data: {
        name: "B16",
        email,
        passwordHash: await bcrypt.hash("change-me", 12),
        lojas: { create: { lojaId: ctx.store.id } },
        perfis: { create: { perfilId: profile.id } }
      }
    });
    users.push(user.id);
    const login = await request(ctx.app)
      .post("/auth/login")
      .send({ email, password: "change-me" });
    const headers = {
      Authorization: `Bearer ${login.body.accessToken}`,
      "x-store-id": ctx.store.id
    };
    expect(
      (await request(ctx.app).get("/finance/reconciliations").set(headers))
        .status
    ).toBe(200);
    for (const [path, body] of [
      ["/finance/payments/x/refund", { valor: 1 }],
      [
        "/finance/accounts",
        { tipo: "CAIXA", apelido: "x", moedaPrincipal: "BRL" }
      ],
      ["/finance/reconciliations/x/ignore", { motivo: "teste" }],
      ["/finance/expenses", {}]
    ] as const)
      expect(
        (await request(ctx.app).post(path).set(headers).send(body)).status
      ).toBe(403);
  });
});

describe("período da fatura", () => {
  it("fecha no último dia do mês curto e vence no mês correto", async () => {
    const { statementPeriod } =
      await import("../src/modules/finance/ledger.service");
    const iso = (value: ReturnType<typeof statementPeriod>) =>
      Object.fromEntries(
        Object.entries(value).map(([key, date]) => [
          key,
          date.toISOString().slice(0, 10)
        ])
      );
    expect(iso(statementPeriod(2028, 2, 30, 31))).toEqual({
      inicio: "2028-01-31",
      fim: "2028-02-29",
      vencimento: "2028-02-29"
    });
    expect(iso(statementPeriod(2027, 1, 5, 15))).toEqual({
      inicio: "2026-12-06",
      fim: "2027-01-05",
      vencimento: "2027-01-15"
    });
    expect(iso(statementPeriod(2027, 12, 25, 5))).toEqual({
      inicio: "2027-11-26",
      fim: "2027-12-25",
      vencimento: "2028-01-05"
    });
  });
});
