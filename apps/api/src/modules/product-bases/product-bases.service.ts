import { z } from "zod";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma";

const peso = z.number().positive().max(1000);
export const importSchema = z
  .object({
    itens: z
      .array(
        z
          .object({
            nome: z.string().trim().min(1).max(300),
            categoria: z.string().trim().min(1).max(100).nullable(),
            pesoKg: peso.nullable()
          })
          .strict()
      )
      .min(1)
      .max(2000)
  })
  .strict();
export const updateSchema = z
  .object({ nome: z.string().trim().min(1).max(300), categoria: z.string().trim().min(1).max(100).nullable(), pesoKg: peso.nullable() })
  .partial()
  .strict();
export const querySchema = z.object({
  search: z.string().trim().optional(),
  categoria: z.string().trim().optional(),
  semPeso: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const slugify = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function list(query: z.infer<typeof querySchema>) {
  const where = {
    ...(query.search ? { nome: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.categoria ? { categoria: query.categoria } : {}),
    ...(query.semPeso ? { pesoKg: null } : {})
  };
  const [items, total, categorias] = await Promise.all([
    prisma.produtoBase.findMany({ where, orderBy: [{ categoria: "asc" }, { nome: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.produtoBase.count({ where }),
    prisma.produtoBase.findMany({ distinct: ["categoria"], where: { categoria: { not: null } }, select: { categoria: true }, orderBy: { categoria: "asc" } })
  ]);
  return { items, total, categorias: categorias.map((c) => c.categoria) };
}

export async function update(id: string, input: z.infer<typeof updateSchema>) {
  if (!(await prisma.produtoBase.findUnique({ where: { id } }))) throw new AppError(404, "not_found");
  return prisma.produtoBase.update({ where: { id }, data: { ...input, ...(input.nome ? { slug: slugify(input.nome) } : {}) } });
}

/**
 * Cadastra produtos novos (nome, categoria, peso) e completa o peso de quem já existe e ainda não tem.
 * Nunca sobrescreve peso já informado, então repetir a importação é inofensivo. Com dryRun só conta.
 */
export async function importar(input: z.infer<typeof importSchema>, dryRun: boolean) {
  const itens = input.itens.map((item) => ({ ...item, slug: slugify(item.nome) })).filter((item) => item.slug);
  return prisma.$transaction(async (tx) => {
    const existentes = new Map(
      (await tx.produtoBase.findMany({ where: { slug: { in: itens.map((item) => item.slug) } }, select: { id: true, slug: true, pesoKg: true } })).map((p) => [p.slug, p])
    );
    const novos = new Map<string, (typeof itens)[number]>();
    const completar = new Map<string, number>();
    for (const item of itens) {
      const atual = existentes.get(item.slug);
      if (!atual && !novos.has(item.slug)) novos.set(item.slug, item);
      else if (atual && atual.pesoKg === null && item.pesoKg !== null && !completar.has(atual.id)) completar.set(atual.id, item.pesoKg);
    }
    const resultado = {
      novos: novos.size,
      jaExistentes: existentes.size,
      repetidosNoArquivo: itens.length - novos.size - existentes.size,
      pesosPreenchidos: completar.size
    };
    if (dryRun) return resultado;
    await tx.produtoBase.createMany({
      data: [...novos.values()].map((item) => ({ nome: item.nome, slug: item.slug, categoria: item.categoria, pesoKg: item.pesoKg })),
      skipDuplicates: true
    });
    for (const [id, pesoKg] of completar) await tx.produtoBase.update({ where: { id }, data: { pesoKg } });
    return resultado;
  });
}
