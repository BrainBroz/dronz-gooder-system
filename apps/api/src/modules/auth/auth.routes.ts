import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import * as controller from "./auth.controller";

export const authRouter = Router();
authRouter.post("/login", controller.login);
authRouter.post("/refresh", controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.get("/me", requireAuth, controller.me);
