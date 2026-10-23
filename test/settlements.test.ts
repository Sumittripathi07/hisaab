import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayIn } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Transfer } from "@/lib/money/simplify";
import type { SettlementInput } from "@/lib/validation";
import { recordSettlementAction } from "@/server/actions/settlements";
import { getGroupBalances } from "@/server/balances";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createExpense } from "@/server/expenses";
import type { SessionUser } from "@/server/session";
import {
  deleteSettlement,
  disputeSettlement,
  getSettlement,
  getSettleUp,
  listSettlements,
  recordSettlement,
  restoreSettlement,
  updateSettlement,
} from "@/server/settlements";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup, createUser, memberOf } from "./factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWN_ONLY = "You can only record payments you made or received.";
const NOT_IN_GROUP = "Choose people in this group.";
const ONLY_EDITORS = "Only the person who recorded this payment or an admin can change it.";
const ONLY_PAYEE = "Only the person who was paid can dispute this.";
const ALREADY_DISPUTED = "This payment is already disputed.";
const DELETED = "This payment was deleted.";
const ARCHIVED = "This group is archived.";

let asha: User, ravi: User;
let g: Group;
let ashaM: GroupMember, raviM: GroupMember, rahulM: GroupMember, devM: GroupMember;

/** Asha (owner, with a UPI ID), Ravi, and placeholders Rahul and Dev. Asha paid ₹1,000 for Asha, Ravi and Rahul. */
beforeEach(async () => {
  await resetDb();
  asha = await createUser({ name: "Asha", upiId: "asha@okicici" });
  ravi = await createUser({ name: "Ravi" });
  g = await createGroup(asha.id, { name: "Goa Trip" });
  ashaM = await memberOf(g.id, asha.id);
  raviM = await addMember(g.id, { userId: ravi.id });
  rahulM = await addMember(g.id, { displayName: "Rahul" });
  devM = await addMember(g.id, { displayName: "Dev" });
  for (const [i, m] of [ashaM, raviM, rahulM, devM].entries()) {
    await db.groupMember.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
  }
  await createExpense(asha.id, {
    groupId: g.id,
    description: "Dinner",
    amount: 100000n,
    category: "food",
    date: "2026-10-20",
    notes: null,
    payers: [{ memberId: ashaM.id, value: 100000n }],
    split: { method: "EQUAL", memberIds: [ashaM.id, raviM.id, rahulM.id], adjustments: [] },
  });
});

const pay = (from: GroupMember, to: GroupMember, amount: bigint, overrides: Partial<SettlementInput> = {}): SettlementInput => ({
  groupId: g.id,
  fromMemberId: from.id,
  toMemberId: to.id,
  amount,
  method: "UPI",
  date: "2026-10-21",
  note: null,
  ...overrides,
});
const edit = { amount: 20000n, method: "CASH" as const, date: "2026-10-22", note: "Cash at the airport" };
const t = (from: GroupMember, to: GroupMember, amount: bigint): Transfer => ({ from: from.id, to: to.id, amount });
const plain = (list: Transfer[]) => list.map(({ from, to, amount }) => ({ from, to, amount }));
const netOf = async (m: GroupMember) => (await getGroupBalances(asha.id, g.id)).members.find((x) => x.memberId === m.id)?.net;
const rowOf = (id: string) => db.settlement.findUniqueOrThrow({ where: { id } });
const kindsOf = async (entityId: string) =>
  (await db.activity.findMany({ where: { entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((a) => a.kind);

describe("recording", () => {
  it("counts a recorded payment immediately", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 33333n));
    expect(await netOf(raviM)).toBe(0n);
    const row = await rowOf(id);
    expect(row).toMatchObject({ currency: "INR", amount: 33333n, baseAmount: 33333n, status: "RECORDED", createdByMemberId: raviM.id });
    expect(row.fxRate.toString()).toBe("1");
    expect(row.date.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(await db.activity.findMany({ where: { entityId: id } })).toMatchObject([
      {
        kind: "settlement.created",
        actorMemberId: raviM.id,
        payload: { fromMemberId: raviM.id, toMemberId: ashaM.id, amount: "33333", currency: "INR", method: "UPI" },
      },
    ]);
  });

  it("leaves the rest suggested after a partial payment", async () => {
    await recordSettlement(ravi.id, pay(raviM, ashaM, 10000n));
    expect((await getGroupBalances(ravi.id, g.id)).transfers).toEqual([t(rahulM, ashaM, 33333n), t(raviM, ashaM, 23333n)]);
    // Settle up lists the viewer's own transfers first, and the rest in the group's order.
    expect(plain((await getSettleUp(ravi.id, g.id)).transfers)).toEqual([t(raviM, ashaM, 23333n), t(rahulM, ashaM, 33333n)]);
    expect(plain((await getSettleUp(asha.id, g.id)).transfers)).toEqual([t(rahulM, ashaM, 33333n), t(raviM, ashaM, 23333n)]);
  });

  it("lets the payer, the payee, or anyone for two placeholders record", async () => {
    const created = { id: expect.any(String) };
    await expect(recordSettlement(ravi.id, pay(raviM, ashaM, 100n))).resolves.toEqual(created);
    await expect(recordSettlement(asha.id, pay(raviM, ashaM, 100n))).resolves.toEqual(created);
    await expect(recordSettlement(asha.id, pay(rahulM, devM, 100n))).resolves.toEqual(created);
    await expect(recordSettlement(ravi.id, pay(rahulM, ashaM, 100n))).rejects.toThrow(OWN_ONLY);
    await expect(recordSettlement(ravi.id, pay(ashaM, rahulM, 100n))).rejects.toThrow(OWN_ONLY);
  });

  it("refuses people from another group, but settles with someone who left", async () => {
    const other = await createGroup(ravi.id);
    const outsider = await memberOf(other.id, ravi.id);
    await expect(recordSettlement(ravi.id, pay(raviM, outsider, 100n))).rejects.toThrow(NOT_IN_GROUP);
    await expect(recordSettlement(ravi.id, pay(outsider, raviM, 100n))).rejects.toThrow(NOT_IN_GROUP);
    expect(await db.settlement.count()).toBe(0);
    expect(await db.activity.count({ where: { kind: { startsWith: "settlement." } } })).toBe(0);

    await db.groupMember.update({ where: { id: rahulM.id }, data: { leftAt: new Date() } });
    await recordSettlement(asha.id, pay(rahulM, ashaM, 33333n));
    expect((await getGroupBalances(asha.id, g.id)).transfers).toEqual([t(raviM, ashaM, 33333n)]);
  });
});

describe("disputes", () => {
  it("only the payee disputes, and a disputed payment stops counting", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 33333n));
    await expect(disputeSettlement(ravi.id, id)).rejects.toThrow(ONLY_PAYEE);
    await disputeSettlement(asha.id, id);
    expect(await rowOf(id)).toMatchObject({ status: "DISPUTED", disputedAt: expect.any(Date) });
    expect(await netOf(raviM)).toBe(-33333n);
    expect(await kindsOf(id)).toEqual(["settlement.created", "settlement.disputed"]);
    await expect(disputeSettlement(asha.id, id)).rejects.toThrow(ALREADY_DISPUTED);
    expect(await kindsOf(id)).toHaveLength(2);
  });

  it("an admin disputes for a placeholder payee, never for a payee who can speak for themselves", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, rahulM, 100n));
    await expect(disputeSettlement(ravi.id, id)).rejects.toThrow(ONLY_PAYEE);
    await disputeSettlement(asha.id, id);
    expect((await rowOf(id)).status).toBe("DISPUTED");

    const toRavi = await recordSettlement(ravi.id, pay(rahulM, raviM, 100n));
    await expect(disputeSettlement(asha.id, toRavi.id)).rejects.toThrow(ONLY_PAYEE);
  });

  it("won't dispute a deleted payment", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 100n));
    await deleteSettlement(ravi.id, id);
    await expect(disputeSettlement(asha.id, id)).rejects.toThrow(DELETED);
  });
});

describe("changing a payment", () => {
  it("lets the creator or an admin edit, delete and restore", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 33333n));
    await updateSettlement(ravi.id, id, edit);
    expect(await rowOf(id)).toMatchObject({ amount: 20000n, baseAmount: 20000n, method: "CASH", note: "Cash at the airport", status: "RECORDED" });
    expect((await rowOf(id)).date.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(await netOf(raviM)).toBe(-13333n);
    await updateSettlement(ravi.id, id, edit); // nothing changed: nothing logged

    await deleteSettlement(asha.id, id);
    await deleteSettlement(asha.id, id); // a double tap is a no-op
    expect(await netOf(raviM)).toBe(-33333n);
    await expect(updateSettlement(ravi.id, id, edit)).rejects.toThrow(DELETED);
    await restoreSettlement(asha.id, id);
    await restoreSettlement(asha.id, id);
    expect(await netOf(raviM)).toBe(-13333n);
    expect(await kindsOf(id)).toEqual(["settlement.created", "settlement.updated", "settlement.deleted", "settlement.restored"]);
    expect((await db.activity.findFirstOrThrow({ where: { entityId: id, kind: "settlement.deleted" } })).payload).toEqual({
      fromMemberId: raviM.id,
      toMemberId: ashaM.id,
      amount: "20000",
      currency: "INR",
      method: "CASH",
    });

    const theirs = await recordSettlement(asha.id, pay(rahulM, devM, 100n));
    await expect(updateSettlement(ravi.id, theirs.id, edit)).rejects.toThrow(ONLY_EDITORS);
    await expect(deleteSettlement(ravi.id, theirs.id)).rejects.toThrow(ONLY_EDITORS);
    await expect(restoreSettlement(ravi.id, theirs.id)).rejects.toThrow(ONLY_EDITORS);
  });

  it("keeps a disputed payment disputed when it's edited", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 33333n));
    await disputeSettlement(asha.id, id);
    await updateSettlement(ravi.id, id, edit);
    expect(await rowOf(id)).toMatchObject({ amount: 20000n, status: "DISPUTED" });
    expect(await netOf(raviM)).toBe(-33333n);
  });
});

describe("reading payments", () => {
  it("shows a payment with what the viewer may do, and lists the live ones newest first", async () => {
    const first = await recordSettlement(ravi.id, pay(raviM, ashaM, 100n, { date: "2026-10-20" }));
    const second = await recordSettlement(asha.id, pay(rahulM, ashaM, 200n, { date: "2026-10-22", note: "Cash" }));
    const gone = await recordSettlement(ravi.id, pay(raviM, ashaM, 300n));
    await deleteSettlement(ravi.id, gone.id);

    expect(await getSettlement(asha.id, first.id)).toEqual({
      id: first.id,
      groupId: g.id,
      from: { memberId: raviM.id, displayName: "Ravi" },
      to: { memberId: ashaM.id, displayName: "Asha" },
      amount: 100n,
      currency: "INR",
      method: "UPI",
      status: "RECORDED",
      note: null,
      date: "2026-10-20",
      recordedBy: "Ravi",
      disputedAt: null,
      canEdit: true,
      canDispute: true,
    });
    expect(await getSettlement(ravi.id, first.id)).toMatchObject({ canEdit: true, canDispute: false });
    expect(await getSettlement(ravi.id, second.id)).toMatchObject({ note: "Cash", canEdit: false, canDispute: false });
    await disputeSettlement(asha.id, first.id);
    expect(await getSettlement(asha.id, first.id)).toMatchObject({ status: "DISPUTED", disputedAt: expect.any(Date), canDispute: false });

    expect((await listSettlements(ravi.id, g.id)).map((s) => s.id)).toEqual([second.id, first.id]);
    expect((await listSettlements(ravi.id, g.id, 1)).map((s) => s.id)).toEqual([second.id]);
    await expect(getSettlement(ravi.id, gone.id)).rejects.toEqual(new NotFoundError(DELETED));
    const outsider = await createUser();
    await expect(getSettlement(outsider.id, first.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getSettleUp", () => {
  it("offers UPI only to a payee with a UPI ID in an INR group", async () => {
    const settleUp = await getSettleUp(ravi.id, g.id);
    expect(settleUp).toMatchObject({ groupName: "Goa Trip", currency: "INR", today: todayIn(ravi.timezone), myMemberId: raviM.id });
    const [mine, others] = settleUp.transfers;
    expect(mine).toMatchObject({
      from: raviM.id,
      to: ashaM.id,
      amount: 33333n,
      fromName: "Ravi",
      toName: "Asha",
      involvesMe: true,
      canRecord: true,
      upi: { upiId: "asha@okicici", link: "upi://pay?pa=asha@okicici&pn=Asha&am=333.33&cu=INR&tn=Hisaab%3A%20Goa%20Trip" },
    });
    expect(others).toMatchObject({ from: rahulM.id, to: ashaM.id, fromName: "Rahul", involvesMe: false, canRecord: false });

    await db.user.update({ where: { id: asha.id }, data: { upiId: null } });
    expect((await getSettleUp(ravi.id, g.id)).transfers.map((x) => x.upi)).toEqual([null, null]);

    await db.user.update({ where: { id: asha.id }, data: { upiId: "asha@okicici" } });
    const usd = await createGroup(asha.id, { baseCurrency: "USD" });
    const ashaInUsd = await memberOf(usd.id, asha.id);
    const raviInUsd = await addMember(usd.id, { userId: ravi.id });
    await createExpense(asha.id, {
      groupId: usd.id,
      description: "Taxi",
      amount: 2000n,
      category: "other",
      date: "2026-10-20",
      notes: null,
      payers: [{ memberId: ashaInUsd.id, value: 2000n }],
      split: { method: "EQUAL", memberIds: [ashaInUsd.id, raviInUsd.id], adjustments: [] },
    });
    const [inUsd] = (await getSettleUp(ravi.id, usd.id)).transfers;
    expect(inUsd).toMatchObject({ from: raviInUsd.id, amount: 1000n, upi: null });
  });

  it("hands a UPI ID only to the person paying it", async () => {
    await db.user.update({ where: { id: ravi.id }, data: { upiId: "ravi@okhdfc" } });
    // Rahul pays Asha, which isn't Ravi's payment, so Asha's UPI ID stays out of his view.
    const [mine, others] = (await getSettleUp(ravi.id, g.id)).transfers;
    expect(mine.upi).toMatchObject({ upiId: "asha@okicici" });
    expect(others).toMatchObject({ from: rahulM.id, to: ashaM.id, involvesMe: false, upi: null });

    // Ravi overpays, so now he is the payee of both transfers: nobody gets his UPI ID, himself included.
    await recordSettlement(ravi.id, pay(raviM, ashaM, 100000n));
    const { transfers } = await getSettleUp(ravi.id, g.id);
    expect(transfers.map((x) => x.to)).toEqual([raviM.id, raviM.id]);
    expect(transfers.map((x) => x.upi)).toEqual([null, null]);
  });

  it("lets anyone record between two placeholders, with no UPI to a placeholder", async () => {
    await recordSettlement(asha.id, pay(devM, ashaM, 66666n)); // Dev paid Asha's way, so Dev is now owed
    const [, between] = (await getSettleUp(ravi.id, g.id)).transfers;
    expect(between).toMatchObject({ from: rahulM.id, to: devM.id, toName: "Dev", involvesMe: false, canRecord: true, upi: null });
  });
});

describe("in an archived group", () => {
  it("refuses payments and disputes", async () => {
    const { id } = await recordSettlement(ravi.id, pay(raviM, ashaM, 100n));
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(recordSettlement(ravi.id, pay(raviM, ashaM, 100n))).rejects.toThrow(ARCHIVED);
    await expect(disputeSettlement(asha.id, id)).rejects.toThrow(ARCHIVED);
    await expect(updateSettlement(ravi.id, id, edit)).rejects.toThrow(ARCHIVED);
    await expect(deleteSettlement(ravi.id, id)).rejects.toThrow(ARCHIVED);
    expect(await getSettlement(asha.id, id)).toMatchObject({ canEdit: false, canDispute: false });
    expect((await getSettleUp(ravi.id, g.id)).transfers.map((x) => x.canRecord)).toEqual([false, false]);
  });
});

describe("recordSettlementAction", () => {
  beforeEach(() => void (session.user = ravi));

  it("refuses paying yourself, and stores a blank note as none", async () => {
    const yourself = {
      groupId: g.id,
      fromMemberId: raviM.id,
      toMemberId: raviM.id,
      amount: "100",
      method: "UPI" as const,
      date: "2026-10-21",
      note: "  ",
    };
    expect(await recordSettlementAction(yourself)).toEqual({ ok: false, error: "Choose two different people." });
    expect(await recordSettlementAction({ ...yourself, toMemberId: ashaM.id })).toEqual({ ok: true, data: { id: expect.any(String) } });
    expect(await db.settlement.findFirstOrThrow()).toMatchObject({ amount: 100n, note: null });
  });
});
