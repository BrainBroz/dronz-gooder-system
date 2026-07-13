import React from "react";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { SuitcaseWeightPanel } from "../src/components/SuitcaseWeightPanel";
import { logisticsQueryKeys } from "../src/queryKeys";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const regularWeight = {
  conteudoKg: "10.000",
  taraKg: "0.500",
  totalKg: "10.500",
  restanteKg: "12.500",
  excesso: false
};

beforeEach(() => {
  vi.spyOn(api, "get");
});

describe("SuitcaseWeightPanel", () => {
  it("não consulta e exibe estado vazio sem mala", () => {
    renderWithProviders(<SuitcaseWeightPanel malaId={null} />);
    expect(screen.getByText("Selecione uma mala para ver o peso.")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("exibe loading, dados do backend e envia URL/header corretos", async () => {
    let resolve!: (value: { data: typeof regularWeight }) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((done) => (resolve = done)));
    renderWithProviders(<SuitcaseWeightPanel malaId="mala-1" />);
    expect(screen.getByText("Carregando peso...")).toBeTruthy();
    resolve({ data: regularWeight });
    expect(await screen.findByText("Conteúdo: 10.00 kg")).toBeTruthy();
    expect(screen.getByText("Tara: 0.50 kg")).toBeTruthy();
    expect(screen.getByText("Total: 10.50 kg")).toBeTruthy();
    expect(screen.getByText("Restante: 12.50 kg")).toBeTruthy();
    expect(vi.mocked(api.get).mock.calls[0]).toEqual([
      "/logistics/suitcases/mala-1/weight",
      {
        headers: {
          Authorization: "Bearer access-test",
          "x-store-id": "store-dronz"
        }
      }
    ]);
  });

  it("exibe erro da consulta", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    renderWithProviders(<SuitcaseWeightPanel malaId="mala-erro" />);
    expect(await screen.findByText("Falha ao carregar peso.")).toBeTruthy();
  });

  it.each([
    [false, false],
    [true, true]
  ])("respeita excesso=%s retornado pelo backend", async (excesso, visible) => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { ...regularWeight, restanteKg: excesso ? "-1.000" : "12.500", excesso }
    });
    renderWithProviders(<SuitcaseWeightPanel malaId="mala-limite" />);
    await screen.findByText("Total: 10.50 kg");
    expect(screen.queryByText("Excesso de peso.") !== null).toBe(visible);
  });

  it("separa cache e descarta resposta visual stale ao trocar loja e mala", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { ...regularWeight, totalKg: "11" } })
      .mockResolvedValueOnce({ data: { ...regularWeight, totalKg: "7" } })
      .mockResolvedValueOnce({ data: { ...regularWeight, totalKg: "3" } });
    function Harness() {
      const [malaId, setMalaId] = React.useState("mala-1");
      return (
        <>
          <button onClick={() => setMalaId("mala-2")}>Trocar mala</button>
          <SuitcaseWeightPanel malaId={malaId} />
        </>
      );
    }
    renderWithProviders(<Harness />);
    await screen.findByText("Total: 11.00 kg");
    useAuthStore.getState().setActiveStoreId(testStores[1].id);
    await screen.findByText("Total: 7.00 kg");
    expect(screen.queryByText("Total: 11.00 kg")).toBeNull();
    screen.getByRole("button", { name: "Trocar mala" }).click();
    await screen.findByText("Total: 3.00 kg");
    expect(vi.mocked(api.get).mock.calls.map((call) => call[0])).toEqual([
      "/logistics/suitcases/mala-1/weight",
      "/logistics/suitcases/mala-1/weight",
      "/logistics/suitcases/mala-2/weight"
    ]);
    expect(logisticsQueryKeys.suitcaseWeight("d", "mala-1")).not.toEqual(
      logisticsQueryKeys.suitcaseWeight("g", "mala-1")
    );
  });
});
