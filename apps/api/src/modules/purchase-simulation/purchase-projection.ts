import { Prisma } from "@prisma/client";

/**
 * Projeção econômica de uma compra (estimativa, nunca realizado). Função pura: não consulta nem grava.
 *
 * Unidades: o resultado é em BRL. Valores em USD são convertidos pela cotação operacional
 * USD→BRL = referência + acréscimo (acréscimo somado uma única vez). Cada valor declara a sua moeda;
 * frete é "valor por kg × peso unitário" na moeda informada do frete.
 *
 * Cálculo em precisão total; arredondamento comercial HALF_UP só na saída (dinheiro 2 casas,
 * cotação 6 casas, percentuais 2 casas). Totais = valor unitário em precisão total × quantidade.
 *
 * markup e margem seguem docs/domain-contracts.md (sobre preço de venda e custo total unitário);
 * os indicadores de resultado líquido têm nomes próprios para não reutilizar o mesmo rótulo.
 * Não substitui nem altera a fórmula protegida da simulação de viagem (calcularSimulacao).
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type Moeda = "USD" | "BRL";

export type EncargoCompra = {
  descricao: string;
  /** PERCENTUAL_COMPRA: % sobre o preço de compra convertido; VALOR_UNIDADE / VALOR_TOTAL: valor na moeda informada. */
  tipo: "PERCENTUAL_COMPRA" | "VALOR_UNIDADE" | "VALOR_TOTAL";
  valor: string;
  moeda?: Moeda;
};

export type EncargoVenda = {
  descricao: string;
  /** Sempre em BRL; PERCENTUAL_VENDA_BRUTA incide sobre o preço de venda bruto. */
  tipo: "PERCENTUAL_VENDA_BRUTA" | "VALOR_UNIDADE" | "VALOR_TOTAL";
  valor: string;
};

export type NotaFiscalEntrada =
  | { modo: "PERCENTUAL_VENDA_BRUTA"; percentual: string }
  | { modo: "PERCENTUAL_BASE_INFORMADA"; percentual: string; baseUnitariaBrl: string }
  | { modo: "VALOR_INFORMADO"; valorUnitarioBrl: string }
  | { modo: "BASE_PENDENTE"; percentual?: string };

export type ProjecaoEntrada = {
  quantidade: number;
  compra: { precoUnitario: string | null; moeda: Moeda };
  pesoUnitarioKg: string | null;
  /** Cotação USD→BRL; nula quando não há cotação. Acréscimo nulo = ainda não informado (zero precisa ser explícito). */
  cambio: { referencia: string; acrescimo: string | null } | null;
  frete: { valorPorKg: string; moeda: Moeda } | null;
  encargosCompra: EncargoCompra[];
  venda: {
    precoUnitarioBrl: string | null;
    /** Nulo = venda sem taxa de canal, escolhido explicitamente; percentual nulo = taxa ainda não informada. */
    marketplace: { canal: string; modalidade: "A_VISTA" | "PARCELADO"; parcelas: number | null; percentual: string | null } | null;
    notaFiscal: NotaFiscalEntrada;
    outrosEncargos: EncargoVenda[];
  };
  markupAlertaPercentual: string;
};

export type Pendencia = { campo: string; motivo: string };
type Valores = Record<
  | "compra"
  | "frete"
  | "encargosCompra"
  | "custo"
  | "vendaBruta"
  | "taxaMarketplace"
  | "notaFiscal"
  | "outrosEncargosVenda"
  | "descontosVenda"
  | "receitaLiquida"
  | "lucro",
  string | null
>;

export type ProjecaoResultado = {
  natureza: "ESTIMATIVA";
  status: "COMPLETO" | "INCOMPLETO";
  pendencias: Pendencia[];
  moeda: "BRL";
  quantidade: number;
  pesoTotalKg: string | null;
  cambio: { par: "USD/BRL"; referencia: string; acrescimo: string; operacional: string } | null;
  porUnidade: Valores;
  total: Valores;
  composicao: {
    encargosCompra: { descricao: string; porUnidade: string | null; total: string | null }[];
    outrosEncargosVenda: { descricao: string; porUnidade: string; total: string }[];
    notaFiscal: { modo: NotaFiscalEntrada["modo"]; percentual: string | null; baseUnitaria: string | null };
  };
  indicadores: {
    precoVendaDefinido: boolean;
    markupPercentual: string | null;
    margemPercentual: string | null;
    resultadoSobreVendaPercentual: string | null;
    resultadoSobreCustoPercentual: string | null;
    limiteMarkupPercentual: string;
    abaixoDoLimite: boolean | null;
  };
};

const money = (value: Dec | null) => (value === null ? null : value.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2));
const pct = (value: Dec | null) => money(value);
const rate = (value: Dec) => value.toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6);
const sum = (values: (Dec | null)[]) =>
  values.some((value) => value === null) ? null : values.reduce<Dec>((acc, value) => acc.plus(value!), new D(0));

export function projectPurchase(input: ProjecaoEntrada): ProjecaoResultado {
  const pendencias: Pendencia[] = [];
  const qtd = new D(input.quantidade);
  const hundred = new D(100);

  const acrescimoPendente = input.cambio !== null && input.cambio.acrescimo === null;
  if (acrescimoPendente)
    pendencias.push({ campo: "cambio.acrescimo", motivo: "Acréscimo cambial não informado (informe 0 se não houver)." });
  const operacional =
    input.cambio && input.cambio.acrescimo !== null ? new D(input.cambio.referencia).plus(input.cambio.acrescimo) : null;
  let cambioPendente = false;
  // Converte para BRL; USD sem cotação deixa o valor não calculável (ausência não vira zero).
  const toBrl = (value: Dec, moeda: Moeda): Dec | null => {
    if (moeda === "BRL") return value;
    if (!operacional) {
      cambioPendente = true;
      return null;
    }
    return value.times(operacional);
  };

  // Custo de aquisição por unidade.
  let compra: Dec | null = null;
  if (input.compra.precoUnitario === null) pendencias.push({ campo: "compra.precoUnitario", motivo: "Preço de compra não informado." });
  else compra = toBrl(new D(input.compra.precoUnitario), input.compra.moeda);

  let frete: Dec | null = null;
  if (!input.frete) pendencias.push({ campo: "frete", motivo: "Frete por kg não configurado." });
  else if (input.pesoUnitarioKg === null) pendencias.push({ campo: "pesoUnitarioKg", motivo: "Peso unitário não informado." });
  else frete = toBrl(new D(input.frete.valorPorKg).times(input.pesoUnitarioKg), input.frete.moeda);

  const encargosCompra = input.encargosCompra.map((encargo) => {
    let porUnidade: Dec | null;
    if (encargo.tipo === "PERCENTUAL_COMPRA") porUnidade = compra === null ? null : compra.times(encargo.valor).dividedBy(hundred);
    else {
      const converted = toBrl(new D(encargo.valor), encargo.moeda ?? "BRL");
      porUnidade = converted === null ? null : encargo.tipo === "VALOR_TOTAL" ? converted.dividedBy(qtd) : converted;
    }
    return { descricao: encargo.descricao, porUnidade };
  });
  const encargosCompraU = sum(encargosCompra.map((encargo) => encargo.porUnidade));
  const custo = sum([compra, frete, encargosCompraU]);

  // Venda projetada por unidade (BRL).
  const precoVenda = input.venda.precoUnitarioBrl === null ? null : new D(input.venda.precoUnitarioBrl);
  const precoVendaDefinido = precoVenda !== null && precoVenda.gt(0);
  if (!precoVendaDefinido) pendencias.push({ campo: "venda.precoUnitarioBrl", motivo: "Preço de venda a definir." });
  const vendaBruta = precoVendaDefinido ? precoVenda : null;

  const marketplace = input.venda.marketplace;
  let taxaMarketplace: Dec | null;
  if (marketplace === null) taxaMarketplace = new D(0);
  else if (marketplace.percentual === null) {
    taxaMarketplace = null;
    pendencias.push({ campo: "venda.marketplace", motivo: "Taxa do marketplace não informada." });
  } else taxaMarketplace = vendaBruta && vendaBruta.times(marketplace.percentual).dividedBy(hundred);

  const nf = input.venda.notaFiscal;
  let notaFiscal: Dec | null = null;
  let notaBase: Dec | null = null;
  if (nf.modo === "BASE_PENDENTE")
    pendencias.push({ campo: "venda.notaFiscal", motivo: "Base de incidência da nota fiscal não definida: escolha a base ou informe o valor estimado." });
  else if (nf.modo === "VALOR_INFORMADO") notaFiscal = new D(nf.valorUnitarioBrl);
  else {
    notaBase = nf.modo === "PERCENTUAL_VENDA_BRUTA" ? vendaBruta : new D(nf.baseUnitariaBrl);
    notaFiscal = notaBase && notaBase.times(nf.percentual).dividedBy(hundred);
  }

  const outrosEncargos = input.venda.outrosEncargos.map((encargo) => {
    const valor = new D(encargo.valor);
    const porUnidade =
      encargo.tipo === "PERCENTUAL_VENDA_BRUTA"
        ? vendaBruta && vendaBruta.times(valor).dividedBy(hundred)
        : encargo.tipo === "VALOR_TOTAL"
          ? valor.dividedBy(qtd)
          : valor;
    return { descricao: encargo.descricao, porUnidade };
  });
  const outrosU = sum(outrosEncargos.map((encargo) => encargo.porUnidade));
  const descontos = sum([taxaMarketplace, notaFiscal, outrosU]);
  const receitaLiquida = vendaBruta && descontos && vendaBruta.minus(descontos);
  const lucro = receitaLiquida && custo && receitaLiquida.minus(custo);

  if (cambioPendente && !acrescimoPendente) pendencias.push({ campo: "cambio", motivo: "Sem cotação USD→BRL para converter valores em dólar." });

  const unit: Record<keyof Valores, Dec | null> = {
    compra,
    frete,
    encargosCompra: encargosCompraU,
    custo,
    vendaBruta,
    taxaMarketplace: vendaBruta ? taxaMarketplace : null,
    notaFiscal,
    outrosEncargosVenda: outrosU,
    descontosVenda: descontos,
    receitaLiquida,
    lucro
  };
  const porUnidade = Object.fromEntries(Object.entries(unit).map(([key, value]) => [key, money(value)])) as Valores;
  const total = Object.fromEntries(
    Object.entries(unit).map(([key, value]) => [key, money(value && value.times(qtd))])
  ) as Valores;

  // Indicadores: só com preço de venda definido e custo calculável; nunca divide por zero.
  const canRatio = precoVendaDefinido && custo !== null;
  const markup = canRatio && custo.gt(0) ? precoVenda.minus(custo).dividedBy(custo).times(hundred) : null;
  const margem = canRatio ? precoVenda.minus(custo).dividedBy(precoVenda).times(hundred) : null;
  const limite = new D(input.markupAlertaPercentual);

  return {
    natureza: "ESTIMATIVA",
    status: pendencias.length ? "INCOMPLETO" : "COMPLETO",
    pendencias,
    moeda: "BRL",
    quantidade: input.quantidade,
    pesoTotalKg: input.pesoUnitarioKg === null ? null : new D(input.pesoUnitarioKg).times(qtd).toDecimalPlaces(3, D.ROUND_HALF_UP).toFixed(3),
    cambio:
      input.cambio && input.cambio.acrescimo !== null && operacional
        ? { par: "USD/BRL", referencia: rate(new D(input.cambio.referencia)), acrescimo: rate(new D(input.cambio.acrescimo)), operacional: rate(operacional) }
        : null,
    porUnidade,
    total,
    composicao: {
      encargosCompra: encargosCompra.map((encargo) => ({
        descricao: encargo.descricao,
        porUnidade: money(encargo.porUnidade),
        total: money(encargo.porUnidade && encargo.porUnidade.times(qtd))
      })),
      outrosEncargosVenda: outrosEncargos
        .filter((encargo) => encargo.porUnidade !== null)
        .map((encargo) => ({ descricao: encargo.descricao, porUnidade: money(encargo.porUnidade)!, total: money(encargo.porUnidade!.times(qtd))! })),
      notaFiscal: {
        modo: nf.modo,
        percentual: "percentual" in nf && nf.percentual !== undefined ? pct(new D(nf.percentual)) : null,
        baseUnitaria: money(notaBase)
      }
    },
    indicadores: {
      precoVendaDefinido,
      markupPercentual: pct(markup),
      margemPercentual: pct(margem),
      resultadoSobreVendaPercentual: lucro && precoVendaDefinido ? pct(lucro.dividedBy(precoVenda).times(hundred)) : null,
      resultadoSobreCustoPercentual: lucro && custo && custo.gt(0) ? pct(lucro.dividedBy(custo).times(hundred)) : null,
      limiteMarkupPercentual: pct(limite)!,
      abaixoDoLimite: markup === null ? null : markup.lt(limite)
    }
  };
}
