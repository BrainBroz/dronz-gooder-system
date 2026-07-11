import express from "express";
import cors from "cors";
import helmet from "helmet";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.WEB_ORIGIN?.split(",") ?? true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/auth/login", (_req, res) => res.status(501).json({ error: "not_implemented" }));
  app.post("/auth/refresh", (_req, res) => res.status(501).json({ error: "not_implemented" }));
  app.post("/auth/logout", (_req, res) => res.status(501).json({ error: "not_implemented" }));
  app.get("/auth/me", (_req, res) => res.status(501).json({ error: "not_implemented" }));

  return app;
}
