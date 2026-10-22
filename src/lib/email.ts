import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createTransport } from "nodemailer";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export type EmailKind = "magic_link" | "invite";

const MAGIC_LINKS_PER_RECIPIENT_PER_HOUR = 5;
const INVITES_PER_SENDER_PER_HOUR = 20;
const EMAILS_PER_DAY = 450;

const HOUR_MS = 60 * 60_000;

export class EmailRateLimitError extends Error {
  name = "EmailRateLimitError";
  constructor(readonly reason: "recipient" | "sender" | "global") {
    super(`Email rate limit reached (${reason})`);
  }
}

type Email = { to: string; subject: string; html: string; text: string; kind: EmailKind };

// Created on first send so importing this module (e.g. during `next build`) never touches SMTP.
let smtp: ReturnType<typeof createTransport> | undefined;

async function deliver(mail: Email): Promise<void> {
  if (env.SMTP_URL.startsWith("file://")) {
    // A relative `file://./dir` resolves against process.cwd().
    const dir = resolve(env.SMTP_URL.slice("file://".length));
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
    await writeFile(join(dir, name), JSON.stringify({ ...mail, createdAt: new Date().toISOString() }));
    return;
  }
  smtp ??= createTransport(env.SMTP_URL);
  await smtp.sendMail({ from: env.EMAIL_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
}

// ponytail: count-then-insert isn't atomic, so concurrent sends can overshoot a limit by a few; add a lock if that matters.
/**
 * Sends one email, refusing with EmailRateLimitError once a limit is hit.
 * The log row is written before sending, so a failed send still counts (the safe direction).
 */
export async function sendEmail(input: Email & { senderUserId?: string }): Promise<void> {
  const { senderUserId, ...mail } = input;
  mail.to = mail.to.toLowerCase();
  const now = Date.now();
  const lastHour = new Date(now - HOUR_MS);
  const lastDay = new Date(now - 24 * HOUR_MS);

  if ((await db.emailLog.count({ where: { createdAt: { gt: lastDay } } })) >= EMAILS_PER_DAY) {
    throw new EmailRateLimitError("global");
  }
  if (
    mail.kind === "magic_link" &&
    (await db.emailLog.count({ where: { kind: "magic_link", toEmail: mail.to, createdAt: { gt: lastHour } } })) >=
      MAGIC_LINKS_PER_RECIPIENT_PER_HOUR
  ) {
    throw new EmailRateLimitError("recipient");
  }
  if (
    mail.kind === "invite" &&
    senderUserId &&
    (await db.emailLog.count({ where: { kind: "invite", senderUserId, createdAt: { gt: lastHour } } })) >=
      INVITES_PER_SENDER_PER_HOUR
  ) {
    throw new EmailRateLimitError("sender");
  }

  await db.emailLog.create({ data: { kind: mail.kind, toEmail: mail.to, senderUserId } });
  await deliver(mail);
}
