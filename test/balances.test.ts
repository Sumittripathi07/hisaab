import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { ExpenseInput } from "@/lib/validation";
import { getGroupBalances, groupNets, myBalancesByGroup, type GroupBalances } from "@/server/balances";
import { ForbiddenError } from "@/server/errors";
import { createExpense, deleteExpense, restoreExpense } from "@/server/expenses";
import { removeMember } from "@/server/members";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createExpenseRow, createGroup, createSettlementRow, createUser, memberOf } from "./factories";

let a: User;
let g: Group;
let A: GroupMember, B: GroupMember, C: GroupMember, D: GroupMember, E: GroupMember;

beforeEach(async () => {
  await resetDb();
  a = await createUser({ name: "A" });
  g = await createGroup(a.id);
  A = await memberOf(g.id, a.id);
  [B, C, D, E] = [
    await addMember(g.id, { displayName: "B" }),
    await addMember(g.id, { displayName: "C" }),
    await addMember(g.id, { displayName: "D" }),
    await addMember(g.id, { displayName: "E" }),
  ];
  // Joined in this order, a second apart, so the leftover paisa goes to A, then B, and so on.
  for (const [i, m] of [A, B, C, D, E].entries()) {
    await db.groupMember.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
  }
});

type Split = ExpenseInput["split"];
const ids = (...members: GroupMember[]) => members.map((m) => m.id);
const parts = (...list: [GroupMember, bigint][]) => list.map(([m, value]) => ({ memberId: m.id, value }));
const expense = (amount: bigint, payers: [GroupMember, bigint][], split: Split, groupId = g.id) =>
  createExpense(a.id, { groupId, description: "Trip", amount, category: "other", date: "2026-10-20", notes: null, payers: parts(...payers), split });
const equal = (members: GroupMember[], adjustments: [GroupMember, bigint][] = []): Split => ({
  method: "EQUAL",
  memberIds: ids(...members),
  adjustments: parts(...adjustments),
});
const t = (from: GroupMember, to: GroupMember, amount: bigint) => ({ from: from.id, to: to.id, amount });
const netsByName = (b: GroupBalances) => Object.fromEntries(b.members.map((m) => [m.displayName, m.net]));
const total = (b: GroupBalances) => b.members.reduce((sum, m) => sum + m.net, 0n);

describe("getGroupBalances", () => {
  it("a 5-person trip with mixed splits nets to zero and settles in n−1 payments", async () => {
    await expense(1000000n, [[A, 1000000n]], equal([A, B, C, D, E]));
    await expense(100000n, [[B, 100000n]], equal([A, B, C]));
    await expense(300000n, [[A, 200000n], [C, 100000n]], {
      method: "SHARES",
      shares: parts([A, 2n], [B, 1n], [C, 1n], [D, 1n], [E, 1n]),
      adjustments: [],
    });
    await expense(99999n, [[D, 99999n]], {
      method: "PERCENT",
      basisPoints: parts([A, 2000n], [B, 2000n], [C, 2000n], [D, 2000n], [E, 2000n]),
      adjustments: [],
    });
    await expense(55000n, [[E, 55000n]], {
      method: "ITEMIZED",
      items: [
        { name: "Snacks", amount: 30000n, memberIds: ids(A) },
        { name: "Drinks", amount: 20000n, memberIds: ids(A, B) },
      ],
      adjustments: [],
    });
    await expense(100000n, [[C, 100000n]], equal([A, B, C, D], [[D, 10000n]]));

    const b = await getGroupBalances(a.id, g.id);
    expect(netsByName(b)).toEqual({ A: 780166n, B: -236833n, C: -125833n, D: -202501n, E: -214999n });
    expect(b.members.map((m) => m.displayName)).toEqual(["A", "B", "C", "D", "E"]);
    expect(b).toMatchObject({ currency: "INR", simplified: true, myMemberId: A.id, myNet: 780166n, settled: false });
    expect(b.transfers).toEqual([t(B, A, 236833n), t(E, A, 214999n), t(D, A, 202501n), t(C, A, 125833n)]);

    for (const x of b.transfers) {
      await createSettlementRow(g.id, { fromMemberId: x.from, toMemberId: x.to, amount: x.amount, createdByMemberId: A.id });
    }
    const after = await getGroupBalances(a.id, g.id);
    expect(after.settled).toBe(true);
    expect(after.transfers).toEqual([]);
    expect(after.members.every((m) => m.net === 0n)).toBe(true);
  });

  it("shows pairwise debts when simplify is off", async () => {
    await expense(10000n, [[A, 10000n]], equal([A, B]));
    await expense(10000n, [[B, 10000n]], equal([B, C]));
    const simplified = await getGroupBalances(a.id, g.id);
    expect(simplified.simplified).toBe(true);
    expect(simplified.transfers).toEqual([t(C, A, 5000n)]);

    await db.group.update({ where: { id: g.id }, data: { simplifyDebts: false } });
    const pairwise = await getGroupBalances(a.id, g.id);
    expect(pairwise.simplified).toBe(false);
    expect(pairwise.transfers).toHaveLength(2);
    expect(pairwise.transfers).toEqual(expect.arrayContaining([t(B, A, 5000n), t(C, B, 5000n)]));
    // The nets are the same either way: only who pays whom changes.
    expect(netsByName(pairwise)).toEqual(netsByName(simplified));
  });

  it("in pairwise mode, lists everyone a transfer names, even someone who left at a net of zero", async () => {
    await expense(10000n, [[A, 10000n]], equal([A, B]));
    await expense(10000n, [[B, 10000n]], equal([B, C]));
    await db.group.update({ where: { id: g.id }, data: { simplifyDebts: false } });
    await removeMember(a.id, B.id); // B's net is 0, so the leave rule lets them go

    const b = await getGroupBalances(a.id, g.id);
    expect(b.transfers).toEqual(expect.arrayContaining([t(B, A, 5000n), t(C, B, 5000n)]));
    const listed = new Set(b.members.map((m) => m.memberId));
    expect(b.transfers.every((x) => listed.has(x.from) && listed.has(x.to))).toBe(true);
    expect(b.members.find((m) => m.memberId === B.id)).toMatchObject({ active: false, net: 0n });
    expect(b.settled).toBe(false);
  });

  it("a cycle of equal debts is unsettled pairwise, and settled once simplified", async () => {
    const owes = (debtor: GroupMember, creditor: GroupMember) =>
      createExpenseRow(g.id, { createdByMemberId: A.id, payers: [[creditor.id, 5000n]], shares: [[debtor.id, 5000n]] });
    await owes(A, B);
    await owes(B, C);
    await owes(C, A);

    await db.group.update({ where: { id: g.id }, data: { simplifyDebts: false } });
    const pairwise = await getGroupBalances(a.id, g.id);
    expect(pairwise.transfers).toHaveLength(3);
    expect(pairwise.transfers).toEqual(expect.arrayContaining([t(A, B, 5000n), t(B, C, 5000n), t(C, A, 5000n)]));
    expect(pairwise.settled).toBe(false);

    await db.group.update({ where: { id: g.id }, data: { simplifyDebts: true } });
    const simplified = await getGroupBalances(a.id, g.id);
    expect(simplified.transfers).toEqual([]);
    expect(simplified.settled).toBe(true);
  });

  it("ignores deleted expenses and disputed or deleted payments", async () => {
    await createExpenseRow(g.id, { createdByMemberId: A.id, payers: [[A.id, 10000n]], shares: [[A.id, 5000n], [B.id, 5000n]] });
    await createExpenseRow(g.id, { createdByMemberId: A.id, payers: [[C.id, 99999n]], shares: [[D.id, 99999n]], deletedAt: new Date() });
    await createSettlementRow(g.id, { fromMemberId: B.id, toMemberId: A.id, amount: 5000n, createdByMemberId: B.id, status: "DISPUTED" });
    await createSettlementRow(g.id, { fromMemberId: B.id, toMemberId: A.id, amount: 5000n, createdByMemberId: B.id, deletedAt: new Date() });

    expect(await groupNets(g.id)).toEqual(new Map([[A.id, 5000n], [B.id, -5000n]]));
    const b = await getGroupBalances(a.id, g.id);
    expect(netsByName(b)).toEqual({ A: 5000n, B: -5000n, C: 0n, D: 0n, E: 0n });
    expect(b.transfers).toEqual([t(B, A, 5000n)]);
    await db.group.update({ where: { id: g.id }, data: { simplifyDebts: false } });
    expect((await getGroupBalances(a.id, g.id)).transfers).toEqual([t(B, A, 5000n)]);
  });

  it("a member who left still shows while they have a balance", async () => {
    const rahul = await addMember(g.id, { displayName: "Rahul" });
    const { id } = await expense(66666n, [[A, 66666n]], equal([A, rahul]));
    await deleteExpense(a.id, id);
    await removeMember(a.id, rahul.id); // his net is 0 while the expense is deleted
    await removeMember(a.id, E.id); // left at zero: not listed
    await restoreExpense(a.id, id);

    const b = await getGroupBalances(a.id, g.id);
    expect(b.members.map((m) => m.displayName)).toEqual(["A", "B", "C", "D", "Rahul"]);
    expect(b.members.at(-1)).toEqual({ memberId: rahul.id, displayName: "Rahul", image: null, isPlaceholder: true, active: false, net: -33333n });
    expect(b.transfers).toEqual([t(rahul, A, 33333n)]);
    expect(total(b)).toBe(0n);
  });

  it("is for members of the group only", async () => {
    const stranger = await createUser();
    await expect(getGroupBalances(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("myBalancesByGroup", () => {
  it("sums my balance per group", async () => {
    await expense(10000n, [[A, 10000n]], equal([A, B]));
    const other = await createGroup(a.id);
    const me = await memberOf(other.id, a.id);
    const ravi = await addMember(other.id, { displayName: "Ravi" });
    await createExpenseRow(other.id, { createdByMemberId: me.id, payers: [[ravi.id, 9000n]], shares: [[me.id, 3000n], [ravi.id, 6000n]] });
    await createSettlementRow(other.id, { fromMemberId: me.id, toMemberId: ravi.id, amount: 1000n, createdByMemberId: me.id });
    // A group I left, with a balance, and one with no money in it: neither is listed.
    const owner = await createUser();
    const left = await createGroup(owner.id);
    const gone = await addMember(left.id, { userId: a.id, leftAt: new Date() });
    const ownerM = await memberOf(left.id, owner.id);
    await createExpenseRow(left.id, { createdByMemberId: gone.id, payers: [[gone.id, 500n]], shares: [[ownerM.id, 500n]] });
    await createGroup(a.id);

    expect(await myBalancesByGroup(a.id)).toEqual(new Map([[g.id, 5000n], [other.id, -2000n]]));
  });
});
