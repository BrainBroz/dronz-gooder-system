import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const database = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn()
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: database.transaction,
    idempotencyRecord: { findUnique: database.findUnique }
  }
}));

import { idempotentMutation } from "../src/modules/operations/operations.persistence";

const knownError = (code: string, metaCode?: string) =>
  new Prisma.PrismaClientKnownRequestError("database error", {
    code,
    clientVersion: "6.19.3",
    meta: metaCode ? { code: metaCode } : undefined
  });

beforeEach(() => {
  database.transaction.mockReset();
  database.findUnique.mockReset();
  database.findUnique.mockResolvedValue(null);
});

describe("idempotentMutation serialization errors", () => {
  for (const key of [undefined, "retry-key"]) {
    it(`maps raw PostgreSQL serialization conflict with key ${key ?? "absent"}`, async () => {
      database.transaction.mockRejectedValue(knownError("P2010", "40001"));
      await expect(idempotentMutation({
        lojaId: "store",
        operation: "TEST",
        entityId: "item",
        key,
        payload: { quantity: 1 },
        execute: vi.fn()
      })).rejects.toMatchObject({ status: 409, code: "concurrent_modification" });
      expect(database.transaction).toHaveBeenCalledOnce();
      // Com chave: verificação prévia e, após o conflito, checagem de uma gravação concorrente idêntica.
      expect(database.findUnique).toHaveBeenCalledTimes(key ? 2 : 0);
    });

    it(`preserves unrelated raw query errors with key ${key ?? "absent"}`, async () => {
      const error = knownError("P2010", "23505");
      database.transaction.mockRejectedValue(error);
      await expect(idempotentMutation({
        lojaId: "store",
        operation: "TEST",
        entityId: "item",
        key,
        payload: { quantity: 1 },
        execute: vi.fn()
      })).rejects.toBe(error);
    });
  }

  it("conflito de serialização com o mesmo pedido já gravado por outra requisição devolve a resposta gravada", async () => {
    const { createHash } = await import("node:crypto");
    database.transaction.mockRejectedValue(knownError("P2010", "40001"));
    const payload = { quantity: 1 };
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    database.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ requestHash: hash, responseData: { id: "saved" } });
    await expect(
      idempotentMutation({ lojaId: "store", operation: "TEST", entityId: "item", key: "same-key", payload, execute: vi.fn() })
    ).resolves.toEqual({ id: "saved" });
  });

  it("conflito de serialização com a mesma chave e outro conteúdo é conflito de idempotência", async () => {
    database.transaction.mockRejectedValue(knownError("P2010", "40001"));
    database.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ requestHash: "outro", responseData: {} });
    await expect(
      idempotentMutation({ lojaId: "store", operation: "TEST", entityId: "item", key: "same-key", payload: { quantity: 1 }, execute: vi.fn() })
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });
});
