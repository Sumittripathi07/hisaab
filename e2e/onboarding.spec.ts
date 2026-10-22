import { expect, test } from "@playwright/test";
import { lastEmailTo } from "../test/outbox";
import { signedInPage, signInWithMagicLink } from "./helpers";

test("new user signs in, onboards, lands on dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fdashboard/);
  await signInWithMagicLink(page, "neha@example.test");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Your name").fill("Neha");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("UPI ID (optional)").fill("neha@okhdfc");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page.getByRole("heading", { name: /Hi, Neha/ })).toBeVisible();
});

test("a stale or revoked session cookie still keeps where you were going", async ({ page, context, baseURL }) => {
  // What "Sign out other devices" leaves behind on the other devices: a cookie whose session no longer exists.
  await context.addCookies([{ name: "better-auth.session_token", value: "revoked.bogus", url: baseURL! }]);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Faccount$/);
  await page.goto("/onboarding?callbackURL=%2Fjoin%2Fabc");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fonboarding%3FcallbackURL%3D%252Fjoin%252Fabc$/);
});

test("a magic link that was already used shows a friendly message and signs nobody in", async ({ browser }) => {
  // The link Neha signed in with above (or, run alone, one she signs in with now): either way, it's been used.
  await signedInPage(browser, "neha@example.test", "Neha");
  const link = (await lastEmailTo("neha@example.test")).text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("No sign-in link in the email to neha@example.test");

  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
  expect((await page.context().cookies()).some((c) => c.name.includes("session_token"))).toBe(false);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fdashboard$/);
});
