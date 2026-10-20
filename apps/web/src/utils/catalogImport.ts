export type ImportItem = { nome: string; categoria: string | null; pesoKg: number | null };
export type Sheet = { headers: string[]; rows: string[][] };

// CSV com vírgula ou ponto e vírgula (o que mais aparece na primeira linha), aspas duplas e quebras de linha dentro de aspas.
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) rows.push([...row, cell]);
  return rows;
}

/** Primeira aba do Excel (.xlsx) ou o CSV, como tabela de textos; linhas totalmente em branco são ignoradas. */
export async function readSheet(file: File): Promise<Sheet> {
  let table: string[][];
  if (/\.csv$/i.test(file.name)) table = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
  else {
    const { Workbook } = await import("exceljs");
    const book = new Workbook();
    try {
      await book.xlsx.load(await file.arrayBuffer());
    } catch {
      throw new Error("Não consegui abrir este arquivo Excel. Abra-o no Excel e salve de novo, ou exporte como CSV, e tente outra vez.");
    }
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error("O arquivo não tem nenhuma planilha.");
    table = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      table.push(Array.from({ length: sheet.columnCount }, (_, i) => row.getCell(i + 1).text));
    });
  }
  const [headers = [], ...rows] = table.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  return { headers, rows };
}

const findColumn = (headers: string[], pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
export const guessColumn = (headers: string[]) => Math.max(0, findColumn(headers, /produto|nome|descri/i));
export const guessCategoryColumn = (headers: string[]): number | null => {
  const index = findColumn(headers, /categ/i);
  return index < 0 ? null : index;
};
export const guessWeightColumn = (headers: string[]): number | null => {
  const index = findColumn(headers, /peso/i);
  return index < 0 ? null : index;
};

const toWeight = (text: string | undefined) => {
  const value = Number((text ?? "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export type ColumnChoice = { produto: number; categoria: number | "titulos" | null; peso: number | null };

/**
 * Categoria vem de uma coluna ou de linhas só com título (só a coluna do produto preenchida, que valem para as
 * linhas seguintes). Peso vem de uma coluna; vazio ou inválido fica sem peso.
 */
export function extractItems(sheet: Sheet, choice: ColumnChoice): ImportItem[] {
  const items: ImportItem[] = [];
  let titulo: string | null = null;
  for (const row of sheet.rows) {
    const nome = row[choice.produto] ?? "";
    if (!nome) continue;
    if (choice.categoria === "titulos" && row.every((cell, i) => i === choice.produto || !cell)) {
      titulo = nome;
      continue;
    }
    const categoria = choice.categoria === "titulos" ? titulo : choice.categoria === null ? null : row[choice.categoria] || null;
    items.push({ nome, categoria, pesoKg: choice.peso === null ? null : toWeight(row[choice.peso]) });
  }
  return items;
}
