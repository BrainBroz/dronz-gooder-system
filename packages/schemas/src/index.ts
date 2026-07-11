import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const healthResponseSchema = z.object({
  status: z.literal("ok")
});

export const authenticatedUserSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    active: z.boolean()
  }),
  stores: z.array(z.object({ id: z.string(), code: z.string() })),
  profiles: z.array(z.object({ id: z.string(), code: z.string() })),
  permissions: z.array(z.string())
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
