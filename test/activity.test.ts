import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { recordActivity } from "@/server/activity";
import { listGroupsForUser } from "@/server/groups";
import { addPlaceholder, claimPlaceholder, joinByInviteCode, leaveGroup, removeMember } from "@/server/members";
import { revalidateGroup } from "@/server/revalidate";
import { resetDb } from "./db";
import { createGroup, createUser, memberOf } from "./factories";

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
