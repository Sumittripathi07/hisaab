import { expect, test } from "@playwright/test";
import { lastEmailTo } from "../test/outbox";
import { newPage, signedInPage, signInWithMagicLink } from "./helpers";

test("new user signs in, onboards, lands on dashboard", async ({ browser }) => {
  const page = await newPage(browser);
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

  const page = await newPage(browser);
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
  expect((await page.context().cookies()).some((c) => c.name.includes("session_token"))).toBe(false);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fdashboard$/);
});

test("a failed Google sign-in lands on sign-in with a friendly message, never the raw error code", async ({ page }) => {
  // Better Auth's own error page forwards to sign-in (onAPIError.errorURL in auth.ts); test/auth.test.ts covers the callback.
  await page.goto("/api/auth/error?error=state_mismatch");
  await expect(page).toHaveURL(/\/sign-in\?error=state_mismatch$/);
  await expect(page.getByText("Google sign-in didn't work. Please try again, or use an email link.")).toBeVisible();
  await page.goto("/sign-in?error=%3Cb%3Eunable_to_link_account%3C%2Fb%3E");
  await expect(page.getByText("Google sign-in didn't work. Please try again, or use an email link.")).toBeVisible();
  await expect(page.getByText("unable_to_link_account")).toHaveCount(0);
});
