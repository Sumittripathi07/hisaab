import { expect, test, type Browser, type Page } from "@playwright/test";
import { addExpenseViaUi, addPlaceholderViaUi, createGroupViaUi, inviteAndJoin, newPage, signInAndOnboard } from "./helpers";

/** Asha (with a UPI ID) and Ravi in a group; Asha paid ₹1,700 for the hotel, split equally, so Ravi owes her ₹850. */
async function ashaAndRavi(browser: Browser, tag: string, groupName: string) {
  const asha = await newPage(browser);
  await signInAndOnboard(asha, `asha.${tag}@example.test`, "Asha", { upiId: "asha@okicici" });
  const groupUrl = await createGroupViaUi(asha, groupName);
  const ravi = await inviteAndJoin(asha, browser, `ravi.${tag}@example.test`, "Ravi");
  await addExpenseViaUi(asha, { amount: "1700", description: "Hotel" });
  return { asha, ravi, groupUrl };
}

test("pay by UPI, mark as paid, then the payee disputes", async ({ browser }) => {
  const { asha, ravi, groupUrl } = await ashaAndRavi(browser, "settle", "Goa Trip");

  await ravi.goto(`${groupUrl}/settle`);
  await expect(ravi.getByRole("heading", { name: "Settle up", level: 1 })).toBeVisible();
  await expect(ravi.getByText("You pay Asha ₹850")).toBeVisible();
  await expect(ravi.getByRole("link", { name: "Pay ₹850 via UPI" })).toHaveAttribute(
    "href",
    "upi://pay?pa=asha@okicici&pn=Asha&am=850.00&cu=INR&tn=Hisaab%3A%20Goa%20Trip",
  );
  await expect(ravi.getByRole("img", { name: "QR code to pay Asha ₹850 by UPI" })).toBeVisible();
  await ravi.getByRole("button", { name: "Mark as paid" }).dblclick(); // a double tap still records one payment
  await expect(ravi.getByText("All settled up 🎉")).toBeVisible();

  await asha.goto(`${groupUrl}?tab=balances`);
  await expect(asha.getByText("All settled up 🎉")).toBeVisible();
  await expect(asha.getByRole("link", { name: /Ravi paid Asha ₹850/ })).toHaveCount(1);
  await asha.getByRole("link", { name: /Ravi paid Asha ₹850/ }).click();
  await asha.getByRole("button", { name: "I didn't receive this" }).click();
  await expect(asha.getByRole("alertdialog", { name: "Mark as not received?" })).toBeVisible();
  await asha.getByRole("button", { name: "Not received" }).click();
  await expect(asha.getByRole("alertdialog")).toBeHidden();
  await expect(asha.getByText("Disputed")).toBeVisible();

  await ravi.goto(`${groupUrl}?tab=balances`);
  await expect(ravi.getByText("You owe ₹850")).toBeVisible();
  await expect(ravi.getByText("Ravi pays Asha ₹850")).toBeVisible();
  await expect(ravi.getByText("Disputed")).toBeVisible();
});

test("on a phone the QR code waits behind a button", async ({ browser }) => {
  const { ravi, groupUrl } = await ashaAndRavi(browser, "phone", "Phone Trip");
  await ravi.setViewportSize({ width: 375, height: 812 });
  await ravi.goto(`${groupUrl}/settle`);
  const qr = ravi.getByRole("img", { name: "QR code to pay Asha ₹850 by UPI" });
  await expect(ravi.getByRole("link", { name: "Pay ₹850 via UPI" })).toBeVisible();
  await expect(qr).toBeHidden();
  await ravi.getByRole("button", { name: "Show QR code" }).click();
  await expect(qr).toBeVisible();
});

test("a partial payment leaves the rest to settle", async ({ browser }) => {
  const { ravi, groupUrl } = await ashaAndRavi(browser, "partial", "Partial Trip");
  await ravi.goto(`${groupUrl}/settle`);
  await ravi.getByRole("button", { name: "Record a payment" }).click();
  const sheet = ravi.getByRole("dialog", { name: "Record a payment" });
  await expect(sheet.getByLabel("Amount")).toHaveValue("850");
  await sheet.getByLabel("Amount").fill("300");
  await sheet.getByRole("radio", { name: "Cash" }).check();
  await sheet.getByRole("button", { name: "Record payment" }).click();
  await expect(ravi.getByText("Payment recorded")).toBeVisible();
  await expect(ravi.getByText("You pay Asha ₹550")).toBeVisible();
});

/** Asha makes a USD group with Ravi in it, and Ravi owes her $50. */
async function usdGroup(browser: Browser, tag: string): Promise<{ asha: Page; ravi: Page; groupUrl: string }> {
  const asha = await newPage(browser);
  await signInAndOnboard(asha, `asha.${tag}@example.test`, "Asha", { upiId: "asha@okicici" });
  const groupUrl = await createGroupViaUi(asha, "Dollar Trip", "USD");
  const ravi = await inviteAndJoin(asha, browser, `ravi.${tag}@example.test`, "Ravi");
  await addExpenseViaUi(asha, { amount: "100", description: "Taxi" });
  return { asha, ravi, groupUrl };
}

test("a USD group offers recording, not UPI", async ({ browser }) => {
  const { ravi, groupUrl } = await usdGroup(browser, "usd");
  await ravi.goto(`${groupUrl}/settle`);
  await expect(ravi.getByText("You pay Asha $50")).toBeVisible();
  await expect(ravi.getByRole("link", { name: /via UPI/ })).toHaveCount(0);
  await ravi.getByRole("button", { name: "Record a payment" }).click();
  const sheet = ravi.getByRole("dialog", { name: "Record a payment" });
  await sheet.getByRole("radio", { name: "Cash" }).check();
  await sheet.getByRole("button", { name: "Record payment" }).click();
  await expect(ravi.getByText("Payment recorded")).toBeVisible();
  await expect(ravi.getByText("All settled up 🎉")).toBeVisible();
});

test("the payer can edit and delete a payment, and undo the delete", async ({ browser }) => {
  const { ravi, groupUrl } = await usdGroup(browser, "undo");
  await ravi.goto(`${groupUrl}/settle`);
  await ravi.getByRole("button", { name: "Record a payment" }).click();
  await ravi.getByRole("dialog", { name: "Record a payment" }).getByRole("button", { name: "Record payment" }).click();
  await expect(ravi.getByText("All settled up 🎉")).toBeVisible();

  await ravi.goto(`${groupUrl}?tab=balances`);
  await ravi.getByRole("link", { name: /Ravi paid Asha \$50/ }).click();
  await ravi.getByRole("button", { name: "Edit", exact: true }).click();
  const sheet = ravi.getByRole("dialog", { name: "Edit payment" });
  await sheet.getByLabel("Amount").fill("20");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(ravi.getByRole("heading", { name: "Ravi paid Asha $20", level: 1 })).toBeVisible();

  await ravi.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(ravi.getByText("Payment deleted")).toBeVisible();
  await ravi.getByRole("button", { name: "Undo" }).click();
  await expect(ravi.getByText("Payment restored")).toBeVisible();
  await ravi.goto(`${groupUrl}?tab=balances`);
  await expect(ravi.getByRole("link", { name: /Ravi paid Asha \$20/ })).toHaveCount(1);
});

test("the dashboard totals what you owe and are owed", async ({ browser }) => {
  const asha = await newPage(browser);
  await signInAndOnboard(asha, "asha.totals@example.test", "Asha");
  await createGroupViaUi(asha, "Totals Trip");
  await addPlaceholderViaUi(asha, "Ravi");
  await addExpenseViaUi(asha, { amount: "1700", description: "Hotel" });

  await asha.goto("/dashboard");
  // The header and the group's card both say it, in different case.
  await expect(asha.getByText("You're owed ₹850", { exact: true })).toBeVisible();
  await expect(asha.getByRole("link", { name: /Totals Trip/ })).toContainText("you're owed ₹850");
});

test("leaving with a balance says what to settle", async ({ browser }) => {
  const { ravi, groupUrl } = await ashaAndRavi(browser, "leave", "Leave Trip");
  await ravi.goto(groupUrl);
  await ravi.getByRole("button", { name: "Leave group" }).click();
  await ravi.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(ravi.getByRole("alertdialog").getByText("Settle up before leaving: you owe ₹850.")).toBeVisible();
});
