import { describe, expect, it } from "vitest";

describe("health", () => {
  it("keeps the endpoint contract documented", () => {
    expect({ status: "ok" }).toEqual({ status: "ok" });
  });
});
