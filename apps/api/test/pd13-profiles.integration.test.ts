import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const codes = async (perfil: string) =>
  (
    await prisma.perfilPermissao.findMany({
      where: { perfil: { code: perfil } },
      select: { permissao: { select: { code: true } } }
    })
  ).map((row) => row.permissao.code);

describe("PD-13 perfis", () => {
  it("GESTOR_LOJA revisa e aprova buyer e gere logística; Miami segue sem financeiro e vendas", async () => {
    const manager = await codes("GESTOR_LOJA");
    for (const code of [
      "BUYER_INGESTION_VISUALIZAR",
      "BUYER_INGESTION_APROVAR",
      "BUYER_INGESTION_REJEITAR",
      "LOGISTICA_POSICOES_GERENCIAR",
      "VENDA_CORRIGIR",
      "DEVOLUCAO_CONFERIR"
    ])
      expect(manager, code).toContain(code);
    const miami = await codes("CHECKPOINT_MIAMI");
    expect(
      miami.some(
        (code) => code.startsWith("FINANCEIRO_") || code.startsWith("VENDA_")
      )
    ).toBe(false);
  });
});
