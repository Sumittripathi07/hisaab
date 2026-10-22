import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { requireMember, requireMemberFor } from "@/server/authz";
import { ForbiddenError } from "@/server/errors";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createCommentRow, createExpenseRow, createGroup, createSettlementRow, createUser, memberOf } from "./factories";

beforeEach(resetDb);

let owner: User;
let stranger: User;
let g: Group;

beforeEach(async () => {
  [owner, stranger] = [await createUser(), await createUser()];
  g = await createGroup(owner.id);
});

describe("requireMember", () => {
  it("returns member and group for an active member", async () => {
    const res = await requireMember(owner.id, g.id);
    expect(res.member).toMatchObject({ userId: owner.id, groupId: g.id, role: "OWNER", leftAt: null });
    expect(res.group.id).toBe(g.id);
    expect(res.member).not.toHaveProperty("group");
  });

  it("forbids a non-member", async () => {
    await expect(requireMember(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids a member who left", async () => {
    await addMember(g.id, { userId: stranger.id, leftAt: new Date() });
    await expect(requireMember(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids a group that does not exist", async () => {
    await expect(requireMember(owner.id, "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gives a missing group, a non-member and a left member the same error", async () => {
    await addMember(g.id, { userId: stranger.id, leftAt: new Date() });
    const outsider = await createUser();
    const errors = await Promise.all(
      [requireMember(owner.id, "nope"), requireMember(outsider.id, g.id), requireMember(stranger.id, g.id)].map((p) =>
        p.catch((e: unknown) => e),
      ),
    );
    for (const e of errors) expect(e).toBeInstanceOf(ForbiddenError);
    expect(new Set(errors.map((e) => (e as Error).message)).size).toBe(1);
  });

  it("never matches a placeholder, or an empty user id", async () => {
    await addMember(g.id, { displayName: "Placeholder" });
    await expect(requireMember("", g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses writes to an archived group", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(requireMember(owner.id, g.id, { write: true })).rejects.toThrow("This group is archived.");
  });

  it("allows reads of an archived group", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    const res = await requireMember(owner.id, g.id);
    expect(res.group.archivedAt).toBeInstanceOf(Date);
  });

  it("allows writes to an active group", async () => {
    await expect(requireMember(owner.id, g.id, { write: true })).resolves.toMatchObject({ group: { id: g.id } });
  });

  it("forbids a non-member of an archived group rather than saying it is archived", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(requireMember(stranger.id, g.id, { write: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires ADMIN or OWNER for role admin", async () => {
    const [member, admin] = [await createUser(), await createUser()];
    await addMember(g.id, { userId: member.id, role: "MEMBER" });
    await addMember(g.id, { userId: admin.id, role: "ADMIN" });
    await expect(requireMember(member.id, g.id, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMember(admin.id, g.id, { role: "admin" })).resolves.toMatchObject({ member: { role: "ADMIN" } });
    await expect(requireMember(owner.id, g.id, { role: "admin" })).resolves.toMatchObject({ member: { role: "OWNER" } });
  });

  it("requires OWNER for role owner", async () => {
    const [member, admin] = [await createUser(), await createUser()];
    await addMember(g.id, { userId: member.id, role: "MEMBER" });
    await addMember(g.id, { userId: admin.id, role: "ADMIN" });
    await expect(requireMember(member.id, g.id, { role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMember(admin.id, g.id, { role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMember(owner.id, g.id, { role: "owner" })).resolves.toMatchObject({ member: { role: "OWNER" } });
  });

  it("checks the role on an archived group even when only reading", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    const member = await createUser();
    await addMember(g.id, { userId: member.id });
    await expect(requireMember(member.id, g.id, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMember(owner.id, g.id, { role: "admin" })).resolves.toBeDefined();
  });
});

describe("requireMemberFor", () => {
  let ownerMember: GroupMember;
  let ids: Record<"expense" | "settlement" | "comment", string>;
  beforeEach(async () => {
    ownerMember = await memberOf(g.id, owner.id);
    const other = await addMember(g.id, { displayName: "Rahul" });
    const expense = await createExpenseRow(g.id, {
      createdByMemberId: ownerMember.id,
      payers: [[ownerMember.id, 1000n]],
      shares: [[ownerMember.id, 500n], [other.id, 500n]],
    });
    const settlement = await createSettlementRow(g.id, {
      fromMemberId: other.id,
      toMemberId: ownerMember.id,
      amount: 500n,
      createdByMemberId: other.id,
    });
    const comment = await createCommentRow({ groupId: g.id, authorMemberId: ownerMember.id, expenseId: expense.id });
    ids = { expense: expense.id, settlement: settlement.id, comment: comment.id };
  });

  it.each(["expense", "settlement", "comment"] as const)("finds a %s's group for a member", async (entity) => {
    const { member, group, row } = await requireMemberFor(owner.id, entity, ids[entity]);
    expect([member.id, group.id, row.id]).toEqual([ownerMember.id, g.id, ids[entity]]);
  });

  it.each(["expense", "settlement", "comment"] as const)("forbids an outsider from a %s", async (entity) =>
    await expect(requireMemberFor(stranger.id, entity, ids[entity])).rejects.toBeInstanceOf(ForbiddenError));

  it("forbids someone who left the group", async () => {
    await addMember(g.id, { userId: stranger.id, leftAt: new Date() });
    await expect(requireMemberFor(stranger.id, "expense", ids.expense)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids an id that doesn't exist, the same as an outsider", async () => {
    const errors = await Promise.all(
      [requireMemberFor(owner.id, "expense", "nope"), requireMemberFor(stranger.id, "expense", ids.expense)].map((p) => p.catch((e: unknown) => e)),
    );
    for (const e of errors) expect(e).toBeInstanceOf(ForbiddenError);
  });

  it("passes the role option on to requireMember", async () => {
    const member = await createUser();
    await addMember(g.id, { userId: member.id });
    await expect(requireMemberFor(member.id, "expense", ids.expense, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMemberFor(owner.id, "expense", ids.expense, { role: "admin" })).resolves.toBeDefined();
  });

  it("refuses writes in an archived group", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(requireMemberFor(owner.id, "expense", ids.expense, { write: true })).rejects.toThrow("This group is archived.");
    await expect(requireMemberFor(owner.id, "expense", ids.expense)).resolves.toBeDefined();
  });

  it("still finds a soft-deleted row", async () => {
    await db.expense.update({ where: { id: ids.expense }, data: { deletedAt: new Date() } });
    const { row } = await requireMemberFor(owner.id, "expense", ids.expense);
    expect(row.deletedAt).toBeInstanceOf(Date);
  });
});
