import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./lib/env";
import { errorHandler } from "./middlewares/error";
import { authRouter } from "./modules/auth/auth.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { productsRouter } from "./modules/products/products.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { purchaseOrdersRouter } from "./modules/purchase-orders/purchase-orders.routes";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/auth", authRouter);
  app.use("/categories", categoriesRouter);
  app.use("/products", productsRouter);
  app.use("/suppliers", suppliersRouter);
  app.use("/purchase-orders", purchaseOrdersRouter);
  app.use(errorHandler);
  return app;
}
