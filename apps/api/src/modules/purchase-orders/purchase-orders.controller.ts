import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import {
  itemSchema,
  itemUpdateSchema,
  orderCreateSchema,
  orderUpdateSchema,
  querySchema,
  statusSchema
} from "./purchase-orders.schemas";
import * as s from "./purchase-orders.service";
const st = (r: AuthenticatedRequest) => r.storeId!,
  id = (r: AuthenticatedRequest) => String(r.params.id),
  item = (r: AuthenticatedRequest) => String(r.params.itemId);
const bad = (x: Response) => x.status(400).json({ error: "bad_request" });
export async function list(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = querySchema.safeParse(r.query);
  if (!p.success) return bad(x);
  try {
    x.json({ items: await s.list(st(r), p.data) });
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
    x.json(await s.get(st(r), id(r)));
  } catch (e) {
    n(e);
  }
}
export async function create(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = orderCreateSchema.safeParse(r.body);
  if (!p.success) return bad(x);
  if (p.data.lojaId && p.data.lojaId !== st(r))
    return x.status(403).json({ error: "forbidden" });
  try {
    x.status(201).json(await s.create(st(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function update(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = orderUpdateSchema.safeParse(r.body);
  if (!p.success) return bad(x);
  try {
    x.json(await s.update(st(r), id(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function status(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = statusSchema.safeParse(r.body);
  if (!p.success) return bad(x);
  try {
    x.json(await s.changeStatus(st(r), id(r), p.data.status));
  } catch (e) {
    n(e);
  }
}
export async function addItem(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = itemSchema.safeParse(r.body);
  if (!p.success) return bad(x);
  try {
    x.status(201).json(await s.addItem(st(r), id(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function updateItem(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  const p = itemUpdateSchema.safeParse(r.body);
  if (!p.success) return bad(x);
  try {
    x.json(await s.updateItem(st(r), id(r), item(r), p.data));
  } catch (e) {
    n(e);
  }
}
export async function removeItem(
  r: AuthenticatedRequest,
  x: Response,
  n: NextFunction
) {
  try {
    x.json(await s.removeItem(st(r), id(r), item(r)));
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
    await s.remove(st(r), id(r));
    x.json({ status: "ok" });
  } catch (e) {
    n(e);
  }
}
