import { Response } from "express";
import { z } from "zod";
import { TriagemService } from "./triagem.service";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import type { AuthenticatedRequest } from "../../middlewares/auth";

const service = new TriagemService(prisma);

const atribuirItemSchema = z.object({
  lojaId: z.string().min(1),
  quantidade: z.number().int().positive(),
  observacao: z.string().optional()
});

export async function atribuirItem(req: AuthenticatedRequest, res: Response) {
  const { id, itemId } = req.params as { id: string; itemId: string };
  const storeId = req.storeId!;
  const userId = req.identity?.user.id;

  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const validation = atribuirItemSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues });
  }

  const { lojaId, quantidade, observacao } = validation.data;

  if (lojaId !== storeId) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const atribuicao = await service.atribuirItem(
      id,
      itemId,
      lojaId,
      quantidade,
      userId,
      observacao
    );

    return res.status(200).json(atribuicao);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: error.code });
    }

    console.error("[atribuirItem]", error);
    throw error;
  }
}

export async function listarAtribuicoes(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params as { id: string };
  const storeId = req.storeId!;

  try {
    const atribuicoes = await service.listarAtribuicoes(id, storeId);
    return res.status(200).json(atribuicoes);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: error.code });
    }

    console.error("[listarAtribuicoes]", error);
    throw error;
  }
}
