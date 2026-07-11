import { prisma } from "../../lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

// Re-export Decimal para uso externo
export { Decimal };

export interface SimulacaoViagemCalculo {
  coeficiente: Decimal;
  freteUnitarioItem: Map<string, Decimal>;
  freteTotalItem: Map<string, Decimal>;
  custoTotalItem: Map<string, Decimal>;
  projecaoVendaTotalItem: Map<string, Decimal>;
  projecaoLucroItem: Map<string, Decimal>;
  custoTotalViagem: Decimal;
  projecaoLucroTotal: Decimal;
  cotaTotalIsentaUsd: Decimal;
  excedenteTributavelUsd: Decimal;
  tributacaoPrevistaUsd: Decimal;
  tributacaoPrevistaBrl: Decimal;
  riscoDeclarando: Decimal;
  riscoNaoDeclarando: Decimal;
  lucroFinalDeclarando: Decimal;
  lucroFinalNaoDeclarando: Decimal;
  percentualLucroDeclarando: Decimal;
  percentualLucroNaoDeclarando: Decimal;
}

export const createSimulacao = async (
  lojaId: string,
  criadoPorId: string,
  nome: string,
  quantidadeViajantes: number,
  riscoEfetivado: boolean,
  tributacaoEfetivadaBrl: number,
  itens: Array<{
    nomeItem: string;
    custoUnitario: number;
    quantidade: number;
    precoVendaUnitario: number;
    pesoUnitarioKg: number;
    categoriaId?: string;
  }>,
  custos: {
    comissao?: number;
    passagens?: number;
    hotel?: number;
    carro?: number;
    alimentacao?: number;
    gasolina?: number;
    diversos?: number;
  },
  parametros: {
    custoEnvioPorKgUsd: number;
    cotacaoDolar: number;
  }
) => {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const simulacao = await tx.simulacaoViagem.create({
      data: {
        lojaId,
        criadoPorId,
        nome,
        quantidadeViajantes,
        riscoEfetivado,
        tributacaoEfetivadaBrl: new Decimal(tributacaoEfetivadaBrl),
      },
    });

    for (const i of itens) {
      await tx.simulacaoViagemItem.create({
        data: {
          lojaId,
          simulacaoViagemId: simulacao.id,
          nomeItem: i.nomeItem,
          custoUnitario: i.custoUnitario,
          quantidade: i.quantidade,
          precoVendaUnitario: i.precoVendaUnitario,
          pesoUnitarioKg: i.pesoUnitarioKg,
          categoriaId: i.categoriaId,
        },
      });
    }

    await tx.simulacaoViagemCusto.create({
      data: {
        lojaId,
        simulacaoViagemId: simulacao.id,
        comissao: new Decimal(custos.comissao ?? 0),
        passagens: new Decimal(custos.passagens ?? 0),
        hotel: new Decimal(custos.hotel ?? 0),
        carro: new Decimal(custos.carro ?? 0),
        alimentacao: new Decimal(custos.alimentacao ?? 0),
        gasolina: new Decimal(custos.gasolina ?? 0),
        diversos: new Decimal(custos.diversos ?? 0),
      },
    });

    await tx.simulacaoViagemParametro.create({
      data: {
        lojaId,
        simulacaoViagemId: simulacao.id,
        custoEnvioPorKgUsd: new Decimal(parametros.custoEnvioPorKgUsd),
        cotacaoDolar: new Decimal(parametros.cotacaoDolar),
      },
    });

    return tx.simulacaoViagem.findUniqueOrThrow({
      where: { id_lojaId: { id: simulacao.id, lojaId } },
      include: {
        itens: true,
        custo: true,
        parametro: true,
        criadoPor: { select: { id: true, name: true } },
      },
    });
  });
};

export const getSimulacao = (id: string, lojaId: string) =>
  prisma.simulacaoViagem.findUnique({
    where: { id_lojaId: { id, lojaId } },
    include: {
      itens: true,
      custo: true,
      parametro: true,
      criadoPor: { select: { id: true, name: true } },
    },
  });

export const listSimulacoes = (lojaId: string) =>
  prisma.simulacaoViagem.findMany({
    where: { lojaId },
    include: {
      itens: true,
      custo: true,
      parametro: true,
      criadoPor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

export const atualizarTributacao = async (id: string, lojaId: string, riscoEfetivado: boolean, tributacaoEfetivadaBrl: number) =>
  prisma.simulacaoViagem.update({
    where: { id_lojaId: { id, lojaId } },
    data: {
      riscoEfetivado,
      tributacaoEfetivadaBrl: new Decimal(tributacaoEfetivadaBrl),
    },
    include: {
      itens: true,
      custo: true,
      parametro: true,
      criadoPor: { select: { id: true, name: true } },
    },
  });

export const deleteSimulacao = (id: string, lojaId: string) =>
  prisma.simulacaoViagem.delete({
    where: { id_lojaId: { id, lojaId } },
  });

export const calcularSimulacao = (simulacao: {
  itens: Array<{
    custoUnitario: number | Decimal;
    quantidade: number;
    precoVendaUnitario: number | Decimal;
    pesoUnitarioKg: number | Decimal;
  }>;
  custo?: {
    comissao?: number | Decimal | null;
    passagens?: number | Decimal | null;
    hotel?: number | Decimal | null;
    carro?: number | Decimal | null;
    alimentacao?: number | Decimal | null;
    gasolina?: number | Decimal | null;
    diversos?: number | Decimal | null;
  } | null;
  parametro?: {
    custoEnvioPorKgUsd: number | Decimal;
    cotacaoDolar: number | Decimal;
  } | null;
  quantidadeViajantes?: number;
  riscoEfetivado?: boolean;
  tributacaoEfetivadaBrl?: number | Decimal;
}): SimulacaoViagemCalculo => {
  const toDecimal = (val: number | Decimal | undefined): Decimal =>
    val instanceof Decimal ? val : new Decimal(val ?? 0);

  const cotacaoDolar = toDecimal(simulacao.parametro?.cotacaoDolar ?? 5.7);
  const custoEnvioPorKgUsd = toDecimal(simulacao.parametro?.custoEnvioPorKgUsd ?? 46.17);
  const quantidadeViajantes = simulacao.quantidadeViajantes ?? 1;

  const coeficiente = custoEnvioPorKgUsd.times(cotacaoDolar);

  const freteUnitarioItem = new Map<string, Decimal>();
  const freteTotalItem = new Map<string, Decimal>();
  const custoTotalItem = new Map<string, Decimal>();
  const projecaoVendaTotalItem = new Map<string, Decimal>();
  const projecaoLucroItem = new Map<string, Decimal>();

  let custoTotalViagemNum = new Decimal(0);
  let projecaoLucroTotalNum = new Decimal(0);
  let pesoTotalKg = new Decimal(0);

  simulacao.itens.forEach((item, idx) => {
    const custoU = toDecimal(item.custoUnitario);
    const pesoU = toDecimal(item.pesoUnitarioKg);
    const precoVendaU = toDecimal(item.precoVendaUnitario);
    const qtde = new Decimal(item.quantidade);

    const freteU = coeficiente.times(pesoU);
    const freteT = freteU.times(qtde);
    const custoT = custoU.times(qtde);
    const projecaoVendaT = precoVendaU.times(qtde);
    const projecaoLucro = projecaoVendaT.minus(custoT).minus(freteT);

    const itemKey = idx.toString();
    freteUnitarioItem.set(itemKey, freteU);
    freteTotalItem.set(itemKey, freteT);
    custoTotalItem.set(itemKey, custoT);
    projecaoVendaTotalItem.set(itemKey, projecaoVendaT);
    projecaoLucroItem.set(itemKey, projecaoLucro);

    custoTotalViagemNum = custoTotalViagemNum.plus(custoT).plus(freteT);
    projecaoLucroTotalNum = projecaoLucroTotalNum.plus(projecaoLucro);
    pesoTotalKg = pesoTotalKg.plus(pesoU.times(qtde));
  });

  const custos = simulacao.custo || {};
  const custoViagemPorCategoria = new Decimal(custos.comissao ?? 0)
    .plus(new Decimal(custos.passagens ?? 0))
    .plus(new Decimal(custos.hotel ?? 0))
    .plus(new Decimal(custos.carro ?? 0))
    .plus(new Decimal(custos.alimentacao ?? 0))
    .plus(new Decimal(custos.gasolina ?? 0))
    .plus(new Decimal(custos.diversos ?? 0));

  const custoTotalViagemComCustos = custoTotalViagemNum.plus(custoViagemPorCategoria);

  const cotaTotalIsentaUsd = new Decimal(quantidadeViajantes).times(1000);
  const valorBensConsideradoUsd = custoTotalViagemNum.dividedBy(cotacaoDolar);
  const excedenteTributavelUsd = Decimal.max(valorBensConsideradoUsd.minus(cotaTotalIsentaUsd), new Decimal(0));
  const tributacaoPrevistaUsd = excedenteTributavelUsd.times(new Decimal(0.75));
  const tributacaoPrevistaBrl = tributacaoPrevistaUsd.times(cotacaoDolar);

  const riscoEfetivado = simulacao.riscoEfetivado ?? false;
  const tributacaoEfetivadaBrl = toDecimal(simulacao.tributacaoEfetivadaBrl);

  const lucroFinal = projecaoLucroTotalNum.minus(custoViagemPorCategoria);
  const tributacaoAplicada = riscoEfetivado ? tributacaoEfetivadaBrl : new Decimal(0);
  const lucroFinalComRisco = lucroFinal.minus(tributacaoAplicada);

  const percentualLucro = custoTotalViagemComCustos.gt(0)
    ? lucroFinal.times(100).dividedBy(custoTotalViagemComCustos)
    : new Decimal(0);

  return {
    coeficiente,
    freteUnitarioItem,
    freteTotalItem,
    custoTotalItem,
    projecaoVendaTotalItem,
    projecaoLucroItem,
    custoTotalViagem: custoTotalViagemComCustos,
    projecaoLucroTotal: projecaoLucroTotalNum,
    cotaTotalIsentaUsd,
    excedenteTributavelUsd,
    tributacaoPrevistaUsd,
    tributacaoPrevistaBrl,
    riscoDeclarando: tributacaoPrevistaBrl,
    riscoNaoDeclarando: tributacaoPrevistaBrl,
    lucroFinalDeclarando: lucroFinal,
    lucroFinalNaoDeclarando: lucroFinalComRisco,
    percentualLucroDeclarando: percentualLucro,
    percentualLucroNaoDeclarando: custoTotalViagemComCustos.gt(0)
      ? lucroFinalComRisco.times(100).dividedBy(custoTotalViagemComCustos)
      : new Decimal(0),
  };
};
