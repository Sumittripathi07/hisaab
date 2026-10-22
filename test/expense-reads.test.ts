import { beforeEach, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { db } from "@/lib/db";
import type { ExpenseInput } from "@/lib/validation";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createExpense, deleteExpense, getExpense, getExpenseFormData, listExpenses } from "@/server/expenses";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createCommentRow, createGroup, createUser, memberOf } from "./factories";

let asha: User, ravi: User;
let g: Group;
let ashaM: GroupMember, raviM: GroupMember, rahulM: GroupMember;

beforeEach(async () => {
  await resetDb();
  asha = await createUser({ name: "Asha" });
  ravi = await createUser({ name: "Ravi", image: "https://example.test/ravi.png" });
  g = await createGroup(asha.id);
  ashaM = await memberOf(g.id, asha.id);
  raviM = await addMember(g.id, { userId: ravi.id });
  rahulM = await addMember(g.id, { displayName: "Rahul" });
  // Joined in this order, a second apart: createdAt is stored to the millisecond, so back-to-back rows could tie.
  for (const [i, m] of [ashaM, raviM, rahulM].entries()) {
    await db.groupMember.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
  }
});

type Fields = Omit<ExpenseInput, "groupId">;
/** ₹1,000, paid by Asha, split equally among all three. */
const fields = (overrides: Partial<Fields> = {}): Fields => ({
  description: "Dinner",
  amount: 100000n,
  category: "food",
  date: "2026-10-20",
  notes: null,
  payers: [{ memberId: ashaM.id, value: 100000n }],
  split: { method: "EQUAL", memberIds: [ashaM.id, raviM.id, rahulM.id], adjustments: [] },
  ...overrides,
});
const add = (overrides: Partial<Fields> = {}, by: User = asha) => createExpense(by.id, { groupId: g.id, ...fields(overrides) });
const equal = (memberIds: string[]) => ({ method: "EQUAL" as const, memberIds, adjustments: [] });
/** `amount` paid by `payer` and split equally among `among`. */
const paid = (payer: GroupMember, among: GroupMember[], overrides: Partial<Fields> = {}) =>
  fields({ payers: [{ memberId: payer.id, value: 100000n }], split: equal(among.map((m) => m.id)), ...overrides });
/** Pins when an expense was added, which breaks ties between expenses on the same date. */
const addedAt = (id: string, second: number) =>
  db.expense.update({ where: { id }, data: { createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, second)) } });
/** An expense in a second group Asha owns, whose other member has since left. Returns the expense id. */
async function expenseElsewhere(description: string): Promise<string> {
  const other = await createGroup(asha.id);
  const mine = await memberOf(other.id, asha.id);
  const friend = await addMember(other.id, { displayName: "Leaver" });
  const payers = [{ memberId: mine.id, value: 100000n }];
  const { id } = await createExpense(asha.id, { groupId: other.id, ...fields({ description, payers, split: equal([mine.id, friend.id]) }) });
  await db.groupMember.update({ where: { id: friend.id }, data: { leftAt: new Date() } });
  return id;
}
const descriptions = async (userId: string, filters: Parameters<typeof listExpenses>[2] = {}) =>
  (await listExpenses(userId, g.id, filters)).items.map((item) => item.description);

describe("listExpenses", () => {
  it("lists newest first with what the viewer lent or owes", async () => {
    await add({ description: "Older", date: "2026-10-01" });
    const { id } = await add({ description: "Dinner", date: "2026-10-20" });

    const mine = await listExpenses(asha.id, g.id, {});
    expect(mine.hasMore).toBe(false);
    expect(mine.items.map((item) => item.description)).toEqual(["Dinner", "Older"]);
    expect(mine.items[0]).toEqual({
      id,
      description: "Dinner",
      category: "food",
      date: "2026-10-20",
      amount: 100000n,
      currency: "INR",
      payerLabel: "You paid",
      myNet: 66666n,
      commentCount: 0,
    });
    expect((await listExpenses(ravi.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "Asha paid", myNet: -33333n });
  });

  it("orders by date, then by when it was added", async () => {
    const a = await add({ description: "A", date: "2026-10-20" });
    const b = await add({ description: "B", date: "2026-10-20" });
    const c = await add({ description: "C", date: "2026-10-25" });
    const d = await add({ description: "D", date: "2026-10-01" });
    await addedAt(a.id, 2);
    await addedAt(b.id, 1);
    await addedAt(c.id, 0);
    await addedAt(d.id, 3);
    expect(await descriptions(asha.id)).toEqual(["C", "A", "B", "D"]);
  });

  it("shows 0 when the viewer is not in the expense", async () => {
    await add(paid(ashaM, [ashaM, raviM]));
    const priya = await createUser({ name: "Priya" });
    await addMember(g.id, { userId: priya.id });
    expect((await listExpenses(priya.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "Asha paid", myNet: 0n });
  });

  it("labels several payers", async () => {
    await add({
      payers: [
        { memberId: ashaM.id, value: 60000n },
        { memberId: raviM.id, value: 40000n },
      ],
    });
    // Asha paid 60,000 and owes 33,334.
    expect((await listExpenses(asha.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "2 people paid", myNet: 26666n });
    expect((await listExpenses(ravi.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "2 people paid", myNet: 6667n });
  });

  it("counts comments that were not deleted", async () => {
    const { id } = await add();
    await createCommentRow({ groupId: g.id, authorMemberId: raviM.id, expenseId: id });
    await createCommentRow({ groupId: g.id, authorMemberId: raviM.id, expenseId: id });
    const gone = await createCommentRow({ groupId: g.id, authorMemberId: raviM.id, expenseId: id });
    await db.comment.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    expect((await listExpenses(asha.id, g.id, {})).items[0]?.commentCount).toBe(2);
  });

  it("searches description and notes literally", async () => {
    await add({ description: "500 rupees" });
    await add({ description: "50% off" });
    await add({ description: "Snacks", notes: "under_score" });
    await add({ description: "C:\\temp" });
    await expenseElsewhere("50% off");

    expect(await descriptions(asha.id, { q: "50%" })).toEqual(["50% off"]);
    expect(await descriptions(asha.id, { q: "_" })).toEqual(["Snacks"]);
    expect(await descriptions(asha.id, { q: "\\" })).toEqual(["C:\\temp"]);
    expect(await descriptions(asha.id, { q: "RUPEES" })).toEqual(["500 rupees"]);
    expect(await descriptions(asha.id, { q: "UNDER_s" })).toEqual(["Snacks"]);
    expect(await descriptions(asha.id, { q: "nothing like this" })).toEqual([]);
    expect(await descriptions(asha.id, { q: "  " })).toHaveLength(4);
  });

  it("does not search deleted expenses", async () => {
    const { id } = await add({ description: "Pizza" });
    await deleteExpense(asha.id, id);
    expect(await descriptions(asha.id, { q: "pizza" })).toEqual([]);
  });

  it("filters by member, category and date range", async () => {
    await add(paid(ashaM, [ashaM, raviM], { description: "Dinner", category: "food", date: "2026-10-01" }));
    await add(paid(raviM, [raviM, rahulM], { description: "Cab", category: "transport", date: "2026-10-10" }));
    await add(paid(ashaM, [ashaM, rahulM], { description: "Rent", category: "rent", date: "2026-10-20" }));

    // A payer or a share both count.
    expect(await descriptions(asha.id, { memberId: raviM.id })).toEqual(["Cab", "Dinner"]);
    expect(await descriptions(asha.id, { memberId: rahulM.id })).toEqual(["Rent", "Cab"]);
    expect(await descriptions(asha.id, { memberId: ashaM.id })).toEqual(["Rent", "Dinner"]);
    expect(await descriptions(asha.id, { category: "transport" })).toEqual(["Cab"]);
    // Both ends of the range are inclusive.
    expect(await descriptions(asha.id, { from: "2026-10-10" })).toEqual(["Rent", "Cab"]);
    expect(await descriptions(asha.id, { to: "2026-10-10" })).toEqual(["Cab", "Dinner"]);
    expect(await descriptions(asha.id, { from: "2026-10-10", to: "2026-10-10" })).toEqual(["Cab"]);
    expect(await descriptions(asha.id, { memberId: rahulM.id, from: "2026-10-15", q: "re" })).toEqual(["Rent"]);
    // Not a date: ignored rather than an error.
    expect(await descriptions(asha.id, { from: "soon" })).toHaveLength(3);
  });

  it("says when there is more", async () => {
    for (const description of ["A", "B", "C"]) await add({ description });
    const two = await listExpenses(asha.id, g.id, {}, 2);
    expect(two.items).toHaveLength(2);
    expect(two.hasMore).toBe(true);
    expect(await listExpenses(asha.id, g.id, {}, 3)).toMatchObject({ hasMore: false });
    // Clamped to at least one.
    const none = await listExpenses(asha.id, g.id, {}, 0);
    expect(none.items).toHaveLength(1);
    expect(none.hasMore).toBe(true);
  });

  it("leaves out deleted expenses", async () => {
    await add({ description: "Kept" });
    const { id } = await add({ description: "Removed" });
    await deleteExpense(asha.id, id);
    expect(await descriptions(asha.id)).toEqual(["Kept"]);
  });
});

describe("getExpense", () => {
  it("shows payers, shares and who can edit", async () => {
    const priya = await createUser({ name: "Priya" });
    const priyaM = await addMember(g.id, { userId: priya.id });
    // Sent out of join order, read back in it.
    const payers = [
      { memberId: raviM.id, value: 40000n },
      { memberId: ashaM.id, value: 60000n },
    ];
    const { id } = await add({ notes: "Table for six", payers }, ravi);

    const detail = await getExpense(asha.id, id);
    expect(detail.expense).toEqual({
      id,
      groupId: g.id,
      description: "Dinner",
      category: "food",
      notes: "Table for six",
      date: "2026-10-20",
      amount: 100000n,
      currency: "INR",
      splitMethod: "EQUAL",
      version: 1,
      createdAt: expect.any(Date),
      createdBy: "Ravi",
    });
    expect(detail.split).toEqual({ method: "EQUAL", memberIds: [ashaM.id, raviM.id, rahulM.id], adjustments: [] });
    expect(detail.payers).toEqual([
      { memberId: ashaM.id, displayName: "Asha", amount: 60000n },
      { memberId: raviM.id, displayName: "Ravi", amount: 40000n },
    ]);
    expect(detail.shares).toEqual([
      { memberId: ashaM.id, displayName: "Asha", amount: 33334n },
      { memberId: raviM.id, displayName: "Ravi", amount: 33333n },
      { memberId: rahulM.id, displayName: "Rahul", amount: 33333n },
    ]);
    expect(detail.shares.reduce((sum, share) => sum + share.amount, 0n)).toBe(detail.expense.amount);

    expect((await getExpense(ravi.id, id)).canEdit).toBe(true); // who added it
    expect(detail.canEdit).toBe(true); // the owner
    expect((await getExpense(priya.id, id)).canEdit).toBe(false); // another member
    await db.groupMember.update({ where: { id: priyaM.id }, data: { role: "ADMIN" } });
    expect((await getExpense(priya.id, id)).canEdit).toBe(true);
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    expect((await getExpense(ravi.id, id)).canEdit).toBe(false);
  });

  it("treats a deleted expense as gone", async () => {
    const { id } = await add();
    await deleteExpense(asha.id, id);
    const error = await getExpense(asha.id, id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as Error).message).toBe("This expense was deleted.");
  });
});

describe("getExpenseFormData", () => {
  it("lists active members in join order, plus anyone who left but is on the expense", async () => {
    const kabir = await addMember(g.id, { displayName: "Kabir" });
    const meera = await addMember(g.id, { displayName: "Meera" });
    for (const [i, m] of [kabir, meera].entries()) {
      await db.groupMember.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 3 + i)) } });
    }
    const { id } = await add(paid(ashaM, [ashaM, kabir]));
    await db.groupMember.updateMany({ where: { id: { in: [kabir.id, meera.id] } }, data: { leftAt: new Date() } });

    const current = await getExpenseFormData(asha.id, g.id);
    expect(current.members).toEqual([
      { id: ashaM.id, displayName: "Asha", image: null, isPlaceholder: false, active: true },
      { id: raviM.id, displayName: "Ravi", image: "https://example.test/ravi.png", isPlaceholder: false, active: true },
      { id: rahulM.id, displayName: "Rahul", image: null, isPlaceholder: true, active: true },
    ]);
    expect(current).toMatchObject({ groupId: g.id, groupName: g.name, currency: "INR", me: ashaM.id });

    const editing = await getExpenseFormData(asha.id, g.id, id);
    expect(editing.members.map((m) => [m.displayName, m.active])).toEqual([
      ["Asha", true],
      ["Ravi", true],
      ["Rahul", true],
      ["Kabir", false],
    ]);
  });

  it("ignores an expense from another group", async () => {
    const { members } = await getExpenseFormData(asha.id, g.id, await expenseElsewhere("Dinner"));
    expect(members.map((m) => m.displayName)).toEqual(["Asha", "Ravi", "Rahul"]);
  });

  it("gives today in the person's own time zone", async () => {
    for (const timezone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      await db.user.update({ where: { id: asha.id }, data: { timezone } });
      expect((await getExpenseFormData(asha.id, g.id)).today).toBe(todayIn(timezone));
    }
  });

  it("offers past descriptions, newest first, once each", async () => {
    const rows = [
      await add({ description: "Dinner", category: "food" }),
      await add({ description: "Cab", category: "transport" }),
      await add({ description: "dinner", category: "other" }),
      await add({ description: "Removed", category: "gifts" }),
      await add({ description: "Old", category: "rent", date: "2025-01-01" }),
    ];
    await deleteExpense(asha.id, rows[3]!.id);
    for (const [i, row] of rows.entries()) await addedAt(row.id, i);

    const { history } = await getExpenseFormData(asha.id, g.id);
    expect(history).toEqual([
      { description: "Old", category: "rent" },
      { description: "dinner", category: "other" },
      { description: "Cab", category: "transport" },
    ]);
  });

  it("caps the history at 200", async () => {
    await db.expense.createMany({
      data: Array.from({ length: 210 }, (_, i) => ({
        groupId: g.id,
        description: `Item ${i}`,
        category: "other",
        date: new Date("2026-01-15"),
        currency: "INR",
        amount: 100n,
        baseAmount: 100n,
        splitMethod: "EQUAL" as const,
        splitInput: {},
        createdByMemberId: ashaM.id,
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)),
      })),
    });
    const { history } = await getExpenseFormData(asha.id, g.id);
    expect(history).toHaveLength(200);
    expect(history[0]?.description).toBe("Item 209");
  });
});

describe("outsiders", () => {
  it("are forbidden", async () => {
    const { id } = await add();
    const stranger = await createUser();
    const leaver = await createUser();
    await addMember(g.id, { userId: leaver.id, leftAt: new Date() });
    for (const outsider of [stranger, leaver]) {
      await expect(listExpenses(outsider.id, g.id, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getExpense(outsider.id, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getExpenseFormData(outsider.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
