import { expect, test, type Browser, type Page } from "@playwright/test";
import { addExpenseViaUi, addPlaceholderViaUi, createGroupViaUi, inviteAndJoin, signedInPage } from "./helpers";

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

/** Adds "Dinner" for ₹1,200 and opens it. */
async function openDinner(page: Page, groupName: string) {
  await createGroupViaUi(page, groupName);
  await addExpenseViaUi(page, { amount: "1200", description: "Dinner" });
  await page.getByRole("link", { name: /Dinner/ }).click();
  await expect(page.getByRole("heading", { name: "Dinner", level: 1 })).toBeVisible();
}

test("edit, delete and undo", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await openDinner(asha, "Edit and undo");
  await expect(asha.getByText("Added by Asha")).toBeVisible();

  await asha.getByRole("button", { name: "Edit", exact: true }).click();
  const sheet = asha.getByRole("dialog", { name: "Edit expense" });
  await sheet.getByRole("button", { name: "Change amount" }).click();
  for (let i = 0; i < "1200".length; i++) await sheet.getByRole("button", { name: "Delete", exact: true }).click();
  for (const key of "1500") await sheet.getByRole("button", { name: key, exact: true }).click();
  await sheet.getByRole("button", { name: "Next" }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(asha.getByText("Expense saved")).toBeVisible();
  await expect(asha.getByText("₹1,500").first()).toBeVisible();
  await expect(asha.getByText("You edited “Dinner”")).toBeVisible();
  await expect(asha.getByText("amount ₹1,200 → ₹1,500")).toBeVisible();

  // No "are you sure?": the group page says it was deleted, and Undo brings it back.
  await asha.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(asha).toHaveURL(/\/groups\/c[^/?]*$/);
  await expect(asha.getByText("Expense deleted")).toBeVisible();
  await expect(asha.getByRole("link", { name: /Dinner/ })).toHaveCount(0);
  await asha.getByRole("button", { name: "Undo" }).click();
  await expect(asha.getByText("Expense restored")).toBeVisible();
  await expect(asha.getByRole("link", { name: /Dinner/ })).toContainText("₹1,500");
});

test("search and filter the expense list", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Search and filter");
  await addExpenseViaUi(asha, { amount: "300", description: "Dinner" });
  await addExpenseViaUi(asha, { amount: "450", description: "Uber to airport" });
  await addExpenseViaUi(asha, { amount: "2000", description: "50% off shoes" });
  const rows = {
    dinner: asha.getByRole("link", { name: /Dinner/ }),
    uber: asha.getByRole("link", { name: /Uber/ }),
    shoes: asha.getByRole("link", { name: /shoes/ }),
  };

  // A % in the search means a %, not "anything".
  const search = asha.getByLabel("Search expenses");
  await search.fill("50%");
  await expect(rows.shoes).toBeVisible();
  await expect(rows.dinner).toHaveCount(0);
  await expect(rows.uber).toHaveCount(0);
  await search.fill("zzz");
  await expect(asha.getByText("No expenses match")).toBeVisible();
  await asha.getByRole("link", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await expect(rows.dinner).toBeVisible();
  await expect(rows.uber).toBeVisible();
  await expect(rows.shoes).toBeVisible();

  await asha.getByRole("button", { name: "Filters", exact: true }).click();
  await asha.getByRole("dialog", { name: "Filters" }).getByLabel("Category").selectOption("transport");
  await asha.keyboard.press("Escape");
  await expect(rows.uber).toBeVisible();
  await expect(rows.dinner).toHaveCount(0);
  await expect(rows.shoes).toHaveCount(0);

  // A chip takes its filter off; the sheet's Clear filters takes them all.
  await expect(asha.getByRole("button", { name: /Remove filter: .*Transport/ })).toBeVisible();
  await asha.getByRole("button", { name: "Filters", exact: true }).click();
  await asha.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Clear filters" }).click();
  await asha.keyboard.press("Escape");
  await expect(rows.dinner).toBeVisible();
  await expect(rows.uber).toBeVisible();
  await expect(rows.shoes).toBeVisible();
  await expect(asha.getByRole("list", { name: "Active filters" })).toHaveCount(0);
});

test("a stale edit offers a reload", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  const groupUrl = await createGroupViaUi(asha, "Stale edits");
  // Ravi adds it, so he (who added it) and Asha (the owner) may both edit it.
  const ravi = await inviteAndJoin(asha, browser, "ravi.expenses@example.test", "Ravi");
  await addExpenseViaUi(ravi, { amount: "900", description: "Lunch" });
  await asha.goto(groupUrl);
  await asha.getByRole("link", { name: /Lunch/ }).click();
  await ravi.getByRole("link", { name: /Lunch/ }).click();
  await asha.getByRole("button", { name: "Edit", exact: true }).click();
  await ravi.getByRole("button", { name: "Edit", exact: true }).click();

  await ravi.getByLabel("Description").fill("Lunch at Taj");
  await ravi.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ravi.locator("h1")).toHaveText("Lunch at Taj");

  await asha.getByLabel("Description").fill("Lunch at Leela");
  await asha.getByRole("button", { name: "Save", exact: true }).click();
  await expect(asha.getByText("Ravi edited this just now — reload?")).toBeVisible();
  await asha.getByRole("button", { name: "Reload" }).click();
  await expect(asha.locator("h1")).toHaveText("Lunch at Taj");
});

test("comment on an expense", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await openDinner(asha, "Chatty");
  const post = asha.getByRole("button", { name: "Post" });
  await expect(post).toBeDisabled();
  await asha.getByLabel("Add a comment").fill("Who has the receipt?");
  await post.click();
  const comments = asha.getByRole("list", { name: "Comments" });
  await expect(comments).toContainText("Who has the receipt?");
  await expect(comments).toContainText("You");
  await expect(asha.getByLabel("Add a comment")).toHaveValue("");

  await comments.getByRole("button", { name: "Delete comment" }).click();
  await expect(asha.getByText("No comments yet.")).toBeVisible();
});

test("outsiders get a 404 for an expense", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await openDinner(asha, "Private");
  const mallory = await signedInPage(browser, "mallory.expenses@example.test", "Mallory");
  await mallory.goto(asha.url());
  await expect(mallory.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});

test("activity tells each person what they owe", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  const groupUrl = await createGroupViaUi(asha, "Goa Trip");
  const ravi = await inviteAndJoin(asha, browser, "ravi.expenses@example.test", "Ravi");
  await addExpenseViaUi(asha, { amount: "1480", description: "Dinner at Thalassa" });

  await asha.goto(`${groupUrl}?tab=activity`);
  const mine = asha.getByRole("listitem").filter({ hasText: "Dinner at Thalassa" });
  await expect(mine).toContainText("You added “Dinner at Thalassa”");
  await expect(mine).toContainText("you get back ₹740");

  await ravi.goto("/activity");
  await expect(ravi.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  const theirs = ravi.getByRole("listitem").filter({ hasText: "Dinner at Thalassa" });
  await expect(theirs).toContainText("Asha added “Dinner at Thalassa”");
  await expect(theirs).toContainText("you owe ₹740");
  await expect(theirs).toContainText("Goa Trip");
  await theirs.getByRole("link").click();
  await expect(ravi.getByRole("heading", { name: "Dinner at Thalassa", level: 1 })).toBeVisible();
});
