import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { extractItems, guessCategoryColumn, guessColumn, guessWeightColumn, readSheet } from "../src/utils/catalogImport";

const csv = (text: string, name = "produtos.csv") => new File([text], name, { type: "text/csv" });

describe("importação de catálogo (leitura do arquivo)", () => {
  it("lê CSV com BOM, ponto e vírgula, aspas e linhas em branco", async () => {
    const sheet = await readSheet(csv('﻿Produtos;Quantidade\r\nArmazenamento;\r\n"SSD 1 TB; ""Pro""";3\r\n\r\n'));
    expect(sheet.headers).toEqual(["Produtos", "Quantidade"]);
    expect(sheet.rows).toEqual([["Armazenamento", ""], ['SSD 1 TB; "Pro"', "3"]]);
  });

  it("linhas só com título viram a categoria das seguintes; sem a opção, são produtos", async () => {
    const sheet = await readSheet(csv("Produtos,Quantidade\nArmazenamento,\nSSD A,2\nSSD B,5\nNotebooks,\nNote X,1\n,\n"));
    expect(guessColumn(sheet.headers)).toBe(0);
    expect(extractItems(sheet, { produto: 0, categoria: "titulos", peso: null })).toEqual([
      { nome: "SSD A", categoria: "Armazenamento", pesoKg: null },
      { nome: "SSD B", categoria: "Armazenamento", pesoKg: null },
      { nome: "Note X", categoria: "Notebooks", pesoKg: null }
    ]);
    expect(extractItems(sheet, { produto: 0, categoria: null, peso: null })).toHaveLength(5);
  });

  it("acha a coluna pelo cabeçalho e lê a primeira aba de um .xlsx", async () => {
    const book = new Workbook();
    const aba = book.addWorksheet("Qualquer");
    aba.addRows([["Qtd", "Nome do produto"], [4, "Fone X"], [1, "Fone Y"]]);
    const buffer = await book.xlsx.writeBuffer();
    const file = new File([buffer], "catalogo.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
    const sheet = await readSheet(file);
    expect(guessColumn(sheet.headers)).toBe(1);
    expect(extractItems(sheet, { produto: 1, categoria: null, peso: null }).map((item) => item.nome)).toEqual(["Fone X", "Fone Y"]);
  });

  it("lê categoria e peso por coluna, com vírgula decimal; peso vazio ou inválido fica sem peso", async () => {
    const sheet = await readSheet(csv('Categoria,Produto,Peso (kg)\nFones,"Fone, Pro",0\nFones,Fone Max,"1,36"\nNotebooks,Note X,\nNotebooks,Note Y,abc\n'));
    expect([guessCategoryColumn(sheet.headers), guessColumn(sheet.headers), guessWeightColumn(sheet.headers)]).toEqual([0, 1, 2]);
    expect(extractItems(sheet, { produto: 1, categoria: 0, peso: 2 })).toEqual([
      { nome: "Fone, Pro", categoria: "Fones", pesoKg: null },
      { nome: "Fone Max", categoria: "Fones", pesoKg: 1.36 },
      { nome: "Note X", categoria: "Notebooks", pesoKg: null },
      { nome: "Note Y", categoria: "Notebooks", pesoKg: null }
    ]);
  });

  it("explica quando o Excel não abre", async () => {
    const file = new File(["não é um xlsx"], "ruim.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("não é um xlsx").buffer });
    await expect(readSheet(file)).rejects.toThrow(/salve de novo|exporte como CSV/);
  });
});
