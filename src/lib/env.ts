import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // `file://<dir>` writes emails as JSON files (dev, tests, e2e); anything else is handed to nodemailer.
  SMTP_URL: z.string().min(1),
  EMAIL_FROM: z.string().min(1).default("Hisaab <no-reply@hisaab.local>"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`Invalid environment variables: ${keys.join(", ")}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
