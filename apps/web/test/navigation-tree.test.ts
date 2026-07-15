import { describe, expect, it } from "vitest";
import { navigationTree } from "../src/navigation/navigationTree";

describe("UX-0 — fundação declarativa de navegação", () => {
  it("contém exatamente os 8 grupos aprovados no contrato de UX", () => {
    expect(navigationTree.map((g) => g.key)).toEqual([
      "overview",
      "purchases",
      "logistics",
      "inventory",
      "products",
      "finance",
      "reports",
      "administration"
    ]);
  });

  it("nomeia o menu de logística como LOGÍSTICA e o título da área como ENVIOS E LOGÍSTICA", () => {
    const logistics = navigationTree.find((g) => g.key === "logistics");
    expect(logistics?.title).toBe("LOGÍSTICA");
    expect(logistics?.areaTitle).toBe("ENVIOS E LOGÍSTICA");
  });

  it("não possui Categorias nem Fornecedores fora de Administração", () => {
    const operational = navigationTree.filter((g) => g.key !== "administration");
    const labels = operational.flatMap((g) => g.items.map((i) => i.label.toLowerCase()));
    expect(labels).not.toContain("categorias");
    expect(labels).not.toContain("fornecedores");
  });

  it("não declara nenhum item de menu principal para Agentes, Viajantes ou Checkpoints isolados", () => {
    const allLabels = navigationTree.flatMap((g) => g.items.map((i) => i.label.toLowerCase()));
    expect(allLabels).not.toContain("agentes");
    expect(allLabels).not.toContain("viajantes");
    expect(allLabels).not.toContain("checkpoints");
  });

  it("cada caminho é único em toda a árvore", () => {
    const paths = navigationTree.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
