import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1)
});

export const env = envSchema.parse(process.env);
