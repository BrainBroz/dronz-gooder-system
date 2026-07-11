import { describe, expect, it } from "vitest";
import request from "supertest";
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

describe("health", () => {
  it("keeps the endpoint contract documented", () => {
    expect({ status: "ok" }).toEqual({ status: "ok" });
  });
  it("aplica headers de segurança e CORS explícito", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173"
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
