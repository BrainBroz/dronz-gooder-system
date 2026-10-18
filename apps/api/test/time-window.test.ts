import { describe, expect, it } from "vitest";
import { thursdayMorningWindow, zonedTimeToUtc } from "../src/lib/time-window";

describe("PD-08 janela de quinta-feira de manhã", () => {
  it("usa o fuso da origem, inclusive com horário de verão", () => {
    // 2026-10-22 é quinta; Miami em EDT (UTC−4).
    expect(
      thursdayMorningWindow(
        new Date("2026-10-22T13:00:00Z"),
        "America/New_York"
      )
    ).toEqual({
      inicio: new Date("2026-10-22T12:00:00Z"),
      fim: new Date("2026-10-22T16:00:00Z")
    });
    // 2026-11-05 é quinta; Miami em EST (UTC−5).
    expect(
      thursdayMorningWindow(
        new Date("2026-11-05T14:00:00Z"),
        "America/New_York"
      )!.fim
    ).toEqual(new Date("2026-11-05T17:00:00Z"));
    // Assunção (Paraguai) em UTC−3.
    expect(
      thursdayMorningWindow(
        new Date("2026-10-22T13:00:00Z"),
        "America/Asuncion"
      )!.inicio
    ).toEqual(new Date("2026-10-22T11:00:00Z"));
  });

  it("partida fora de quinta no fuso local não tem janela", () => {
    // 2026-10-23 02:00Z é quinta 22:00 em Miami, mas sexta em UTC: conta o local.
    expect(
      thursdayMorningWindow(
        new Date("2026-10-23T02:00:00Z"),
        "America/New_York"
      )
    ).not.toBeNull();
    expect(
      thursdayMorningWindow(
        new Date("2026-10-21T15:00:00Z"),
        "America/New_York"
      )
    ).toBeNull();
    expect(zonedTimeToUtc(2026, 3, 8, 12, "America/New_York")).toEqual(
      new Date("2026-03-08T16:00:00Z")
    );
  });
});
