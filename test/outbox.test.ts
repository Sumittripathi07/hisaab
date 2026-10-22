import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./db";
import { outboxDir } from "@/lib/outbox-dir";
import { clearOutbox } from "./outbox";

const cwd = process.cwd();
let scratch: string;

// clearOutbox deletes recursively, so run from a scratch dir: if a guard ever breaks, only this dir is wiped.
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "outbox-guard-"));
  await writeFile(join(scratch, "keep.txt"), "x");
  process.chdir(scratch);
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

const unsafe = [undefined, "", "file://", "file://.", "file://./", "file://..", "file://../..", "file:///", "smtps://u:p@smtp.test:465"];

describe("outboxDir", () => {
  // Pure: nothing is deleted here, so it is safe to include parents of the working directory.
  it.each(unsafe)("rejects SMTP_URL=%s", (url) => {
    expect(() => outboxDir(url)).toThrow(/SMTP_URL must be file:\/\/<dir>/);
  });

  it("resolves a relative dir against the working directory and keeps an absolute one", () => {
    expect(outboxDir("file://./.test-outbox")).toBe(resolve(".test-outbox"));
    expect(outboxDir("file:///tmp/outbox")).toBe("/tmp/outbox");
  });
});

describe("clearOutbox", () => {
  it.each([undefined, "", "file://", "file://."])("throws and deletes nothing when SMTP_URL=%s", async (url) => {
    vi.stubEnv("SMTP_URL", url);
    await expect(clearOutbox()).rejects.toThrow(/SMTP_URL must be file:\/\/<dir>/);
    expect(await readdir(scratch)).toEqual(["keep.txt"]);
  });
});

describe("sendEmail", () => {
  it("refuses an unsafe file:// SMTP_URL instead of writing into the working directory", async () => {
    await resetDb();
    vi.stubEnv("SMTP_URL", "file://.");
    vi.resetModules(); // env.ts parsed SMTP_URL at first import; re-import so it sees the stub
    const { sendEmail } = await import("@/lib/email");
    await expect(
      sendEmail({ to: "a@x.test", kind: "magic_link", subject: "s", html: "h", text: "h" }),
    ).rejects.toThrow(/SMTP_URL must be file:\/\/<dir>/);
    expect(await readdir(scratch)).toEqual(["keep.txt"]);
    await resetDb(); // the log row is written before delivery
  });
});
