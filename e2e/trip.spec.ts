import { expect, test, type Locator, type Page } from "@playwright/test";
import { addPlaceholderViaUi, createGroupViaUi, signedInPage } from "./helpers";

/**
 * Phase 2's "done when": the six expenses of test/balances.test.ts's 5-person trip, entered through the sheet, give the same
 * balances and four suggested payments, and recording those payments settles everyone to exactly zero.
 */

/** Adds an expense paid by you and split equally unless `configure` (given the open sheet, on step 2) changes that. */
async function addExpense(page: Page, amount: string, description: string, configure?: (sheet: Locator) => Promise<void>) {
  await page.getByRole("button", { name: "Add expense" }).click();
  for (const key of amount) await page.getByRole("button", { name: key === "." ? "Decimal point" : key, exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Description").fill(description);
  const sheet = page.getByRole("dialog", { name: "Add expense" });
  await configure?.(sheet);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: description })).toBeVisible();
  await expect(sheet).toBeHidden();
}

/** Opens the "Paid by you" chip and taps one person, which closes the panel (so it's a click: `check` waits for the radio to stay). */
async function paidBy(sheet: Locator, name: string) {
  await sheet.getByRole("button", { name: "Paid by you" }).click();
  await sheet.getByRole("radio", { name }).click();
  await expect(sheet.getByRole("button", { name: `Paid by ${name}` })).toBeVisible();
}

test("a 5-person trip with mixed splits settles to exactly zero", async ({ browser }) => {
  test.setTimeout(180_000);
  const asha = await signedInPage(browser, "asha.trip@example.test", "Asha");
  const groupUrl = await createGroupViaUi(asha, "Goa Trip");
  for (const name of ["Ravi", "Rahul", "Dev", "Meera"]) await addPlaceholderViaUi(asha, name);

  // 1. Equal, all five, paid by Asha.
  await addExpense(asha, "10000", "Hotel");

  // 2. Equal between three, paid by Ravi.
  await addExpense(asha, "1000", "Cab", async (sheet) => {
    await paidBy(sheet, "Ravi");
    await sheet.getByRole("button", { name: "Split equally" }).click();
    await sheet.getByRole("checkbox", { name: "Dev" }).uncheck();
    await sheet.getByRole("checkbox", { name: "Meera" }).uncheck();
    await expect(sheet.getByText("Asha ₹333.34 · Ravi ₹333.33 · Rahul ₹333.33")).toBeVisible();
  });

  // 3. Shares 2/1/1/1/1, paid by Asha and Rahul.
  await addExpense(asha, "3000", "Dinner", async (sheet) => {
    await sheet.getByRole("button", { name: "Paid by you" }).click();
    await sheet.getByRole("radio", { name: "Multiple people" }).check();
    await sheet.getByLabel("Amount Asha paid").fill("2000");
    await sheet.getByLabel("Amount Rahul paid").fill("1000");
    await expect(sheet.getByRole("button", { name: "Paid by 2 people" })).toBeVisible();
    await sheet.getByRole("button", { name: "Split equally" }).click();
    await sheet.getByRole("radio", { name: "Shares" }).check();
    await sheet.getByRole("button", { name: "More shares for Asha" }).click();
    await expect(sheet.getByText("Asha ₹1,000 · Ravi ₹500 · Rahul ₹500 · Dev ₹500 · Meera ₹500")).toBeVisible();
  });

  // 4. 20% each, paid by Dev. A price with paise: nothing may drift.
  await addExpense(asha, "999.99", "Tickets", async (sheet) => {
    await paidBy(sheet, "Dev");
    await sheet.getByRole("button", { name: "Split equally" }).click();
    await sheet.getByRole("radio", { name: "Percentages" }).check();
    for (const name of ["Asha", "Ravi", "Rahul", "Dev", "Meera"]) await sheet.getByLabel(`Percentage for ${name}`, { exact: true }).fill("20");
  });

  // 5. Itemised, paid by Meera; the ₹50 the items don't cover is shared in proportion.
  await addExpense(asha, "550", "Snacks", async (sheet) => {
    await paidBy(sheet, "Meera");
    await sheet.getByRole("button", { name: "Split equally" }).click();
    await sheet.getByRole("radio", { name: "Items" }).check();
    const first = sheet.getByRole("group", { name: "Item 1", exact: true });
    await first.getByLabel("Item name").fill("Snacks");
    await first.getByLabel("Amount").fill("300");
    await first.getByRole("checkbox", { name: "Asha" }).check();
    await sheet.getByRole("button", { name: "Add item" }).click();
    const second = sheet.getByRole("group", { name: "Item 2", exact: true });
    await second.getByLabel("Item name").fill("Drinks");
    await second.getByLabel("Amount").fill("200");
    await second.getByRole("checkbox", { name: "Asha" }).check();
    await second.getByRole("checkbox", { name: "Ravi" }).check();
    await expect(sheet.getByText("Tax, tip & service: ₹50 — shared in proportion to what each person had")).toBeVisible();
  });

  // 6. Equal between four with +₹100 on Dev, paid by Rahul.
  await addExpense(asha, "1000", "Fuel", async (sheet) => {
    await paidBy(sheet, "Rahul");
    await sheet.getByRole("button", { name: "Split equally" }).click();
    await sheet.getByRole("checkbox", { name: "Meera" }).uncheck();
    await sheet.getByRole("switch", { name: "Adjustments (+/−)" }).click();
    await sheet.getByLabel("Adjustment for Dev").fill("100");
    await expect(sheet.getByText("Asha ₹225 · Ravi ₹225 · Rahul ₹225 · Dev ₹325")).toBeVisible();
  });

  await asha.goto(`${groupUrl}?tab=balances`);
  await expect(asha.getByText("You're owed ₹7,801.66", { exact: true })).toBeVisible();
  await expect(asha.getByText("gets back ₹7,801.66", { exact: true })).toBeVisible();
  for (const line of ["owes ₹2,368.33", "owes ₹1,258.33", "owes ₹2,025.01", "owes ₹2,149.99"]) {
    await expect(asha.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(asha.getByText("Simplified to 4 payments")).toBeVisible();

  // Everyone owes Asha, so she records each payment she is owed from the settle page.
  await asha.goto(`${groupUrl}/settle`);
  for (const [name, amount, typed] of [
    ["Ravi", "₹2,368.33", "2368.33"],
    ["Meera", "₹2,149.99", "2149.99"],
    ["Dev", "₹2,025.01", "2025.01"],
    ["Rahul", "₹1,258.33", "1258.33"],
  ]) {
    const card = asha.getByRole("listitem").filter({ hasText: `${name} pays you ${amount}` });
    await card.getByRole("button", { name: "Record a payment" }).click();
    const sheet = asha.getByRole("dialog", { name: "Record a payment" });
    await expect(sheet.getByLabel("Amount")).toHaveValue(typed);
    await sheet.getByRole("radio", { name: "Cash" }).check();
    await sheet.getByRole("button", { name: "Record payment" }).click();
    await expect(card).toHaveCount(0);
  }
  await expect(asha.getByText("All settled up 🎉")).toBeVisible();

  await asha.goto(`${groupUrl}?tab=balances`);
  await expect(asha.getByText("All settled up 🎉")).toBeVisible();
  await expect(asha.getByText("settled up", { exact: true })).toHaveCount(5);
  await expect(asha.getByText("Suggested payments")).toHaveCount(0);

  await asha.goto("/dashboard");
  await expect(asha.getByRole("link", { name: /Goa Trip/ })).toContainText("settled up");
});
