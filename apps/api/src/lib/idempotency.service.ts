import crypto from "crypto";
import { prisma } from "./prisma";
import { AppError } from "./app-error";
import type { Prisma } from "@prisma/client";

export async function runIdempotent<T>(
  scope: string,
  key: string,
  callback: () => Promise<T>,
  tx?: Prisma.TransactionClient
): Promise<T> {
  const hash = hashRequest({ scope, key });

  try {
    const record = await (tx || prisma).idempotencyRecord.create({
      data: {
        scope,
        key: hash,
        state: "PROCESSING",
        response: null
      }
    });

    try {
      const result = await callback();
      await (tx || prisma).idempotencyRecord.update({
        where: { id: record.id },
        data: {
          state: "SUCCEEDED",
          response: JSON.stringify(result)
        }
      });
      return result;
    } catch (error) {
      await (tx || prisma).idempotencyRecord.update({
        where: { id: record.id },
        data: { state: "FAILED" }
      });
      throw error;
    }
  } catch (error: unknown) {
    const err = error as Record<string, string>;
    if (err.code === "P2002") {
      // Unique constraint violation: another process is handling this request
      const existing = await (tx || prisma).idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: hash } }
      });

      if (existing?.state === "PROCESSING") {
        // Wait a bit and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
        return runIdempotent(scope, key, callback, tx);
      }

      if (existing?.state === "SUCCEEDED") {
        // Replay response
        return JSON.parse(existing.response || "{}");
      }

      if (existing?.state === "FAILED") {
        // Respect failure
        throw new AppError(409, "idempotency_previously_failed");
      }
    }
    throw error;
  }
}

export function hashRequest(payload: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function requireIdempotencyKey(key: string) {
  if (!key || key.length < 1 || key.length > 200) {
    throw new AppError(400, "invalid_idempotency_key");
  }
}
