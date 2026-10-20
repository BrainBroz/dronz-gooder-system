import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";

export const importSchema = z
  .object({
    itens: z
      .array(z.object({ nome: z.string().trim().min(1).max(300), categoria: z.string().trim().min(1).max(100).nullable() }).strict())
      .min(1)
      .max(2000)
  })
  .strict();

const SEM_CATEGORIA = "Sem categoria";
const slugify = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const categorySlug = (nome: string) => slugify(nome) || slugify(SEM_CATEGORIA);

/**
 * Cadastra produtos candidatos a compra a partir de uma lista (nome e categoria). Entram inativos, sem preço,
 * markup 30%; quem já existe na loja (mesmo slug) é pulado, então repetir a importação é inofensivo.
 * Com dryRun devolve só as contagens, sem gravar.
 */
export async function importProducts(storeId: string, input: z.infer<typeof importSchema>, dryRun: boolean) {
  const itens = input.itens
    .map((item) => ({ nome: item.nome, slug: slugify(item.nome), categoria: item.categoria ?? SEM_CATEGORIA }))
    .filter((item) => item.slug);
  return prisma.$transaction(
    async (tx) => {
      const existentes = new Set(
        (await tx.produto.findMany({ where: { lojaId: storeId, slug: { in: itens.map((item) => item.slug) } }, select: { slug: true } })).map((p) => p.slug)
      );
      const novos = new Map<string, (typeof itens)[number]>();
      for (const item of itens) if (!existentes.has(item.slug) && !novos.has(item.slug)) novos.set(item.slug, item);
      const categorias = new Map((await tx.categoria.findMany({ where: { lojaId: storeId }, select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
      const faltando = new Map<string, string>();
      for (const item of novos.values()) if (!categorias.has(categorySlug(item.categoria))) faltando.set(categorySlug(item.categoria), item.categoria);
      const resultado = {
        novos: novos.size,
        jaExistentes: existentes.size,
        repetidosNoArquivo: itens.length - novos.size - existentes.size,
        categoriasNovas: faltando.size
      };
      if (dryRun) return resultado;
      for (const [slug, nome] of faltando) categorias.set(slug, (await tx.categoria.create({ data: { lojaId: storeId, nome, slug } })).id);
      // codigo é único no banco inteiro e informado pelo cliente nas outras rotas: segue o maior existente.
      let codigo = (await tx.produto.aggregate({ _max: { codigo: true } }))._max.codigo ?? 0;
      await tx.produto.createMany({
        data: [...novos.values()].map((item) => ({
          lojaId: storeId,
          categoriaId: categorias.get(categorySlug(item.categoria))!,
          codigo: ++codigo,
          nome: item.nome,
          slug: item.slug,
          precoVenda: "0.00",
          markup: "30.00",
          ativo: false
        }))
      });
      return resultado;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
