import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { lastEmailTo } from "../test/outbox";
import { prisma } from "./global-setup";

let lastIp = 0;
/**
 * A page in a fresh browser context (a separate browser, as another person would have) with a client IP of its own.
 * Better Auth limits magic links to 5 a minute per IP and reads the IP from X-Forwarded-For. Nothing sits in front of the
 * e2e server and Next only fills that header in when it's missing, and 10.x is outside auth.ts's trustedProxies, so each
 * context counts as its own client instead of every test sharing one budget.
 */
export async function newPage(browser: Browser, options: BrowserContextOptions = {}): Promise<Page> {
  // Onboarding takes a person's currency and timezone from their browser: an Indian one, so amounts read "₹1,200".
  const context = await browser.newContext({
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    ...options,
    extraHTTPHeaders: { "x-forwarded-for": `10.0.0.${++lastIp}` },
  });
  return context.newPage();
}

// Each person signs in once per run and their session is kept here for signedInPage: quicker than signing in again.
// (The worker is the same process for the whole run, since there's one worker; after a failed test Playwright starts a
// new one, and people simply sign in again.)
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

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
  const response = await page.goto(link);
  // The limiter answers before Better Auth does, so this is a bare 429 page rather than a failed sign-in.
  if (response?.status() === 429) throw new Error("Hit Better Auth's magic-link limit (5 a minute per IP): sign in from a newPage");
  sessions.set(email, await page.context().storageState());
}

/**
 * Onboarding with just a name. Someone headed somewhere (an invite link) is then taken there; anyone else gets the
 * "You're all set" step, with its "Go to dashboard".
 */
export async function completeOnboardingUi(page: Page, name: string): Promise<void> {
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Signs in as someone new and finishes onboarding with just a name, landing on the dashboard. */
export async function signInAndOnboard(page: Page, email: string, name: string): Promise<void> {
  await signInWithMagicLink(page, email);
  await completeOnboardingUi(page, name);
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** A page of its own (a separate browser) signed in as `email`, onboarded as `name` if new, on the dashboard. */
export async function signedInPage(browser: Browser, email: string, name: string): Promise<Page> {
  const page = await newPage(browser, { storageState: sessions.get(email) });
  await page.goto("/dashboard");
  if (new URL(page.url()).pathname === "/sign-in") await signInWithMagicLink(page, email);
  if (new URL(page.url()).pathname === "/onboarding") {
    await completeOnboardingUi(page, name);
    await page.getByRole("button", { name: "Go to dashboard" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  return page;
}

/** Uses up `email`'s invite emails for the hour (20) in the test database, so the limit is tested without sending 20. */
export function useUpInviteLimit(email: string): void {
  prisma(
    ["db", "execute", "--stdin"],
    `INSERT INTO "EmailLog" (id, kind, "toEmail", "senderUserId")
     SELECT md5(random()::text), 'invite', 'seeded@example.test', id FROM "user", generate_series(1, 20)
     WHERE email = '${email.replaceAll("'", "''")}'`,
  );
}

/** Creates a group from the sidebar (desktop) and returns its page's URL. */
export async function createGroupViaUi(page: Page, name: string): Promise<string> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/c/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url();
}

/** Adds someone without an account through the invite sheet, and waits until they're in the group's member list. */
export async function addPlaceholderViaUi(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Invite people" }).click();
  const form = page.getByRole("form", { name: "Add someone without an account" });
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`${name} was added`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Members" }).getByText(name)).toBeVisible();
}

/** Adds an expense, paid by you and split equally, from a group's page at desktop width: "Add expense", keypad, Next, Save. */
export async function addExpenseViaUi(page: Page, { amount, description }: { amount: string; description: string }): Promise<void> {
  await page.getByRole("button", { name: "Add expense" }).click();
  for (const key of amount) await page.getByRole("button", { name: key === "." ? "Decimal point" : key, exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: description })).toBeVisible();
}
