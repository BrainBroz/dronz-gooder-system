// Tipos das respostas de /economic-settings e /purchase-simulations. O backend calcula; a tela só apresenta.
export type Canal = "MERCADO_LIVRE" | "SHOPEE" | "SITE_PROPRIO" | "OUTRO";
export type Modalidade = "A_VISTA" | "PARCELADO";
export type Moeda = "USD" | "BRL";
export type NotaFiscalBase = "VENDA_BRUTA" | "BASE_INFORMADA";

export type TaxaMarketplace = {
  id?: string;
  canal: Canal;
  modalidade: Modalidade;
  parcelas: number | null;
  percentual: string;
  descricao: string | null;
};

export type ParametroEconomico = {
  id: string;
  versao: number;
  acrescimoCambialBrl: string;
  freteValorPorKg: string | null;
  freteMoeda: Moeda | null;
  markupAlertaPercentual: string;
  notaFiscalPercentual: string | null;
  notaFiscalBase: NotaFiscalBase | null;
  iofPercentual: string | null;
  observacoes: string | null;
  createdAt: string;
  criadoPor: { id: string; name: string };
  taxasMarketplace: TaxaMarketplace[];
};

export type SettingsResponse = {
  vigente: ParametroEconomico | null;
  versoes: { id: string; versao: number; createdAt: string; criadoPor: { name: string } }[];
  referenciasPO: {
    acrescimoCambialBrl: string;
    notaFiscalPercentual: string;
    notaFiscalBase: NotaFiscalBase;
    markupAlertaPercentual: string;
    frete: { valorPorKg: string; moeda: Moeda };
    taxas: { canal: Canal; modalidade: Modalidade; parcelas: number | null; percentual: string; observacao?: string }[];
  };
};

export type CotacaoVigente = {
  id: string;
  moedaOrigem: string;
  moedaDestino: string;
  referencia: string;
  acrescimo: string;
  operacional: string;
  fonte: string | null;
  cotadoEm: string;
  idadeDias: number;
  condicao: "VIGENTE" | "ANTIGA";
};

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
  pendencias: { campo: string; motivo: string }[];
  moeda: "BRL";
  quantidade: number;
  pesoTotalKg: string | null;
  cambio: { par: string; referencia: string; acrescimo: string; operacional: string } | null;
  porUnidade: Valores;
  total: Valores;
  composicao: {
    encargosCompra: { descricao: string; porUnidade: string | null; total: string | null }[];
    outrosEncargosVenda: { descricao: string; porUnidade: string; total: string }[];
    notaFiscal: { modo: string; percentual: string | null; baseUnitaria: string | null };
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

export const canalLabel: Record<Canal, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  SITE_PROPRIO: "Site próprio",
  OUTRO: "Outro canal"
};
export const modalidadeLabel = (modalidade: Modalidade, parcelas: number | null) =>
  modalidade === "A_VISTA" ? "À vista" : `Parcelado${parcelas ? ` em ${parcelas}x` : ""}`;

export const brl = (value: string | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const rate = (value: string) => Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
export const percent = (value: string | null) =>
  value === null ? "—" : `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
