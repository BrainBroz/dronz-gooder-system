import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";

const requestHash = (payload: unknown) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type AuditInput = {
  usuarioId: string;
  lojaId?: string;
  permissionCode: string;
  action: string;
  entity: string;
  entityId: string;
  correlationId: string;
  idempotencyKey?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  origin?: string;
};

let auditFailureForTests: ((input: AuditInput) => boolean) | undefined;
export function setAuditFailureForTests(
  predicate?: (input: AuditInput) => boolean
) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("test hook unavailable outside tests");
  auditFailureForTests = predicate;
}

export async function idempotentMutation<T>(input: {
  lojaId: string;
  operation: string;
  entityId: string;
  key?: string;
  payload: unknown;
  execute: (tx: Prisma.TransactionClient, correlationId: string) => Promise<T>;
}): Promise<T> {
  if (!input.key) {
    try {
      return await prisma.$transaction(
        (tx) => input.execute(tx, randomUUID()),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        throw new AppError(409, "concurrent_modification");
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new AppError(409, "already_confirmed");
      throw error;
    }
  }
  const hash = requestHash(input.payload);
  const where = {
    lojaId_operation_entityId_idempotencyKey: {
      lojaId: input.lojaId,
      operation: input.operation,
      entityId: input.entityId,
      idempotencyKey: input.key
    }
  };
  const existing = await prisma.idempotencyRecord.findUnique({ where });
  if (existing) {
    if (existing.requestHash !== hash)
      throw new AppError(409, "idempotency_conflict");
    return existing.responseData as T;
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        const result = await input.execute(tx, randomUUID());
        await tx.idempotencyRecord.create({
          data: {
            lojaId: input.lojaId,
            operation: input.operation,
            entityId: input.entityId,
            idempotencyKey: input.key!,
            requestHash: hash,
            responseData: json(result)
          }
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    )
      throw new AppError(409, "concurrent_modification");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await prisma.idempotencyRecord.findUnique({ where });
      if (replay?.requestHash === hash) return replay.responseData as T;
      throw new AppError(409, "idempotency_conflict");
    }
    throw error;
  }
}

export async function audit(tx: Prisma.TransactionClient, input: AuditInput) {
  if (auditFailureForTests?.(input)) throw new Error("forced audit failure");
  await tx.auditLog.create({
    data: {
      usuarioId: input.usuarioId,
      lojaId: input.lojaId,
      permissionCode: input.permissionCode,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      beforeData: input.before === undefined ? undefined : json(input.before),
      afterData: input.after === undefined ? undefined : json(input.after),
      origin: input.origin ?? "API_UI3C"
    }
  });
}
