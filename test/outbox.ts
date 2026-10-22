import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EmailKind } from "@/lib/email";
import { outboxDir } from "@/lib/outbox-dir";

export type OutboxEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  createdAt: string;
};

// Reads SMTP_URL directly (not via @/lib/env) so e2e can reuse this without pulling in the database.
// outboxDir throws unless SMTP_URL is a safe file:// dir, so clearOutbox can never delete the working directory.
const dir = () => outboxDir(process.env.SMTP_URL);

/** Every email written so far, oldest first. */
export async function readOutbox(): Promise<OutboxEmail[]> {
  const names = (await readdir(dir()).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir(), n), "utf8")) as OutboxEmail));
}

/** The newest email sent to `email` (case-insensitive). Throws if there is none. */
export async function lastEmailTo(email: string): Promise<OutboxEmail> {
  const to = email.toLowerCase();
  const found = (await readOutbox()).filter((m) => m.to === to).at(-1);
  if (!found) throw new Error(`No email to ${email} in ${dir()}`);
  return found;
}

export async function clearOutbox(): Promise<void> {
  await rm(dir(), { recursive: true, force: true });
  await mkdir(dir(), { recursive: true });
}
