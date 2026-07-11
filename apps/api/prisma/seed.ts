import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD is required");

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const [dronz, gooder, profile, permission] = await Promise.all([
    prisma.loja.upsert({
      where: { slug: "dronz" },
      update: { nome: "Dronz", ativa: true },
      create: { slug: "dronz", nome: "Dronz", ativa: true }
    }),
    prisma.loja.upsert({
      where: { slug: "gooder" },
      update: { nome: "Gooder", ativa: true },
      create: { slug: "gooder", nome: "Gooder", ativa: true }
    }),
    prisma.perfil.upsert({
      where: { code: "SUPER_ADMIN" },
      update: { name: "SUPER_ADMIN" },
      create: { code: "SUPER_ADMIN", name: "SUPER_ADMIN" }
    }),
    prisma.permissao.upsert({
      where: { code: "SYSTEM_ADMIN" },
      update: { name: "SYSTEM_ADMIN" },
      create: { code: "SYSTEM_ADMIN", name: "SYSTEM_ADMIN" }
    })
  ]);

  const user = await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: { name: adminName, passwordHash, active: true },
    create: { name: adminName, email: adminEmail, passwordHash, active: true }
  });

  await prisma.usuarioLoja.upsert({
    where: { usuarioId_lojaId: { usuarioId: user.id, lojaId: dronz.id } },
    update: {},
    create: { usuarioId: user.id, lojaId: dronz.id }
  });
  await prisma.usuarioLoja.upsert({
    where: { usuarioId_lojaId: { usuarioId: user.id, lojaId: gooder.id } },
    update: {},
    create: { usuarioId: user.id, lojaId: gooder.id }
  });

  await prisma.usuarioPerfil.upsert({
    where: { usuarioId_perfilId: { usuarioId: user.id, perfilId: profile.id } },
    update: {},
    create: { usuarioId: user.id, perfilId: profile.id }
  });

  await prisma.perfilPermissao.upsert({
    where: { perfilId_permissaoId: { perfilId: profile.id, permissaoId: permission.id } },
    update: {},
    create: { perfilId: profile.id, permissaoId: permission.id }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
