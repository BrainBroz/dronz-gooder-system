import { describe, expect, it } from "vitest";
import { localDateString, utcNoonFromLocalDate } from "../src/components/purchases/dateUtils";

describe("localDateString", () => {
  it("usa o calendário local de São Paulo na virada do mês (UTC avança, SP não)", () => {
    // 2026-02-01T01:00:00Z = 2026-01-31 às 22:00 em America/Sao_Paulo (UTC-3)
    // toISOString().slice(0,10) retornaria "2026-02-01"; localDateString deve retornar "2026-01-31"
    expect(localDateString(new Date("2026-02-01T01:00:00.000Z"))).toBe("2026-01-31");
  });

  it("retorna YYYY-MM-DD com zero-padding correto", () => {
    // 2024-03-05 em SP: 2024-03-05T03:00:00Z
    expect(localDateString(new Date("2024-03-05T03:00:00.000Z"))).toBe("2024-03-05");
  });

  it("aceita só datas reais de quatro dígitos sem lançar exceção", () => {
    expect(utcNoonFromLocalDate("2026-10-16")).toBe("2026-10-16T12:00:00.000Z");
    expect(utcNoonFromLocalDate("10000-10-16")).toBeNull();
    expect(utcNoonFromLocalDate("2026-02-30")).toBeNull();
  });
});
