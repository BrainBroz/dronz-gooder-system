import { describe, expect, it } from "vitest";
import { zonedDayStart } from "../src/lib/calendar";

describe("calendário operacional", () => {
  it("converte São Paulo independentemente do fuso do processo", () => {
    expect(zonedDayStart(2032, 2, 1, "America/Sao_Paulo").toISOString()).toBe(
      "2032-02-01T03:00:00.000Z"
    );
  });
  it("usa o primeiro instante do dia quando a meia-noite não existiu por horário de verão", () => {
    expect(zonedDayStart(2018, 11, 4, "America/Sao_Paulo").toISOString()).toBe(
      "2018-11-04T03:00:00.000Z"
    );
  });
});
