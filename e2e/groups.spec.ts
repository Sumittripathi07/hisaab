import { expect, test } from "@playwright/test";
import { signInAndOnboard } from "./helpers";

test("the root sends a signed-out visitor to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("create a group from the empty dashboard", async ({ page }) => {
  await signInAndOnboard(page, "asha@example.test", "Asha");
  await expect(page.getByText("No groups yet")).toBeVisible();
  await page.getByRole("button", { name: "Create a group" }).click();
  await page.getByLabel("Group name").fill("Goa Trip");
  await page.getByRole("radio", { name: "Trip" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/c/);
  await expect(page.getByRole("heading", { name: "Goa Trip" })).toBeVisible();

  // Signed in, the root goes to the dashboard, which now lists the group.
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: /Goa Trip/ })).toBeVisible();

  // Onboarding's "Create a group" lands on ?new=1: the sheet opens focused, once, and closes like any other.
  await page.goto("/dashboard?new=1");
  await expect(page.getByLabel("Group name")).toBeFocused();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Group name")).toBeHidden();
  await page.reload();
  await expect(page.getByRole("link", { name: /Goa Trip/ })).toBeVisible();
  await expect(page.getByLabel("Group name")).toBeHidden();
});
