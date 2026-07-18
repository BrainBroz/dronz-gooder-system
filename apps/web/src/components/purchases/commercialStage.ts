import type { UnifiedPurchaseDetail } from "../../types/unified-purchases";

export const commercialStages = [
  "Detectada",
  "Revisão",
  "Mapping",
  "Atribuição",
  "Materializada"
] as const;

/**
 * Deriva o estágio comercial atual a partir de dados já existentes no
 * detalhe (estado, mapeamentos e atribuições por item). Não introduz
 * nenhuma máquina de estados nova: apenas lê o que o backend já retorna.
 */
export function commercialStageIndex(detail: UnifiedPurchaseDetail): number {
  if (detail.itens.length === 0) return detail.estado === "IMPORTADA" ? 0 : 1;
  const allMapped = detail.itens.every((item) => item.mapeamentos.length > 0);
  const allAssigned = detail.itens.every((item) => item.atribuicoes.length > 0);
  const allMaterialized = detail.itens.every(
    (item) => item.itensMaterializados.length > 0
  );
  if (allMaterialized) return 4;
  if (allAssigned) return 3;
  if (allMapped) return 2;
  if (detail.estado !== "IMPORTADA") return 1;
  return 0;
}
