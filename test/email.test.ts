import { beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendEmail, type EmailKind } from "@/lib/email";
import { resetDb } from "./db";
import { clearOutbox, lastEmailTo } from "./outbox";

const mail = (kind: EmailKind, to: string, senderUserId?: string) => ({
  to,
  kind,
  senderUserId,
  subject: "s",
  html: "<p>h</p>",
  text: "h",
});

beforeEach(async () => {
  await resetDb();
  await clearOutbox();
});

it("writes to the file outbox and lowercases the recipient", async () => {
  await sendEmail(mail("magic_link", "Asha@Example.TEST"));
  expect((await lastEmailTo("asha@example.test")).subject).toBe("s");
});

it("refuses the 6th magic link to one address within an hour", async () => {
  for (let i = 0; i < 5; i++) await sendEmail(mail("magic_link", "a@x.test"));
  await expect(sendEmail(mail("magic_link", "a@x.test"))).rejects.toMatchObject({
    name: "EmailRateLimitError",
    reason: "recipient",
  });
});

it("ignores sends older than an hour", async () => {
  const old = new Date(Date.now() - 61 * 60_000);
  await db.emailLog.createMany({
    data: Array.from({ length: 5 }, () => ({ kind: "magic_link", toEmail: "a@x.test", createdAt: old })),
  });
  await expect(sendEmail(mail("magic_link", "a@x.test"))).resolves.toBeUndefined();
});

it("refuses the 21st invite from one sender within an hour", async () => {
  for (let i = 0; i < 20; i++) await sendEmail(mail("invite", `p${i}@x.test`, "u1"));
  await expect(sendEmail(mail("invite", "p20@x.test", "u1"))).rejects.toMatchObject({ reason: "sender" });
});

it("stops everything at 450 emails in 24 hours", async () => {
  await db.emailLog.createMany({
    data: Array.from({ length: 450 }, (_, i) => ({ kind: "invite", toEmail: `g${i}@x.test` })),
  });
  await expect(sendEmail(mail("magic_link", "new@x.test"))).rejects.toMatchObject({ reason: "global" });
});
