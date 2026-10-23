import { expect, test, type Browser, type Page } from "@playwright/test";
import { addPlaceholderViaUi, createGroupViaUi, signedInPage } from "./helpers";

test("add an expense with the keypad", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Goa Trip");
  await addPlaceholderViaUi(asha, "Ravi");
  await asha.getByRole("button", { name: "Add expense" }).click();
  for (const key of "1200") await asha.getByRole("button", { name: key, exact: true }).click();
  await expect(asha.getByText("₹1,200")).toBeVisible();
  await asha.getByRole("button", { name: "Next" }).click();
  await asha.getByLabel("Description").fill("Dinner at Thalassa");
  await expect(asha.getByRole("button", { name: /Food & drink/ })).toBeVisible();
  await asha.getByRole("button", { name: "Save", exact: true }).dblclick(); // a double tap still makes one expense
  await expect(asha.getByRole("link", { name: /Dinner at Thalassa/ })).toHaveCount(1);
  await expect(asha.getByText("you lent ₹600")).toBeVisible();
});

test("the keypad can't type more decimals than the currency has", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Decimals");
  await asha.getByRole("button", { name: "Add expense" }).click();
  for (const key of ["1", "Decimal point", "2", "3", "4"]) await asha.getByRole("button", { name: key, exact: true }).click();
  await expect(asha.getByText("₹1.23")).toBeVisible();
  await asha.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(asha.getByText("₹1.2", { exact: true })).toBeVisible();
});

test("on a phone: the + button, pick the group, type, save", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Flat 302 phone");
  await asha.setViewportSize({ width: 375, height: 812 });
  await asha.goto("/dashboard");
  await asha.getByRole("button", { name: "Add expense" }).click();
  await expect(asha.getByRole("heading", { name: "Add an expense to…" })).toBeVisible();
  await asha.getByRole("link", { name: /Flat 302 phone/ }).click();

  // The sheet opens on arrival, and the one-shot ?add=1 is dropped from the address.
  await expect(asha.getByRole("heading", { name: "Add expense" })).toBeVisible();
  await expect(asha).toHaveURL(/\/groups\/c[^?]*$/);
  // A physical keyboard types into the keypad too.
  await asha.keyboard.type("250.567");
  await expect(asha.getByText("₹250.56", { exact: true })).toBeVisible();
  await asha.keyboard.press("Backspace");
  await expect(asha.getByText("₹250.5", { exact: true })).toBeVisible();
  await asha.getByRole("button", { name: "Next" }).click();
  await asha.getByLabel("Description").fill("Chai");
  await asha.getByRole("button", { name: "Save", exact: true }).click();
  await expect(asha.getByRole("link", { name: /Chai/ })).toBeVisible();
  await expect(asha.getByRole("heading", { name: "Add expense" })).toBeHidden();
});

/** Opens the add sheet on the group page, types the amount on the keypad and describes it: step 2, ready for the chips. */
async function startExpense(page: Page, amount: string, description: string) {
  await page.getByRole("button", { name: "Add expense" }).click();
  for (const key of amount) await page.getByRole("button", { name: key, exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Description").fill(description);
  return page.getByRole("dialog", { name: "Add expense" });
}

/** Asha's group with two people who have no account yet. */
async function threePeople(browser: Browser, groupName: string) {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, groupName);
  await addPlaceholderViaUi(asha, "Ravi");
  await addPlaceholderViaUi(asha, "Rahul");
  return asha;
}

test("split by shares with an adjustment and two payers", async ({ browser }) => {
  const asha = await threePeople(browser, "Road trip");
  const sheet = await startExpense(asha, "1000", "Fuel");
  await sheet.getByRole("button", { name: "Split equally" }).click();
  await sheet.getByRole("radio", { name: "Shares" }).check();
  await expect(sheet.getByRole("button", { name: "By shares" })).toBeVisible();
  await sheet.getByRole("button", { name: "More shares for Asha" }).click();
  await expect(sheet.getByLabel("Shares for Asha", { exact: true })).toHaveValue("2");
  await sheet.getByLabel("Shares for Ravi", { exact: true }).fill("1");
  await sheet.getByLabel("Shares for Rahul", { exact: true }).fill("1");
  await sheet.getByRole("switch", { name: "Adjustments (+/−)" }).click();
  await sheet.getByLabel("Adjustment for Rahul").fill("100");
  await expect(sheet.getByText("Asha ₹450 · Ravi ₹225 · Rahul ₹325")).toBeVisible();

  await sheet.getByRole("button", { name: "Paid by you" }).click();
  await sheet.getByRole("radio", { name: "Multiple people" }).check();
  await sheet.getByLabel("Amount Asha paid").fill("600");
  await sheet.getByLabel("Amount Ravi paid").fill("300");
  await expect(sheet.getByText("₹100 of the total isn't paid by anyone")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await sheet.getByLabel("Amount Ravi paid").fill("400");
  await expect(sheet.getByRole("button", { name: "Paid by 2 people" })).toBeVisible();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();

  const row = asha.getByRole("link", { name: /Fuel/ });
  await expect(row).toContainText("2 people paid");
  // What was stored is what the preview showed: Asha paid 600 and owes 450.
  await expect(row).toContainText("you lent ₹150");
});

test("exact amounts show what is left to assign", async ({ browser }) => {
  const asha = await threePeople(browser, "Flat bills");
  const sheet = await startExpense(asha, "1000", "Electricity");
  await sheet.getByRole("button", { name: "Split equally" }).click();
  await sheet.getByRole("radio", { name: "Exact amounts" }).check();
  await sheet.getByLabel("Amount for Asha").fill("500");
  await sheet.getByLabel("Amount for Ravi").fill("380");
  await expect(sheet.getByText("₹120 left to assign")).toBeVisible();
  const save = sheet.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await sheet.getByLabel("Amount for Rahul").fill("120");
  await expect(sheet.getByText("Asha ₹500 · Ravi ₹380 · Rahul ₹120")).toBeVisible();
  await expect(save).toBeEnabled();
});

test("itemised split shares tax and tip in proportion", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Dinner club");
  await addPlaceholderViaUi(asha, "Ravi");
  const sheet = await startExpense(asha, "550", "Dinner");
  await sheet.getByRole("button", { name: "Split equally" }).click();
  await sheet.getByRole("radio", { name: "Items" }).check();
  const first = sheet.getByRole("group", { name: "Item 1", exact: true });
  await first.getByLabel("Item name").fill("Paneer tikka");
  await first.getByLabel("Amount").fill("300");
  await first.getByRole("checkbox", { name: "Asha" }).check();
  await sheet.getByRole("button", { name: "Add item" }).click();
  const second = sheet.getByRole("group", { name: "Item 2", exact: true });
  await second.getByLabel("Item name").fill("Biryani");
  await second.getByLabel("Amount").fill("200");
  await second.getByRole("checkbox", { name: "Asha" }).check();
  await second.getByRole("checkbox", { name: "Ravi" }).check();
  await expect(sheet.getByText("Tax, tip & service: ₹50 — shared in proportion to what each person had")).toBeVisible();
  await expect(sheet.getByText("Asha ₹440 · Ravi ₹110")).toBeVisible();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  // Stored as previewed: Asha paid 550 and owes 440.
  await expect(asha.getByRole("link", { name: /Dinner/ })).toContainText("you lent ₹110");
});
