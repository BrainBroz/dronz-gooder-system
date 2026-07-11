import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/app-error";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (error instanceof AppError) return res.status(error.status).json({ error: error.code });
  res.status(500).json({ error: "internal_error" });
};
