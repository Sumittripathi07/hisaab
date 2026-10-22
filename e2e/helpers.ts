import { expect, type Page } from "@playwright/test";
import { lastEmailTo } from "../test/outbox";

/**
 * Signs in through the real sign-in page: asks for a magic link, reads it from the file outbox and opens it.
 * Stays on the current sign-in page if already there, so its `callbackURL` carries through.
 */
export async function signInWithMagicLink(page: Page, email: string): Promise<void> {
  if (new URL(page.url()).pathname !== "/sign-in") await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const link = (await lastEmailTo(email)).text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error(`No sign-in link in the email to ${email}`);
  await page.goto(link);
}
