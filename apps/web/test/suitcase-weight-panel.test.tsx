import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SuitcaseWeightPanel } from "../src/components/SuitcaseWeightPanel";
import { queryClient } from "../src/api/client";
import { logisticsQueryKeys } from "../src/queryKeys";

describe("SuitcaseWeightPanel", () => {
  it("exibe estado vazio quando nenhuma mala está selecionada", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuitcaseWeightPanel malaId={null} />
      </QueryClientProvider>
    );
    expect(html).toContain("Selecione uma mala para ver o peso.");
  });

  it("isola a chave de cache por loja e mala", () => {
    expect(logisticsQueryKeys.suitcaseWeight("d", "mala-1")).not.toEqual(
      logisticsQueryKeys.suitcaseWeight("g", "mala-1")
    );
    expect(logisticsQueryKeys.suitcaseWeight("d", "mala-1")).not.toEqual(
      logisticsQueryKeys.suitcaseWeight("d", "mala-2")
    );
  });
});
