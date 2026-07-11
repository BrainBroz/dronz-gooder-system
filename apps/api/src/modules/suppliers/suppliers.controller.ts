import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import {
  supplierCreateSchema,
  supplierQuerySchema,
  supplierUpdateSchema
} from "./suppliers.schemas";
import * as s from "./suppliers.service";
const store = (r: AuthenticatedRequest) => r.storeId!;
const id = (r: AuthenticatedRequest) => String(r.params.id);
export async function list(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = supplierQuerySchema.safeParse(r.query);
  if (!p.success) return x.status(400).json({ error: "bad_request" });
  try {
    x.json({ items: await s.list(store(r), p.data) });
  } catch (e) {
    n(e);
  }
}
export async function get(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  try {
    x.json(await s.get(store(r), id(r)));
  } catch (e) {
    n(e);
  }
}
export async function create(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = supplierCreateSchema.safeParse(r.body);
  if (!p.success) return x.status(400).json({ error: "bad_request" });
  if (p.data.lojaId && p.data.lojaId !== store(r))
    return x.status(403).json({ error: "forbidden" });
  try {
    x.status(201).json(await s.create(store(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function update(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = supplierUpdateSchema.safeParse(r.body);
  if (!p.success) return x.status(400).json({ error: "bad_request" });
  try {
    x.json(await s.update(store(r), id(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function toggle(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  try {
    x.json(await s.toggle(store(r), id(r)));
  } catch (e) {
    n(e);
  }
}
export async function remove(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  try {
    await s.remove(store(r), id(r));
    x.json({ status: "ok" });
  } catch (e) {
    n(e);
  }
}
