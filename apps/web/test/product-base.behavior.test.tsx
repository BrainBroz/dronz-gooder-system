import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../src/api/client";
import { ProductBasePage } from "../src/pages/ProductBasePage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

const lista = {
  items: [
    { id: "b1", nome: "Apple AirPods Pro 3", categoria: "Fones de ouvido", pesoKg: "0.100" },
    { id: "b2", nome: "Bose SoundLink Max", categoria: "Caixas de som", pesoKg: null }
  ],
  total: 2,
  categorias: ["Caixas de som", "Fones de ouvido"]
};
const mockList = () =>
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/product-bases") return { data: lista };
    throw new Error(`GET inesperado: ${url}`);
  });

describe("Base de produtos", () => {
  it("lista a base e grava o peso informado, sem enviar loja", async () => {
    const user = userEvent.setup();
    const get = mockList();
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<ProductBasePage />, { permissions: ["CATALOGO_VISUALIZAR", "CATALOGO_GERENCIAR"] });
    expect(await screen.findByText("Bose SoundLink Max")).toBeTruthy();
    expect((screen.getByLabelText("Peso de Apple AirPods Pro 3") as HTMLInputElement).value).toBe("0.1");
    expect(get.mock.calls[0]![1]).toMatchObject({ params: { page: 1, limit: 50 } });
    expect((get.mock.calls[0]![1] as { headers: Record<string, string> }).headers["x-store-id"]).toBeUndefined();

    await user.type(screen.getByLabelText("Peso de Bose SoundLink Max"), "1,8");
    await user.tab();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0]).toBe("/product-bases/b2");
    expect(patch.mock.calls[0]![1]).toEqual({ pesoKg: 1.8 });
  });

  it("sem permissão de gerenciar fica somente leitura; o filtro 'só sem peso' vai para a API", async () => {
    const user = userEvent.setup();
    const get = mockList();
    renderWithProviders(<ProductBasePage />, { permissions: ["CATALOGO_VISUALIZAR"] });
    expect(await screen.findByText("Apple AirPods Pro 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Importar" })).toBeNull();
    expect(screen.queryByLabelText(/Peso de/)).toBeNull();
    await user.click(screen.getByLabelText("Só sem peso"));
    await waitFor(() => expect(get.mock.calls.some(([, config]) => (config as { params: { semPeso?: boolean } }).params.semPeso === true)).toBe(true));
  });
});
