import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import { categoryCreateSchema, categoryUpdateSchema } from "./categories.schemas";
import * as service from "./categories.service";

const storeId = (req: AuthenticatedRequest) => req.storeId!;
const resourceId = (req: AuthenticatedRequest) => String(req.params.id);
export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) { try { res.json({ items: await service.list(storeId(req)) }); } catch (e) { next(e); } }
export async function get(req: AuthenticatedRequest, res: Response, next: NextFunction) { try { res.json(await service.get(storeId(req), resourceId(req))); } catch (e) { next(e); } }
export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) { const parsed = categoryCreateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "bad_request" }); if (parsed.data.lojaId && parsed.data.lojaId !== storeId(req)) return res.status(403).json({ error: "forbidden" }); try { res.status(201).json(await service.create(storeId(req), parsed.data)); } catch (e) { next(e); } }
export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) { const parsed = categoryUpdateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "bad_request" }); try { res.json(await service.update(storeId(req), resourceId(req), parsed.data)); } catch (e) { next(e); } }
export async function toggle(req: AuthenticatedRequest, res: Response, next: NextFunction) { try { res.json(await service.toggle(storeId(req), resourceId(req))); } catch (e) { next(e); } }
export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) { try { await service.remove(storeId(req), resourceId(req)); res.json({ status: "ok" }); } catch (e) { next(e); } }
