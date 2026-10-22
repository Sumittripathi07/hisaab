import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The outbox helpers (test/outbox.ts) read SMTP_URL in this process too, so it and the server must agree.
// Absolute, because the standalone server changes its working directory to .next/standalone.
const smtpUrl = (process.env.SMTP_URL ??= `file://${resolve(".e2e-outbox")}`);
const databaseUrl = (process.env.TEST_DATABASE_URL ??= "postgresql://hisaab:hisaab@localhost:5432/hisaab_test");

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Tests share one database and one outbox, and sign in from one IP (Better Auth rate-limits sign-ins per IP).
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production build and the same standalone server.js the Docker image runs. `next start` only warns that it
    // doesn't support `output: "standalone"`. The standalone server needs public/ and .next/static copied next to it.
    command:
      "pnpm build && cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/ && node .next/standalone/server.js",
    url: `${baseURL}/api/health`,
    // Never test a stale server left running on the port.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      PORT: String(PORT),
      HOSTNAME: "localhost",
      DATABASE_URL: databaseUrl,
      SMTP_URL: smtpUrl,
      BETTER_AUTH_URL: baseURL,
      // Test-only values. Google is never called.
      BETTER_AUTH_SECRET: "e2e-secret-abcdefghijklmnopqrstuvwxyz0123456789",
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
      GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
    },
  },
});
