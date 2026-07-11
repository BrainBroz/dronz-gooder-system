import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let idem: any;

beforeAll(async () => {
  idem = await import("../src/lib/idempotency.service");
});

beforeEach(async () => {
  await prisma.idempotencyRecord.deleteMany();
  await prisma.auditLog.deleteMany();
});

afterAll(async () => await prisma.$disconnect());

describe("idempotency", () => {
  it("replay determinism", async () => {
    const result1 = await idem.runIdempotent("test", "key1", async () => "result");
    const result2 = await idem.runIdempotent("test", "key1", async () => "different");
    expect(result1).toBe(result2);
  });

  it("conflict detection (hash mismatch)", async () => {
    await idem.runIdempotent("test", "key2", async () => "result1");
    await expect(idem.runIdempotent("test", "key2", async () => { throw new Error("fail"); })).rejects.toThrow();
  });

  it("rollback atomicity", async () => {
    await expect(idem.runIdempotent("test", "key3", async () => { throw new Error("boom"); })).rejects.toThrow();
    const record = await prisma.idempotencyRecord.findFirst({ where: { scope: "test", key: idem.hashRequest({ scope: "test", key: "key3" }) } });
    expect(record?.state).toBe("FAILED");
  });

  it("concurrent single-effect guarantee", async () => {
    let callCount = 0;
    const promises = Array(5).fill(null).map(() =>
      idem.runIdempotent("test", "key4", async () => { callCount++; return callCount; })
    );
    const results = await Promise.all(promises);
    expect(results.every((r: any) => r === results[0])).toBe(true);
  });

  it("auditlog in transaction", async () => {
    await idem.runIdempotent("test", "key5", async () => "result");
    const record = await prisma.idempotencyRecord.findFirst({ where: { scope: "test" } });
    expect(record?.state).toBe("SUCCEEDED");
  });
});
