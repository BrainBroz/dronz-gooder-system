import React from "react";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { CategoriesPage } from "../src/pages/CategoriesPage";
import { ProductsPage } from "../src/pages/ProductsPage";
import { SuppliersPage } from "../src/pages/SuppliersPage";
import { PurchaseOrdersPage } from "../src/pages/PurchaseOrdersPage";
import { LogisticsPage } from "../src/pages/LogisticsPage";
import { InventoryPage } from "../src/pages/InventoryPage";
import { FinancePage } from "../src/pages/FinancePage";
import { ReportsPage } from "../src/pages/ReportsPage";
import { DashboardPage } from "../src/pages/DashboardPage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const dashboard = {
  orders: { count: 0, total: 0, byStatus: {} },
  inventory: { available: 0, reserved: 0, zero: 0 },
  openTrips: 0,
  pendingReceiving: 0,
  payments: { pending: 0, paid: 0 },
  belowMarkup: 0
};

function payload(url: string) {
  if (url === "/analytics/dashboard") return dashboard;
  if (url.startsWith("/analytics/reports/")) return [];
  if (["/categories", "/products", "/suppliers", "/purchase-orders"].includes(url)) {
    return { items: [] };
  }
  return [];
}

beforeEach(() => {
  vi.spyOn(api, "get").mockImplementation(async (url) => ({ data: payload(url) }));
});

describe("troca de loja nas páginas", () => {
  it.each([
    ["Categories", CategoriesPage, "/categories"],
    ["Products", ProductsPage, "/categories"],
    ["Suppliers", SuppliersPage, "/suppliers"],
    ["PurchaseOrders", PurchaseOrdersPage, "/purchase-orders"],
    ["Logistics", LogisticsPage, "/logistics/travelers"],
    ["Inventory", InventoryPage, "/inventory"],
    ["Finance", FinancePage, "/finance/payments"],
    ["Reports", ReportsPage, "/analytics/reports/purchase-orders"],
    ["Dashboard", DashboardPage, "/analytics/dashboard"]
  ])("%s refaz consultas com a nova loja", async (_name, Page, endpoint) => {
    renderWithProviders(<Page />);
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.some(
          ([url, config]) =>
            url === endpoint && config?.headers?.["x-store-id"] === testStores[0].id
        )
      ).toBe(true)
    );
    act(() => useAuthStore.getState().setActiveStoreId(testStores[1].id));
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.some(
          ([url, config]) =>
            url === endpoint && config?.headers?.["x-store-id"] === testStores[1].id
        )
      ).toBe(true)
    );
    const callsAfterSwitch = vi.mocked(api.get).mock.calls.filter(
      ([, config]) => config?.headers?.["x-store-id"] === testStores[1].id
    );
    expect(callsAfterSwitch.length).toBeGreaterThan(0);
  });

  it("PurchaseOrders não emite warning de select sem children durante loading", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWithProviders(<PurchaseOrdersPage />);
    expect(
      error.mock.calls.some((args) => args.join(" ").includes("children must be passed"))
    ).toBe(false);
  });
});
