import { describe, expect, it } from "vitest";
import { projectPurchase, type ProjecaoEntrada } from "../src/modules/purchase-simulation/purchase-projection";

// Cenário base: 3 unidades a US$ 100, PTAX 5,00 + acréscimo 0,20, frete US$ 10/kg × 0,5 kg,
// IOF 3,5% sobre a compra, venda R$ 900 no parcelado 16%, nota 5% sobre a venda bruta e
// R$ 30 de embalagem para o lote inteiro.
const base = (): ProjecaoEntrada => ({
  quantidade: 3,
  compra: { precoUnitario: "100", moeda: "USD" },
  pesoUnitarioKg: "0.5",
  cambio: { referencia: "5.00", acrescimo: "0.20" },
  frete: { valorPorKg: "10", moeda: "USD" },
  encargosCompra: [{ descricao: "IOF", tipo: "PERCENTUAL_COMPRA", valor: "3.5" }],
  venda: {
    precoUnitarioBrl: "900",
    marketplace: { canal: "MERCADO_LIVRE", modalidade: "PARCELADO", parcelas: 2, percentual: "16" },
    notaFiscal: { modo: "PERCENTUAL_VENDA_BRUTA", percentual: "5" },
    outrosEncargos: [{ descricao: "Embalagem", tipo: "VALOR_TOTAL", valor: "30" }]
  },
  markupAlertaPercentual: "25"
});

describe("projeção de compra", () => {
  it("compõe custo, venda e resultado por unidade e no total", () => {
    const r = projectPurchase(base());
    expect(r.natureza).toBe("ESTIMATIVA");
    expect(r.status).toBe("COMPLETO");
    expect(r.cambio).toEqual({ par: "USD/BRL", referencia: "5.000000", acrescimo: "0.200000", operacional: "5.200000" });
    expect(r.porUnidade).toEqual({
      compra: "520.00",
      frete: "26.00",
      encargosCompra: "18.20",
      custo: "564.20",
      vendaBruta: "900.00",
      taxaMarketplace: "144.00",
      notaFiscal: "45.00",
      outrosEncargosVenda: "10.00",
      descontosVenda: "199.00",
      receitaLiquida: "701.00",
      lucro: "136.80"
    });
    expect(r.total.custo).toBe("1692.60");
    expect(r.total.vendaBruta).toBe("2700.00");
    expect(r.total.outrosEncargosVenda).toBe("30.00");
    expect(r.total.lucro).toBe("410.40");
    expect(r.pesoTotalKg).toBe("1.500");
    expect(r.indicadores).toEqual({
      precoVendaDefinido: true,
      markupPercentual: "59.52",
      margemPercentual: "37.31",
      resultadoSobreVendaPercentual: "15.20",
      resultadoSobreCustoPercentual: "24.25",
      limiteMarkupPercentual: "25.00",
      abaixoDoLimite: false
    });
  });

  it("aplica o acréscimo cambial uma única vez, inclusive no frete em dólar", () => {
    const r = projectPurchase({ ...base(), quantidade: 1, encargosCompra: [] });
    // 100 × (5,00 + 0,20) = 520; aplicar o acréscimo duas vezes daria 540.
    expect(r.porUnidade.compra).toBe("520.00");
    expect(r.porUnidade.frete).toBe("26.00");
  });

  it("frete declara a moeda: R$/kg não é convertido como se fosse US$/kg", () => {
    const r = projectPurchase({ ...base(), frete: { valorPorKg: "10", moeda: "BRL" } });
    expect(r.porUnidade.frete).toBe("5.00");
  });

  it("sem cotação, valores em dólar ficam não calculáveis e o resultado incompleto", () => {
    const r = projectPurchase({ ...base(), cambio: null });
    expect(r.status).toBe("INCOMPLETO");
    expect(r.porUnidade.compra).toBeNull();
    expect(r.porUnidade.custo).toBeNull();
    expect(r.porUnidade.lucro).toBeNull();
    expect(r.indicadores.markupPercentual).toBeNull();
    expect(r.pendencias.map((p) => p.campo)).toContain("cambio");
  });

  it("compra e frete em reais dispensam a cotação", () => {
    const r = projectPurchase({
      ...base(),
      cambio: null,
      compra: { precoUnitario: "500", moeda: "BRL" },
      frete: { valorPorKg: "20", moeda: "BRL" },
      encargosCompra: []
    });
    expect(r.status).toBe("COMPLETO");
    expect(r.porUnidade.custo).toBe("510.00");
  });

  it("custo ausente não vira zero", () => {
    const r = projectPurchase({ ...base(), compra: { precoUnitario: null, moeda: "USD" } });
    expect(r.porUnidade.custo).toBeNull();
    expect(r.pendencias.map((p) => p.campo)).toContain("compra.precoUnitario");
  });

  it("nota fiscal exige base explícita: pendente deixa o lucro incompleto, mas o custo continua visível", () => {
    const r = projectPurchase({ ...base(), venda: { ...base().venda, notaFiscal: { modo: "BASE_PENDENTE", percentual: "5" } } });
    expect(r.status).toBe("INCOMPLETO");
    expect(r.porUnidade.custo).toBe("564.20");
    expect(r.porUnidade.notaFiscal).toBeNull();
    expect(r.porUnidade.lucro).toBeNull();
    expect(r.pendencias.map((p) => p.campo)).toContain("venda.notaFiscal");
  });

  it("nota sobre base informada ou com valor informado", () => {
    const sobreBase = projectPurchase({
      ...base(),
      venda: { ...base().venda, notaFiscal: { modo: "PERCENTUAL_BASE_INFORMADA", percentual: "5", baseUnitariaBrl: "500" } }
    });
    expect(sobreBase.porUnidade.notaFiscal).toBe("25.00");
    expect(sobreBase.composicao.notaFiscal).toEqual({ modo: "PERCENTUAL_BASE_INFORMADA", percentual: "5.00", baseUnitaria: "500.00" });
    const informado = projectPurchase({ ...base(), venda: { ...base().venda, notaFiscal: { modo: "VALOR_INFORMADO", valorUnitarioBrl: "33.30" } } });
    expect(informado.porUnidade.notaFiscal).toBe("33.30");
  });

  it("preço de venda zero fica 'a definir', sem markup nem divisão por zero", () => {
    const r = projectPurchase({ ...base(), venda: { ...base().venda, precoUnitarioBrl: "0" } });
    expect(r.indicadores.precoVendaDefinido).toBe(false);
    expect(r.indicadores.markupPercentual).toBeNull();
    expect(r.indicadores.margemPercentual).toBeNull();
    expect(r.indicadores.abaixoDoLimite).toBeNull();
    expect(r.porUnidade.custo).toBe("564.20");
  });

  it("alerta quando o markup fica abaixo do limite configurado", () => {
    const r = projectPurchase({ ...base(), venda: { ...base().venda, precoUnitarioBrl: "650" } });
    expect(r.indicadores.markupPercentual).toBe("15.21");
    expect(r.indicadores.abaixoDoLimite).toBe(true);
  });

  it("total vem do valor unitário em precisão total, não do unitário arredondado", () => {
    const r = projectPurchase({
      ...base(),
      quantidade: 3,
      cambio: null,
      compra: { precoUnitario: "10.005", moeda: "BRL" },
      frete: { valorPorKg: "0", moeda: "BRL" },
      encargosCompra: []
    });
    expect(r.porUnidade.compra).toBe("10.01");
    expect(r.total.compra).toBe("30.02");
  });

  it("venda sem taxa de canal escolhida explicitamente não desconta marketplace", () => {
    const r = projectPurchase({ ...base(), venda: { ...base().venda, marketplace: null } });
    expect(r.porUnidade.taxaMarketplace).toBe("0.00");
    expect(r.porUnidade.descontosVenda).toBe("55.00");
  });
});
