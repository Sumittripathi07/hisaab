import { execFileSync } from "node:child_process";
import { clearOutbox } from "../test/outbox";
import { TRUNCATE_ALL } from "../test/db";

/** Runs the Prisma CLI against the e2e test database. */
export const prisma = (args: string[], input?: string) =>
  execFileSync("pnpm", ["exec", "prisma", ...args], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    input,
    stdio: "pipe",
  });

// Starts every run from an empty test database at the latest migration, and an empty outbox.
// Not `prisma migrate reset`: Prisma refuses that when an AI agent runs it, and this ends up in the same state.
export default async function globalSetup() {
  prisma(["migrate", "deploy"]);
  prisma(["db", "execute", "--stdin"], TRUNCATE_ALL);
  await clearOutbox();
}
