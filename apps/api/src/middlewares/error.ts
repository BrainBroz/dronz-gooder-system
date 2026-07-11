import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (error instanceof AppError)
    return res.status(error.status).json({ error: error.code });
  if (error instanceof ZodError)
    return res.status(400).json({ error: "bad_request" });
  res.status(500).json({ error: "internal_error" });
};
