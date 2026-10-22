import { expect, test, type Page } from "@playwright/test";
import { lastEmailTo } from "../test/outbox";
import { completeOnboardingUi, createGroupViaUi, signedInPage, signInAndOnboard, signInWithMagicLink } from "./helpers";

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
  // The spent trigger stays spent: going somewhere and coming Back doesn't reopen it, nor does a reload.
  await page.getByRole("link", { name: "Groups", exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: /Goa Trip/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: /Goa Trip/ })).toBeVisible();
  await expect(page.getByLabel("Group name")).toBeHidden();

  // On a phone the sheet is a drawer, with a Close button for anyone who can't swipe or reach the backdrop.
  await page.setViewportSize({ width: 375, height: 812 });
  const fab = page.getByRole("button", { name: "Create a group" });
  await fab.click();
  await expect(page.getByLabel("Group name")).toBeFocused();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByLabel("Group name")).toBeHidden();
  await expect(fab).toBeFocused();
});

/** A person's row in the group's member list. */
const memberRow = (page: Page, name: string) => page.getByRole("list", { name: "Members" }).getByRole("listitem").filter({ hasText: name });

// Asha signed up in the test above; signedInPage reuses her session (see helpers.ts), so this run stays within
// Better Auth's sign-in limit.
test("signed-out friend opens the invite link, signs up, and joins", async ({ browser }) => {
  const a = await signedInPage(browser, "asha@example.test", "Asha");
  const groupUrl = await createGroupViaUi(a, "Goa Trip");
  await a.getByRole("button", { name: "Invite people" }).click();
  const invite = await a.getByLabel("Invite link").inputValue();
  await expect(a.getByRole("img", { name: "QR code for the invite link" })).toBeVisible();
  await a.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await a.getByRole("button", { name: "Copy link" }).click();
  await expect(a.getByText("Link copied")).toBeVisible();
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(invite);

  const b = await (await browser.newContext()).newPage();
  await b.goto(invite);
  await expect(b).toHaveURL(/\/sign-in\?callbackURL=%2Fjoin%2F/);
  await signInWithMagicLink(b, "ravi@example.test");
  await completeOnboardingUi(b, "Ravi");
  await expect(b).toHaveURL(new RegExp(new URL(invite).pathname));
  await expect(b.getByText("1 member: Asha")).toBeVisible();
  await b.getByRole("button", { name: "Join group" }).click();
  await expect(b).toHaveURL(groupUrl);
  await expect(b.getByText("Asha")).toBeVisible();

  await a.goto(groupUrl);
  await expect(a.getByText("Ravi")).toBeVisible();
});

test("placeholder invited by email claims their spot once", async ({ browser }) => {
  const a = await signedInPage(browser, "asha@example.test", "Asha");
  const groupUrl = await createGroupViaUi(a, "Flat 302");
  await a.getByRole("button", { name: "Invite people" }).click();
  const byEmail = a.getByRole("form", { name: "Invite by email" });
  await byEmail.getByLabel("Name").fill("Rahul");
  await byEmail.getByLabel("Email").fill("rahul@example.test");
  await byEmail.getByRole("button", { name: "Send invite" }).click();
  await expect(a.getByText("Invite sent to rahul@example.test")).toBeVisible();
  await a.keyboard.press("Escape");
  await expect(memberRow(a, "Rahul").getByText("Not joined yet")).toBeVisible();
  const claimUrl = (await lastEmailTo("rahul@example.test")).text.match(/https?:\/\/\S+\/claim\/\S+/)?.[0];
  if (!claimUrl) throw new Error("No claim link in the invite email");

  const b = await (await browser.newContext()).newPage();
  await b.goto(claimUrl);
  await expect(b).toHaveURL(/\/sign-in\?callbackURL=%2Fclaim%2F/);
  await signInWithMagicLink(b, "rahul@example.test");
  await completeOnboardingUi(b, "Rahul");
  await expect(b).toHaveURL(new RegExp(new URL(claimUrl).pathname));
  await expect(b.getByRole("heading", { name: "Join Flat 302 as Rahul" })).toBeVisible();
  await b.getByRole("button", { name: "Join group" }).click();
  await expect(b).toHaveURL(groupUrl);
  const rahul = memberRow(b, "Rahul");
  await expect(rahul).toBeVisible();
  await expect(rahul.getByText("Not joined yet")).toHaveCount(0);

  await b.goto(claimUrl);
  await expect(b.getByText("This link was already used or has been reset.")).toBeVisible();
  await expect(b.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
});

test("non-admins do not see group settings", async ({ browser }) => {
  const a = await signedInPage(browser, "asha@example.test", "Asha");
  const groupUrl = await createGroupViaUi(a, "Office lunches");
  await expect(a.getByRole("link", { name: "Group settings" })).toBeVisible();
  await a.getByRole("button", { name: "Invite people" }).click();
  const invite = await a.getByLabel("Invite link").inputValue();

  const r = await signedInPage(browser, "ravi@example.test", "Ravi");
  await r.goto(invite);
  await r.getByRole("button", { name: "Join group" }).click();
  await expect(r).toHaveURL(groupUrl);
  await expect(r.getByRole("heading", { name: "Office lunches", level: 1 })).toBeVisible();
  await expect(r.getByRole("link", { name: "Group settings" })).toHaveCount(0);
  // Members can still leave, from the group page.
  await expect(r.getByRole("button", { name: "Leave group" })).toBeVisible();

  await r.goto(`${groupUrl}/settings`);
  await expect(r.getByRole("heading", { name: "You don't have access" })).toBeVisible();
});

test("the owner runs the group from its settings", async ({ browser }) => {
  const a = await signedInPage(browser, "asha@example.test", "Asha");
  const groupUrl = await createGroupViaUi(a, "Cricket club");
  await a.getByRole("button", { name: "Invite people" }).click();
  const invite = await a.getByLabel("Invite link").inputValue();
  const r = await signedInPage(browser, "ravi@example.test", "Ravi");
  await r.goto(invite);
  await r.getByRole("button", { name: "Join group" }).click();
  await expect(r).toHaveURL(groupUrl);

  await a.goto(groupUrl);
  await a.getByRole("link", { name: "Group settings" }).click();
  await expect(a.getByRole("heading", { name: "Group settings" })).toBeVisible();

  // Rename.
  await a.getByLabel("Group name").fill("Cricket club 2026");
  await a.getByRole("button", { name: "Save changes" }).click();
  await expect(a.getByText("Changes saved")).toBeVisible();

  // Make Ravi an admin: he gets the settings cog.
  await a.getByRole("button", { name: "Actions for Ravi" }).click();
  await a.getByRole("menuitem", { name: "Make admin" }).click();
  await expect(memberRow(a, "Ravi").getByText("Admin", { exact: true })).toBeVisible();
  await r.reload();
  await expect(r.getByRole("heading", { name: "Cricket club 2026", level: 1 })).toBeVisible();
  await expect(r.getByRole("link", { name: "Group settings" })).toBeVisible();

  // Reset the invite link: the old one stops working.
  await a.getByRole("button", { name: "Reset invite link" }).click();
  await expect(a.getByText("The old link will stop working.")).toBeVisible();
  await a.getByRole("button", { name: "Reset link" }).click();
  await expect(a.getByText("Invite link reset")).toBeVisible();
  await r.goto(invite);
  await expect(r.getByText("This invite link is invalid or has been reset.")).toBeVisible();

  // The owner can't leave, and is told how to.
  await expect(a.getByRole("button", { name: "Leave group" })).toHaveCount(0);
  await expect(a.getByText("Make someone else the owner")).toBeVisible();
});
