import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  requireReadWrite,
  requireStore,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import * as service from "./finance.service";
import * as ledger from "./ledger.service";

export const financeRouter = Router();
// Leitura exige FINANCEIRO_VISUALIZAR; cada escrita declara sua capacidade (B16) na própria rota.
financeRouter.use(
  requireAuth,
  requireStore,
  requireReadWrite(
    ["FINANCEIRO_VISUALIZAR"],
    [
      "FINANCEIRO_REGISTRAR",
      "FINANCEIRO_REEMBOLSAR",
      "FINANCEIRO_CONCILIAR",
      "FINANCEIRO_DESPESAS",
      "FINANCEIRO_FATURAS"
    ]
  )
);
const can = requirePermission;
const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
const amount = z.number().positive().max(1e15);
const key = (req: AuthenticatedRequest) =>
  typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"]
    : undefined;
const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
financeRouter.get(
  "/payments",
  run((req) => service.listPayments(req.storeId!))
);
financeRouter.get(
  "/orders/:id/obligation",
  run((req) => service.orderObligation(req.storeId!, String(req.params.id)))
);
financeRouter.post(
  "/exchange-rates",
  can("FINANCEIRO_REGISTRAR"),
  run((req) => {
    const d = z
      .object({
        moedaOrigem: z.string().length(3),
        moedaDestino: z.string().length(3),
        valorMercado: z.number().positive(),
        margem: z.number().min(0),
        fonte: z.string().trim().min(1).max(200),
        cotadoEm: z.coerce.date()
      })
      .strict()
      .parse(req.body);
    return service.createExchange(
      req.storeId!,
      req.identity!.user.id,
      d,
      key(req)
    );
  }, 201)
);
financeRouter.post(
  "/payments",
  can("FINANCEIRO_REGISTRAR"),
  run((req) => {
    const d = z
      .object({
        pedidoCompraId: z.string(),
        formaPagamento: z.enum([
          "CREDIT_CARD",
          "PAYPAL",
          "BANK_TRANSFER",
          "CASH",
          "OTHER"
        ]),
        moeda: z.string().length(3),
        valor: z.number().positive(),
        pagoEm: z.coerce.date().optional(),
        referencia: z.string().optional(),
        observacoes: z.string().optional()
      })
      .strict()
      .parse(req.body);
    return service.pay(
      req.storeId!,
      req.identity!.user.id,
      d.pedidoCompraId,
      d,
      key(req)
    );
  }, 201)
);
financeRouter.post(
  "/payments/:id/refund",
  can("FINANCEIRO_REEMBOLSAR"),
  run(
    (req) =>
      service.refund(
        req.storeId!,
        req.identity!.user.id,
        String(req.params.id),
        z.object({ valor: z.number().positive() }).strict().parse(req.body)
          .valor,
        key(req)
      ),
    201
  )
);
financeRouter.put(
  "/orders/:id/costs",
  can("FINANCEIRO_REGISTRAR"),
  run((req) =>
    service.setCosts(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z
        .object({
          cotacaoCambioId: z.string().optional(),
          iofPercentual: z.number().min(0),
          taxas: z.number().min(0),
          custoAdicional: z.number().min(0)
        })
        .strict()
        .parse(req.body),
      key(req)
    )
  )
);

financeRouter.get(
  "/accounts",
  run((req) => ledger.listAccounts(req.storeId!))
);
financeRouter.post(
  "/accounts",
  can("FINANCEIRO_FATURAS"),
  run((req) => {
    const d = z
      .object({
        tipo: z.enum(["PAYPAL", "CARTAO", "BANCO", "CAIXA"]),
        apelido: z.string().trim().min(1).max(80),
        moedaPrincipal: currency,
        referenciaExterna: z.string().trim().max(200).optional(),
        emissor: z.string().trim().max(80).optional(),
        // Só os últimos quatro dígitos: PAN, CVV e tokens nunca entram no sistema.
        ultimosQuatro: z
          .string()
          .regex(/^[0-9]{4}$/)
          .optional(),
        diaFechamento: z.number().int().min(1).max(31).optional(),
        diaVencimento: z.number().int().min(1).max(31).optional(),
        limite: amount.optional()
      })
      .strict()
      .parse(req.body);
    return ledger.createAccount(
      req.storeId!,
      req.identity!.user.id,
      d,
      key(req)
    );
  }, 201)
);
financeRouter.get(
  "/accounts/:id/statements",
  run((req) => ledger.listStatements(req.storeId!, String(req.params.id)))
);
financeRouter.post(
  "/accounts/:id/statements",
  can("FINANCEIRO_FATURAS"),
  run(
    (req) =>
      ledger.openStatement(
        req.storeId!,
        req.identity!.user.id,
        String(req.params.id),
        z
          .object({
            ano: z.number().int().min(2000).max(2100),
            mes: z.number().int().min(1).max(12)
          })
          .strict()
          .parse(req.body),
        key(req)
      ),
    201
  )
);
financeRouter.get(
  "/statements/:id",
  run((req) => ledger.getStatement(req.storeId!, String(req.params.id)))
);
financeRouter.post(
  "/statements/:id/entries",
  can("FINANCEIRO_FATURAS"),
  run((req) => {
    const d = z
      .object({
        tipo: z.enum(["DEBITO", "CREDITO", "TAXA", "AJUSTE"]),
        valor: amount,
        data: z.coerce.date(),
        descricao: z.string().trim().max(500).optional(),
        pagamentoId: z.string().optional(),
        parcelaNumero: z.number().int().min(1).max(48).optional(),
        parcelaTotal: z.number().int().min(1).max(48).optional()
      })
      .strict()
      .refine(
        (v) =>
          (v.parcelaNumero === undefined) === (v.parcelaTotal === undefined) &&
          (v.parcelaNumero ?? 1) <= (v.parcelaTotal ?? 1),
        "invalid_installment"
      )
      .parse(req.body);
    return ledger.addCardEntry(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      d,
      key(req)
    );
  }, 201)
);
financeRouter.post(
  "/statements/:id/close",
  can("FINANCEIRO_FATURAS"),
  run((req) =>
    ledger.closeStatement(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      key(req)
    )
  )
);
financeRouter.post(
  "/statements/:id/payments",
  can("FINANCEIRO_FATURAS"),
  run(
    (req) =>
      ledger.payStatement(
        req.storeId!,
        req.identity!.user.id,
        String(req.params.id),
        z
          .object({
            valor: amount,
            pagoEm: z.coerce.date(),
            contaOrigemId: z.string().optional(),
            referencia: z.string().trim().max(200).optional()
          })
          .strict()
          .parse(req.body),
        key(req)
      ),
    201
  )
);
financeRouter.post(
  "/source-transactions",
  can("FINANCEIRO_CONCILIAR"),
  run(
    (req) =>
      ledger.registerSourceTransaction(
        req.storeId!,
        req.identity!.user.id,
        z
          .object({
            contaId: z.string(),
            provider: z.string().trim().min(1).max(40),
            transactionId: z.string().trim().min(1).max(200),
            tipo: z.enum([
              "COMPRA",
              "TAXA",
              "CONVERSAO",
              "REEMBOLSO",
              "PAGAMENTO_FATURA"
            ]),
            moeda: currency,
            bruto: amount,
            taxa: z.number().min(0).max(1e15).optional(),
            liquido: z.number().min(0).max(1e15).optional(),
            occurredAt: z.coerce.date(),
            statusFonte: z.string().trim().max(80).optional(),
            contraparte: z.string().trim().max(200).optional()
          })
          .strict()
          .parse(req.body)
      ),
    201
  )
);
financeRouter.get(
  "/reconciliations",
  run((req) =>
    ledger.listReconciliations(
      req.storeId!,
      z
        .enum([
          "PENDENTE_REVISAO",
          "CONCILIADO",
          "POSSIVEL_DUPLICIDADE",
          "SEM_PAGAMENTO_ASSOCIADO",
          "IGNORADO"
        ])
        .optional()
        .parse(req.query.estado)
    )
  )
);
financeRouter.post(
  "/reconciliations/:id/confirm",
  can("FINANCEIRO_CONCILIAR"),
  run((req) =>
    ledger.confirmReconciliation(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z.object({ pagamentoId: z.string() }).strict().parse(req.body)
        .pagamentoId,
      key(req)
    )
  )
);
financeRouter.post(
  "/reconciliations/:id/ignore",
  can("FINANCEIRO_CONCILIAR"),
  run((req) =>
    ledger.ignoreReconciliation(
      req.storeId!,
      req.identity!.user.id,
      String(req.params.id),
      z
        .object({ motivo: z.string().trim().min(3).max(500) })
        .strict()
        .parse(req.body).motivo,
      key(req)
    )
  )
);
financeRouter.get(
  "/expenses",
  run((req) => {
    const q = z
      .object({
        inicio: z.coerce.date().optional(),
        fim: z.coerce.date().optional()
      })
      .parse(req.query);
    return ledger.listExpenses(req.storeId!, q.inicio, q.fim);
  })
);
financeRouter.post(
  "/expenses",
  can("FINANCEIRO_DESPESAS"),
  run((req) => {
    const d = z
      .object({
        categoria: z.enum(["PROLABORE", "OPERACIONAL", "REINVESTIMENTO"]),
        impacto: z.enum([
          "DESPESA_RESULTADO",
          "TRANSFERENCIA",
          "CUSTO_AQUISICAO",
          "APLICACAO_CAPITAL"
        ]),
        descricao: z.string().trim().min(1).max(500),
        valor: amount,
        moeda: currency,
        dataDespesa: z.coerce.date(),
        observacoes: z.string().trim().max(1000).optional(),
        origemTipo: z
          .enum(["PEDIDO_COMPRA", "PAGAMENTO", "PAGAMENTO_FATURA"])
          .optional(),
        origemId: z.string().optional()
      })
      .strict()
      .parse(req.body);
    return ledger.createExpense(
      req.storeId!,
      req.identity!.user.id,
      d,
      key(req)
    );
  }, 201)
);
