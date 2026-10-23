import { expect, test } from "@playwright/test";
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
