import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { describeActivity } from "@/lib/activity";
import { listEntityHistory, listGroupActivity, listMyActivity, recordActivity } from "@/server/activity";
import { addComment } from "@/server/comments";
import { ForbiddenError } from "@/server/errors";
import { createExpense, deleteExpense, restoreExpense } from "@/server/expenses";
import { listGroupsForUser } from "@/server/groups";
import { addPlaceholder, claimPlaceholder, joinByInviteCode, leaveGroup, removeMember } from "@/server/members";
import { revalidateGroup } from "@/server/revalidate";
import { deleteSettlement, recordSettlement } from "@/server/settlements";
import type { GroupMember } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup, createUser, memberOf } from "./factories";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(resetDb);

const activityOf = (groupId: string) => db.activity.findMany({ where: { groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("recordActivity", () => {
  it("records an activity and moves its group to the top of the dashboard", async () => {
    const asha = await createUser({ name: "Asha" });
    const g1 = await createGroup(asha.id);
    const g2 = await createGroup(asha.id);
    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([g2.id, g1.id]);

    const member = await memberOf(g1.id, asha.id);
    await db.$transaction((tx) =>
      recordActivity(tx, {
        groupId: g1.id,
        actorMemberId: member.id,
        kind: "member.added",
        entityId: member.id,
        payload: { memberId: member.id, displayName: "Rahul" },
      }),
    );

    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([g1.id, g2.id]);
    expect(await activityOf(g1.id)).toMatchObject([
      { groupId: g1.id, actorMemberId: member.id, kind: "member.added", entityId: member.id, payload: { memberId: member.id, displayName: "Rahul" } },
    ]);
  });

  it("is rolled back with the transaction it belongs to", async () => {
    const asha = await createUser();
    const g = await createGroup(asha.id);
    const member = await memberOf(g.id, asha.id);
    await expect(
      db.$transaction(async (tx) => {
        await recordActivity(tx, { groupId: g.id, actorMemberId: member.id, kind: "member.left", entityId: member.id, payload: { memberId: member.id, displayName: "x" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await activityOf(g.id)).toEqual([]);
  });
});

describe("revalidateGroup", () => {
  it("refreshes the lists and, through the route pattern, every group page", () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateGroup();
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/dashboard"], ["/groups"], ["/activity"], ["/(app)/groups/[groupId]", "layout"]]);
  });
});

describe("member activity", () => {
  it("logs joining, adding, leaving and removing members", async () => {
    const asha = await createUser({ name: "Asha" });
    const ravi = await createUser({ name: "Ravi" });
    const g = await createGroup(asha.id);
    const ashaMember = await memberOf(g.id, asha.id);

    await joinByInviteCode(ravi.id, g.inviteCode);
    const raviMember = await memberOf(g.id, ravi.id);
    await joinByInviteCode(ravi.id, g.inviteCode); // already in: nothing new to log
    const { member: rahul } = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await leaveGroup(ravi.id, g.id);
    await removeMember(asha.id, rahul.id);

    expect(await activityOf(g.id)).toMatchObject([
      { kind: "member.joined", actorMemberId: raviMember.id, entityId: raviMember.id, payload: { memberId: raviMember.id, displayName: "Ravi" } },
      { kind: "member.added", actorMemberId: ashaMember.id, entityId: rahul.id, payload: { memberId: rahul.id, displayName: "Rahul" } },
      { kind: "member.left", actorMemberId: raviMember.id, entityId: raviMember.id, payload: { memberId: raviMember.id, displayName: "Ravi" } },
      { kind: "member.removed", actorMemberId: ashaMember.id, entityId: rahul.id, payload: { memberId: rahul.id, displayName: "Rahul" } },
    ]);
  });

  it("logs rejoining after leaving, and a placeholder taken over by email", async () => {
    const asha = await createUser({ name: "Asha" });
    const ravi = await createUser({ name: "Ravi" });
    const rahul = await createUser({ name: "Rahul Kumar", email: "rahul@example.test" });
    const g = await createGroup(asha.id);
    await joinByInviteCode(ravi.id, g.inviteCode);
    await leaveGroup(ravi.id, g.id);
    await joinByInviteCode(ravi.id, g.inviteCode);
    const { member: placeholder } = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    await joinByInviteCode(rahul.id, g.inviteCode);

    const kinds = (await activityOf(g.id)).map((a) => [a.kind, a.entityId]);
    expect(kinds).toEqual([
      ["member.joined", (await memberOf(g.id, ravi.id)).id],
      ["member.left", (await memberOf(g.id, ravi.id)).id],
      ["member.joined", (await memberOf(g.id, ravi.id)).id],
      ["member.added", placeholder.id],
      ["member.joined", placeholder.id],
    ]);
    expect((await activityOf(g.id)).at(-1)).toMatchObject({ actorMemberId: placeholder.id, payload: { displayName: "Rahul Kumar" } });
  });

  it("logs a claimed placeholder as joined, by the person who claimed it", async () => {
    const asha = await createUser();
    const rahul = await createUser({ name: "Rahul Kumar" });
    const g = await createGroup(asha.id);
    const { member: placeholder } = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await claimPlaceholder(rahul.id, placeholder.claimToken!);

    expect((await activityOf(g.id)).at(-1)).toMatchObject({
      kind: "member.joined",
      actorMemberId: placeholder.id,
      entityId: placeholder.id,
      payload: { memberId: placeholder.id, displayName: "Rahul Kumar" },
    });
  });

  it("logs a join once when the same person taps twice", async () => {
    const asha = await createUser();
    const ravi = await createUser({ name: "Ravi" });
    const g = await createGroup(asha.id);
    await Promise.all([joinByInviteCode(ravi.id, g.inviteCode), joinByInviteCode(ravi.id, g.inviteCode)]);
    await leaveGroup(ravi.id, g.id);
    await Promise.all([joinByInviteCode(ravi.id, g.inviteCode), joinByInviteCode(ravi.id, g.inviteCode)]);

    expect((await activityOf(g.id)).map((a) => a.kind)).toEqual(["member.joined", "member.left", "member.joined"]);
  });
});

describe("activity feeds", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
  const feedRow = (groupId: string, actor: GroupMember, createdAt: Date, id?: string) =>
    db.activity.create({
      data: { id, groupId, actorMemberId: actor.id, kind: "member.joined", entityId: actor.id, payload: { memberId: actor.id, displayName: actor.displayName }, createdAt },
    });
  // Separate transactions can land in the same millisecond; a pause keeps "newest" unambiguous.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("lists a group newest first, ties by id, and says when there is more", async () => {
    const asha = await createUser({ name: "Asha" });
    const g = await createGroup(asha.id, { name: "Goa Trip" });
    const ashaM = await memberOf(g.id, asha.id);
    const gone = await addMember(g.id, { displayName: "Rahul", leftAt: new Date() });
    await feedRow(g.id, ashaM, at(1), "a");
    await feedRow(g.id, ashaM, at(2), "b");
    await feedRow(g.id, gone, at(2), "c");
    await feedRow(g.id, ashaM, at(3), "d");

    const page = await listGroupActivity(asha.id, g.id, 3);
    expect(page.items.map((i) => i.id)).toEqual(["d", "c", "b"]);
    expect(page.hasMore).toBe(true);
    expect(page.items[1]).toMatchObject({
      groupId: g.id,
      groupName: "Goa Trip",
      entityId: gone.id,
      kind: "member.joined",
      actorMemberId: gone.id,
      viewerMemberId: ashaM.id,
      currency: "INR",
      createdAt: at(2),
      // everyone the payloads can name, including people who left
      names: { [ashaM.id]: "Asha", [gone.id]: "Rahul" },
    });
    expect(describeActivity(page.items[1]).title).toBe("Rahul joined the group");
    expect(await listGroupActivity(asha.id, g.id, 4)).toMatchObject({ hasMore: false, items: [{ id: "d" }, { id: "c" }, { id: "b" }, { id: "a" }] });
  });

  it("refuses an outsider, and someone who left", async () => {
    const asha = await createUser();
    const ravi = await createUser();
    const g = await createGroup(asha.id);
    await expect(listGroupActivity(ravi.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    await addMember(g.id, { userId: ravi.id, leftAt: new Date() });
    await expect(listGroupActivity(ravi.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists my activity across groups, leaving out a group I left", async () => {
    const asha = await createUser({ name: "Asha" });
    const ravi = await createUser({ name: "Ravi" });
    const g1 = await createGroup(asha.id, { name: "Goa Trip" });
    const g2 = await createGroup(ravi.id, { name: "Flat" });
    const g3 = await createGroup(ravi.id, { name: "Old Office" });
    const a1 = await memberOf(g1.id, asha.id);
    const raviM = await memberOf(g2.id, ravi.id);
    const a2 = await addMember(g2.id, { userId: asha.id });
    const a3 = await addMember(g3.id, { userId: asha.id, leftAt: new Date() });
    await feedRow(g1.id, a1, at(1), "one");
    await feedRow(g2.id, raviM, at(2), "two");
    await feedRow(g3.id, a3, at(3), "three");

    const mine = await listMyActivity(asha.id);
    expect(mine.items.map((i) => [i.id, i.groupName, i.viewerMemberId])).toEqual([
      ["two", "Flat", a2.id],
      ["one", "Goa Trip", a1.id],
    ]);
    expect(mine.items[0].names).toEqual({ [raviM.id]: "Ravi", [a2.id]: "Asha" });
    expect(mine.hasMore).toBe(false);
    expect(await listMyActivity(asha.id, 1)).toMatchObject({ hasMore: true, items: [{ id: "two" }] });
    expect(await listMyActivity((await createUser()).id)).toEqual({ items: [], hasMore: false });
  });

  it("lists one expense's or payment's own history, newest first", async () => {
    const asha = await createUser({ name: "Asha" });
    const ravi = await createUser({ name: "Ravi" });
    const g = await createGroup(asha.id);
    const ashaM = await memberOf(g.id, asha.id);
    const raviM = await addMember(g.id, { userId: ravi.id });
    const dinner = (description: string) =>
      createExpense(asha.id, {
        groupId: g.id,
        description,
        amount: 100000n,
        category: "food",
        date: "2026-10-20",
        notes: null,
        payers: [{ memberId: ashaM.id, value: 100000n }],
        split: { method: "EQUAL", memberIds: [ashaM.id, raviM.id], adjustments: [] },
      });
    const { id: lunch } = await dinner("Lunch");
    await tick();
    const { id: taxi } = await dinner("Taxi");
    await tick();
    await deleteExpense(asha.id, lunch);
    await tick();
    await restoreExpense(asha.id, lunch);
    await tick();
    await addComment(ravi.id, { kind: "expense", id: lunch }, "Thanks");
    await tick();
    const { id: payment } = await recordSettlement(ravi.id, { groupId: g.id, fromMemberId: raviM.id, toMemberId: ashaM.id, amount: 50000n, method: "UPI", date: "2026-10-21", note: null });
    await tick();
    await deleteSettlement(ravi.id, payment);

    const history = await listEntityHistory(ravi.id, "expense", lunch);
    expect(history.map((i) => [i.kind, i.entityId])).toEqual([
      ["expense.restored", lunch],
      ["expense.deleted", lunch],
      ["expense.created", lunch],
    ]);
    expect(describeActivity(history[0])).toMatchObject({ title: "Asha restored “Lunch”", money: { text: "you owe ₹500", tone: "owe" } });
    expect((await listEntityHistory(ravi.id, "expense", taxi)).map((i) => i.kind)).toEqual(["expense.created"]);
    expect((await listEntityHistory(ravi.id, "settlement", payment)).map((i) => describeActivity(i).title)).toEqual([
      "You deleted a payment from you to Asha",
      "You paid Asha ₹500",
    ]);
  });

  it("refuses history of something in a group the caller is not in", async () => {
    const asha = await createUser();
    const g = await createGroup(asha.id);
    const ashaM = await memberOf(g.id, asha.id);
    const { id } = await createExpense(asha.id, {
      groupId: g.id,
      description: "Lunch",
      amount: 100n,
      category: "food",
      date: "2026-10-20",
      notes: null,
      payers: [{ memberId: ashaM.id, value: 100n }],
      split: { method: "EQUAL", memberIds: [ashaM.id], adjustments: [] },
    });
    const mallory = await createUser();
    await expect(listEntityHistory(mallory.id, "expense", id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEntityHistory(mallory.id, "settlement", "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
