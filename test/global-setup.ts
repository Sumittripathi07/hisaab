import { execFileSync } from "node:child_process";

// Runs once before all test files: bring the test database up to the latest migration.
export default function setup() {
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          "postgresql://hisaab:hisaab@localhost:5432/hisaab_test",
      },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    const failure = new Error(`prisma migrate deploy failed:\n${stdout}${stderr}`);
    // Vitest 5.0.5 crashes while mapping the stack of an error thrown from globalSetup, which hides the message.
    failure.stack = failure.message;
    throw failure;
  }
}
