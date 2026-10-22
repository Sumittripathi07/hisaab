import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

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

test("expired or used magic link shows a friendly message", async ({ page }) => {
  await page.goto("/sign-in?error=INVALID_TOKEN");
  await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
});
