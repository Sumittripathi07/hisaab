import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDay } from "@/lib/dates";
import { db } from "@/lib/db";
import type { ExpenseInput } from "@/lib/validation";
import { updateExpenseAction } from "@/server/actions/expenses";
import { ConflictError } from "@/server/errors";
import { createExpense, deleteExpense, restoreExpense, updateExpense } from "@/server/expenses";
import { listGroupsForUser } from "@/server/groups";
import type { SessionUser } from "@/server/session";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup, createUser, memberOf } from "./factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ONLY_EDITORS = "Only the person who added this expense or an admin can change it.";
const NOT_MEMBERS = "Everyone in the expense must be a current member of the group.";
const DELETED = "This expense was deleted.";

let asha: User, ravi: User;
let g: Group;
let ashaM: GroupMember, raviM: GroupMember, rahulM: GroupMember;

beforeEach(async () => {
  await resetDb();
  asha = await createUser({ name: "Asha" });
  ravi = await createUser({ name: "Ravi" });
  g = await createGroup(asha.id);
  ashaM = await memberOf(g.id, asha.id);
  raviM = await addMember(g.id, { userId: ravi.id });
  rahulM = await addMember(g.id, { displayName: "Rahul" });
  // Joined in this order, a second apart: createdAt is stored to the millisecond, so back-to-back rows could tie.
  for (const [i, m] of [ashaM, raviM, rahulM].entries()) {
    await db.groupMember.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
  }
});

const equal = (memberIds: string[]) => ({ method: "EQUAL" as const, memberIds, adjustments: [] });
type Fields = Omit<ExpenseInput, "groupId">;
/** ₹1,000, paid by Asha, split equally among all three. */
const fields = (overrides: Partial<Fields> = {}): Fields => ({
  description: "Dinner",
  amount: 100000n,
  category: "food",
  date: "2026-10-20",
  notes: null,
  payers: [{ memberId: ashaM.id, value: 100000n }],
  split: equal([ashaM.id, raviM.id, rahulM.id]),
  ...overrides,
});
const input = (overrides: Partial<Fields> = {}): ExpenseInput => ({ groupId: g.id, ...fields(overrides) });

const sharesOf = async (expenseId: string) =>
  Object.fromEntries((await db.expenseShare.findMany({ where: { expenseId } })).map((s) => [s.memberId, s.amount]));
const activityOf = (entityId: string) => db.activity.findMany({ where: { entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("createExpense", () => {
  it("splits equally with the extra paisa to the earliest member, whatever order was sent", async () => {
    const { id } = await createExpense(asha.id, input({ split: equal([rahulM.id, raviM.id, ashaM.id]) }));
    expect(await sharesOf(id)).toEqual({ [ashaM.id]: 33334n, [raviM.id]: 33333n, [rahulM.id]: 33333n });
    // Stored in group order, as the edit form will read it back.
    expect((await db.expense.findUniqueOrThrow({ where: { id } })).splitInput).toEqual({
      method: "EQUAL",
      memberIds: [ashaM.id, raviM.id, rahulM.id],
      adjustments: [],
    });
  });

  it("stores the group's currency and base amounts", async () => {
    const { id } = await createExpense(asha.id, input());
    const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { payers: true, shares: true } });
    expect(e).toMatchObject({ currency: "INR", amount: 100000n, baseAmount: 100000n, splitMethod: "EQUAL", createdByMemberId: ashaM.id });
    expect(e.date.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(e.fxRate.toString()).toBe("1");
    for (const row of [...e.payers, ...e.shares]) expect(row.baseAmount).toBe(row.amount);
  });

  it("logs the expense with what each person is up or down", async () => {
    const { id } = await createExpense(asha.id, input());
    expect(await activityOf(id)).toMatchObject([
      {
        kind: "expense.created",
        actorMemberId: ashaM.id,
        groupId: g.id,
        payload: { description: "Dinner", amount: "100000", currency: "INR", net: { [ashaM.id]: "66666", [raviM.id]: "-33333", [rahulM.id]: "-33333" } },
      },
    ]);
  });

  it("refuses payers that don't add up", async () =>
    await expect(createExpense(asha.id, input({ payers: [{ memberId: ashaM.id, value: 90000n }] }))).rejects.toThrow(
      "₹100 of the total isn't paid by anyone",
    ));

  it("refuses someone from another group, or who left", async () => {
    const other = await createGroup(ravi.id);
    const outsider = await memberOf(other.id, ravi.id);
    await expect(createExpense(asha.id, input({ split: equal([ashaM.id, outsider.id]) }))).rejects.toThrow(NOT_MEMBERS);
    await expect(createExpense(asha.id, input({ payers: [{ memberId: outsider.id, value: 100000n }] }))).rejects.toThrow(NOT_MEMBERS);
    const adjustments = [{ memberId: outsider.id, value: 0n }];
    await expect(createExpense(asha.id, input({ split: { ...equal([ashaM.id]), adjustments } }))).rejects.toThrow(NOT_MEMBERS);

    await db.groupMember.update({ where: { id: rahulM.id }, data: { leftAt: new Date() } });
    await expect(createExpense(asha.id, input())).rejects.toThrow(NOT_MEMBERS);
    const items = [{ name: "Pizza", amount: 100000n, memberIds: [rahulM.id] }];
    await expect(createExpense(asha.id, input({ split: { method: "ITEMIZED", items, adjustments: [] } }))).rejects.toThrow(NOT_MEMBERS);
    expect(await db.expense.count()).toBe(0);
  });

  it("refuses writes in an archived group", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(createExpense(asha.id, input())).rejects.toThrow("This group is archived.");
  });

  it("moves the group to the top of the dashboard", async () => {
    const later = await createGroup(asha.id);
    await db.group.update({ where: { id: g.id }, data: { updatedAt: new Date("2026-01-01") } });
    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([later.id, g.id]);
    await createExpense(asha.id, input());
    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([g.id, later.id]);
  });
});

describe("editing", () => {
  it("lets only the creator or an admin edit and delete", async () => {
    const { id } = await createExpense(asha.id, input());
    await expect(updateExpense(ravi.id, id, 1, fields({ description: "Mine now" }))).rejects.toThrow(ONLY_EDITORS);
    await expect(deleteExpense(ravi.id, id)).rejects.toThrow(ONLY_EDITORS);
    await expect(restoreExpense(ravi.id, id)).rejects.toThrow(ONLY_EDITORS);
    expect(await db.expense.findUniqueOrThrow({ where: { id } })).toMatchObject({ description: "Dinner", version: 1, deletedAt: null });

    // A plain member can change what they added themselves.
    const own = await createExpense(ravi.id, input({ payers: [{ memberId: raviM.id, value: 100000n }] }));
    await deleteExpense(ravi.id, own.id);
    expect((await db.expense.findUniqueOrThrow({ where: { id: own.id } })).deletedAt).not.toBeNull();
  });

  it("refuses a stale edit with the editor's name", async () => {
    const { id } = await createExpense(asha.id, input());
    await db.groupMember.update({ where: { id: raviM.id }, data: { role: "ADMIN" } });
    expect(await updateExpense(ravi.id, id, 1, fields({ description: "Dinner at Thalassa" }))).toEqual({ version: 2 });

    const stale = updateExpense(asha.id, id, 1, fields({ description: "Lunch" }));
    await expect(stale).rejects.toThrow(ConflictError);
    await expect(stale).rejects.toThrow("Ravi edited this just now — reload?");

    session.user = asha;
    const form: Parameters<typeof updateExpenseAction>[0] = {
      expenseId: id,
      version: 1,
      description: "Lunch",
      amount: "100000",
      category: "food",
      date: "2026-10-20",
      notes: "",
      payers: [{ memberId: ashaM.id, value: "100000" }],
      split: { method: "EQUAL", memberIds: [ashaM.id, raviM.id, rahulM.id] },
    };
    expect(await updateExpenseAction(form)).toEqual({ ok: false, code: "conflict", error: "Ravi edited this just now — reload?" });
    expect(await db.expense.findUniqueOrThrow({ where: { id } })).toMatchObject({ description: "Dinner at Thalassa", version: 2 });
  });

  it("lets exactly one of two simultaneous edits through", async () => {
    const { id } = await createExpense(asha.id, input());
    await db.groupMember.update({ where: { id: raviM.id }, data: { role: "ADMIN" } });
    const results = await Promise.allSettled([
      updateExpense(asha.id, id, 1, fields({ description: "Lunch" })),
      updateExpense(ravi.id, id, 1, fields({ description: "Brunch" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(ConflictError);
    expect((await db.expense.findUniqueOrThrow({ where: { id } })).version).toBe(2);
    expect(await activityOf(id)).toHaveLength(2);
  });

  it("replaces payers and shares and logs what changed", async () => {
    const { id } = await createExpense(asha.id, input());
    const bigger = fields({ amount: 120000n, payers: [{ memberId: ashaM.id, value: 120000n }] });
    expect(await updateExpense(asha.id, id, 1, bigger)).toEqual({ version: 2 });

    const shares = Object.values(await sharesOf(id));
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(120000n);
    expect(await db.expensePayer.findMany({ where: { expenseId: id } })).toMatchObject([{ memberId: ashaM.id, amount: 120000n, baseAmount: 120000n }]);
    const updated = (await activityOf(id)).at(-1)!;
    expect(updated).toMatchObject({ kind: "expense.updated", actorMemberId: ashaM.id, payload: { amount: "120000" } });
    expect((updated.payload as { changes: unknown[] }).changes).toEqual([
      { field: "amount", before: "₹1,000", after: "₹1,200" },
      { field: "payers", before: null, after: null },
    ]);

    // The same save again changes nothing, so nothing is written.
    expect(await updateExpense(asha.id, id, 2, bigger)).toEqual({ version: 2 });
    expect(await activityOf(id)).toHaveLength(2);
  });

  it("logs each field it changed, as people read it", async () => {
    const { id } = await createExpense(asha.id, input({ notes: "old" }));
    await updateExpense(
      asha.id,
      id,
      1,
      fields({ description: "Cab", date: "2026-10-21", category: "transport", notes: null, split: equal([ashaM.id, raviM.id]) }),
    );
    const { payload } = (await activityOf(id)).at(-1)!;
    expect((payload as { changes: unknown[] }).changes).toEqual([
      { field: "description", before: "Dinner", after: "Cab" },
      { field: "date", before: formatDay("2026-10-20"), after: formatDay("2026-10-21") },
      { field: "category", before: "Food & drink", after: "Transport" },
      { field: "notes", before: null, after: null },
      { field: "split", before: null, after: null },
    ]);
  });

  it("keeps a member who has left when editing their old expense", async () => {
    const { id } = await createExpense(asha.id, input());
    await db.groupMember.update({ where: { id: rahulM.id }, data: { leftAt: new Date() } });
    expect(await updateExpense(asha.id, id, 1, fields({ description: "Dinner at Thalassa" }))).toEqual({ version: 2 });
    expect(await sharesOf(id)).toMatchObject({ [rahulM.id]: 33333n });
  });

  it("delete then restore brings it back and logs both", async () => {
    const { id } = await createExpense(asha.id, input());
    await deleteExpense(asha.id, id);
    await deleteExpense(asha.id, id);
    expect((await db.expense.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    await restoreExpense(asha.id, id);
    expect(await db.expense.findUniqueOrThrow({ where: { id } })).toMatchObject({ deletedAt: null, version: 3 });
    expect((await activityOf(id)).map((a) => a.kind)).toEqual(["expense.created", "expense.deleted", "expense.restored"]);
    expect((await activityOf(id)).at(-1)!.payload).toMatchObject({ amount: "100000", net: { [ashaM.id]: "66666" } });
  });

  it("refuses editing a deleted expense", async () => {
    const { id } = await createExpense(asha.id, input());
    await deleteExpense(asha.id, id);
    await expect(updateExpense(asha.id, id, 2, fields({ description: "Back?" }))).rejects.toThrow(DELETED);
  });
});
