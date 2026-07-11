import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";
let createApp: typeof import("../src/app").createApp;
beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});
describe("analytics", () => {
  it("retorna indicadores e relatórios isolados por loja", async () => {
    const app = createApp(),
      login = await request(app)
        .post("/auth/login")
        .send({ email: "admin@example.com", password: "change-me" }),
      d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz"),
      g = login.body.stores.find((x: { slug: string }) => x.slug === "gooder"),
      h = (id: string) => ({
        Authorization: `Bearer ${login.body.accessToken}`,
        "x-store-id": id
      });
    const dashboard = await request(app)
      .get("/analytics/dashboard")
      .set(h(d.id));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.inventory.available).toBeGreaterThanOrEqual(0);
    const dr = await request(app)
        .get("/analytics/reports/inventory")
        .set(h(d.id)),
      gr = await request(app).get("/analytics/reports/inventory").set(h(g.id));
    expect(dr.body.every((x: { lojaId: string }) => x.lojaId === d.id)).toBe(
      true
    );
    expect(gr.body.every((x: { lojaId: string }) => x.lojaId === g.id)).toBe(
      true
    );
    expect(
      (await request(app).get("/analytics/reports/unknown").set(h(d.id))).status
    ).toBe(400);
    for (const type of [
      "purchase-orders",
      "purchase-items",
      "logistics",
      "suitcase-weight",
      "receiving",
      "inventory",
      "movements",
      "costs",
      "payments",
      "markup"
    ]) {
      const response = await request(app)
        .get(`/analytics/reports/${type}`)
        .set(h(d.id));
      expect(response.status, type).toBe(200);
      expect(
        response.body.every((row: { lojaId: string }) => row.lojaId === d.id),
        type
      ).toBe(true);
    }
    const future = await request(app)
      .get("/analytics/reports/purchase-orders?from=2099-01-01")
      .set(h(d.id));
    expect(future.body).toEqual([]);
    expect(
      (
        await request(app)
          .get("/analytics/reports/purchase-orders?status=ARBITRARY")
          .set(h(d.id))
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/analytics/reports/purchase-orders?from=invalid")
          .set(h(d.id))
      ).status
    ).toBe(400);
  });
});
