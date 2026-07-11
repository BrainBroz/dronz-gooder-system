import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

export async function criarLocalizacao(d: {
  nome: string;
  tipo: string;
  timezone: string;
  pais?: string;
  estado?: string;
  cidade?: string;
  ownerLojaId?: string;
}) {
  // Validate IANA timezone
  const timezonesValid = [
    "America/Sao_Paulo",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "America/Denver",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Australia/Sydney"
  ];

  if (!timezonesValid.includes(d.timezone)) {
    throw new AppError(400, "invalid_timezone");
  }

  return prisma.localizacao.create({
    data: {
      nome: d.nome,
      tipo: d.tipo as any,
      timezone: d.timezone,
      pais: d.pais,
      estado: d.estado,
      cidade: d.cidade,
      ownerLojaId: d.ownerLojaId
    }
  });
}

export async function vincularLocalizacaoLoja(
  localizacaoId: string,
  lojaId: string
) {
  return prisma.localizacaoLoja.create({
    data: {
      localizacaoId,
      lojaId
    }
  });
}

export async function vincularUsuarioLocalizacao(
  usuarioId: string,
  localizacaoId: string
) {
  return prisma.usuarioLocalizacao.create({
    data: {
      usuarioId,
      localizacaoId
    }
  });
}

export async function obterEnderecoVigente(
  localizacaoId: string,
  noInstante?: Date
) {
  const instant = noInstante || new Date();

  return prisma.endereco.findFirst({
    where: {
      localizacaoId,
      validoDe: { lte: instant },
      OR: [{ validoAte: null }, { validoAte: { gte: instant } }]
    },
    orderBy: { validoDe: "desc" }
  });
}

export async function historicoEnderecos(localizacaoId: string) {
  return prisma.endereco.findMany({
    where: { localizacaoId },
    orderBy: { validoDe: "desc" }
  });
}

export async function localizacoesDoUsuario(usuarioId: string) {
  const vinculos = await prisma.usuarioLocalizacao.findMany({
    where: { usuarioId },
    include: { localizacao: true }
  });

  return vinculos.map((v) => v.localizacao);
}
