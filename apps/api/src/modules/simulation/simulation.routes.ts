import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireStore, type AuthenticatedRequest } from "../../middlewares/auth";
import * as s from "./simulation.service";

export const simulationRouter = Router();
simulationRouter.use(requireAuth, requireStore);

const w =
  (fn: (r: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (r: AuthenticatedRequest, x: Response, n: (e?: unknown) => void) => {
    try {
      x.status(status).json(await fn(r));
    } catch (e) {
      n(e);
    }
  };

const createSimulacaoSchema = z.object({
  nome: z.string().min(1),
  quantidadeViajantes: z.number().int().positive().default(1),
  riscoEfetivado: z.boolean().default(false),
  tributacaoEfetivadaBrl: z.number().nonnegative().default(0),
  itens: z
    .array(
      z.object({
        nomeItem: z.string().min(1),
        custoUnitario: z.number().nonnegative(),
        quantidade: z.number().int().positive(),
        precoVendaUnitario: z.number().nonnegative(),
        pesoUnitarioKg: z.number().positive(),
        categoriaId: z.string().optional(),
      })
    )
    .min(1),
  custos: z.object({
    comissao: z.number().nonnegative().optional(),
    passagens: z.number().nonnegative().optional(),
    hotel: z.number().nonnegative().optional(),
    carro: z.number().nonnegative().optional(),
    alimentacao: z.number().nonnegative().optional(),
    gasolina: z.number().nonnegative().optional(),
    diversos: z.number().nonnegative().optional(),
  }),
  parametros: z.object({
    custoEnvioPorKgUsd: z.number().positive(),
    cotacaoDolar: z.number().positive(),
  }),
});

simulationRouter.post(
  "/",
  w(
    (r) => {
      const body = createSimulacaoSchema.strict().parse(r.body);
      return s.createSimulacao(r.storeId!, r.identity!.user.id, body.nome, body.quantidadeViajantes, body.riscoEfetivado, body.tributacaoEfetivadaBrl, body.itens, body.custos, body.parametros);
    },
    201
  )
);

simulationRouter.get("/", w((r) => s.listSimulacoes(r.storeId!)));

simulationRouter.get("/:id", w(async (r) => {
  const sim = await s.getSimulacao(r.params.id as string, r.storeId!);
  if (!sim) throw new Error("Simulacao not found");
  return sim;
}));

simulationRouter.post(
  "/:id/atualizar-tributacao",
  w(async (r) => {
    const body = z.object({
      riscoEfetivado: z.boolean(),
      tributacaoEfetivadaBrl: z.number().nonnegative(),
    }).parse(r.body);
    return s.atualizarTributacao(r.params.id as string, r.storeId!, body.riscoEfetivado, body.tributacaoEfetivadaBrl);
  })
);

simulationRouter.delete("/:id", w((r) => s.deleteSimulacao(r.params.id as string, r.storeId!)));

simulationRouter.post(
  "/:id/calcular",
  w(async (r) => {
    const simulacao = await s.getSimulacao(r.params.id as string, r.storeId!);
    if (!simulacao) {
      throw new Error("Simulacao not found");
    }
    const calculo = s.calcularSimulacao(simulacao);
    return {
      id: simulacao.id,
      nome: simulacao.nome,
      quantidadeViajantes: simulacao.quantidadeViajantes,
      calculo: {
        coeficiente: calculo.coeficiente.toString(),
        custoTotalViagem: calculo.custoTotalViagem.toString(),
        projecaoLucroTotal: calculo.projecaoLucroTotal.toString(),
        cotaTotalIsentaUsd: calculo.cotaTotalIsentaUsd.toString(),
        excedenteTributavelUsd: calculo.excedenteTributavelUsd.toString(),
        tributacaoPrevistaUsd: calculo.tributacaoPrevistaUsd.toString(),
        tributacaoPrevistaBrl: calculo.tributacaoPrevistaBrl.toString(),
        riscoDeclarando: calculo.riscoDeclarando.toString(),
        riscoNaoDeclarando: calculo.riscoNaoDeclarando.toString(),
        lucroFinalDeclarando: calculo.lucroFinalDeclarando.toString(),
        lucroFinalNaoDeclarando: calculo.lucroFinalNaoDeclarando.toString(),
        percentualLucroDeclarando: calculo.percentualLucroDeclarando.toFixed(2),
        percentualLucroNaoDeclarando: calculo.percentualLucroNaoDeclarando.toFixed(2),
      },
    };
  })
);
