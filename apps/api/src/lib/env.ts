import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1)
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if (value[key].length < 32 || value[key].startsWith("change-me"))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "production secret must contain at least 32 characters"
        });
    }
  });

export const env = envSchema.parse(process.env);
