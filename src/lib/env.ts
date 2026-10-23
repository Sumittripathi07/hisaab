import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // `file://<dir>` writes emails as JSON files (dev, tests, e2e); anything else is handed to nodemailer.
  SMTP_URL: z.string().min(1),
  EMAIL_FROM: z.string().min(1).default("Hisaab <no-reply@hisaab.local>"),
  // Signs and encrypts sessions and tokens. Generate with `openssl rand -base64 32`.
  BETTER_AUTH_SECRET: z.string().min(32),
  // The public origin of the app. Magic links and the Google redirect URI are built from it.
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // Shared with the Cloudflare Worker (infra/cloudflare-worker), which sends it on every request. When set, src/proxy.ts
  // refuses any request without it, so only the custom domain reaches the app. Unset or empty (local dev, tests): off.
  PROXY_SECRET: z.literal("").or(z.string().min(32)).optional(),
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
