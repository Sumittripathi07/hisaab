import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { describeActivity } from "@/lib/activity";
import { listGroupActivity } from "@/server/activity";
import { addCommentAction, deleteCommentAction } from "@/server/actions/comments";
import { addComment, deleteComment, listComments } from "@/server/comments";
import { ForbiddenError, UserError } from "@/server/errors";
import type { SessionUser } from "@/server/session";
import type { Expense, Group, GroupMember, Settlement, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createCommentRow, createExpenseRow, createGroup, createSettlementRow, createUser, memberOf } from "./factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ONLY_AUTHOR = "Only the author or an admin can delete this comment.";

let asha: User, ravi: User, dev: User, meera: User, mallory: User;
let g: Group;
let ashaM: GroupMember, raviM: GroupMember, rahulM: GroupMember;
let expense: Expense, payment: Settlement;

/** Asha (owner), Dev (admin), Ravi, Meera, placeholder Rahul. Asha paid for dinner; Rahul paid Asha. */
beforeEach(async () => {
  await resetDb();
  [asha, ravi, dev, meera, mallory] = [
    await createUser({ name: "Asha" }),
    await createUser({ name: "Ravi", image: "https://example.test/ravi.png" }),
    await createUser({ name: "Dev" }),
    await createUser({ name: "Meera" }),
    await createUser({ name: "Mallory" }),
  ];
  g = await createGroup(asha.id);
  ashaM = await memberOf(g.id, asha.id);
  await addMember(g.id, { userId: dev.id, role: "ADMIN" });
  raviM = await addMember(g.id, { userId: ravi.id });
  await addMember(g.id, { userId: meera.id });
  rahulM = await addMember(g.id, { displayName: "Rahul" });
  expense = await createExpenseRow(g.id, {
    createdByMemberId: ashaM.id,
    description: "Dinner at Thalassa",
    payers: [[ashaM.id, 300n]],
    shares: [[ashaM.id, 150n], [raviM.id, 150n]],
  });
  payment = await createSettlementRow(g.id, { fromMemberId: rahulM.id, toMemberId: ashaM.id, amount: 100n, createdByMemberId: ashaM.id });
});

const activityOf = () => db.activity.findMany({ where: { groupId: g.id }, orderBy: { id: "asc" } });
const onExpense = () => ({ kind: "expense", id: expense.id }) as const;

describe("addComment", () => {
  it("lists with its author, oldest first, and logs comment.created", async () => {
    await addComment(ravi.id, onExpense(), "Did we include the tip?");
    await addComment(asha.id, onExpense(), "Yes, 10%");

    const comments = await listComments(ravi.id, onExpense());
    expect(comments.map((c) => c.body)).toEqual(["Did we include the tip?", "Yes, 10%"]);
    expect(comments[0]).toMatchObject({
      author: { memberId: raviM.id, displayName: "Ravi", image: "https://example.test/ravi.png" },
      canDelete: true,
    });
    expect(comments[1]).toMatchObject({ author: { memberId: ashaM.id, image: null }, canDelete: false });

    const stored = await db.comment.findMany({ orderBy: { createdAt: "asc" } });
    expect(await activityOf()).toMatchObject([
      {
        kind: "comment.created",
        actorMemberId: raviM.id,
        entityId: stored[0].id,
        payload: { targetKind: "expense", targetId: expense.id, targetLabel: "Dinner at Thalassa", excerpt: "Did we include the tip?" },
      },
      { kind: "comment.created", actorMemberId: ashaM.id, entityId: stored[1].id },
    ]);
    expect(stored[0]).toMatchObject({ groupId: g.id, expenseId: expense.id, settlementId: null, authorMemberId: raviM.id });
  });

  it("keeps the first 80 characters as the excerpt, never splitting an emoji", async () => {
    await addComment(ravi.id, onExpense(), `${"x".repeat(79)}🎉${"y".repeat(20)}`);
    const { payload } = (await activityOf())[0];
    expect(payload).toMatchObject({ excerpt: `${"x".repeat(79)}🎉` });
    expect(await db.comment.findFirstOrThrow()).toMatchObject({ body: `${"x".repeat(79)}🎉${"y".repeat(20)}` });
  });

  it("works on a payment", async () => {
    const target = { kind: "settlement", id: payment.id } as const;
    await addComment(asha.id, target, "Received, thanks");

    expect(await listComments(ravi.id, target)).toMatchObject([{ body: "Received, thanks", author: { displayName: "Asha" } }]);
    expect(await db.comment.findFirstOrThrow()).toMatchObject({ settlementId: payment.id, expenseId: null });
    expect((await activityOf())[0].payload).toMatchObject({
      targetKind: "settlement",
      targetId: payment.id,
      targetLabel: "payment from Rahul to Asha",
      excerpt: "Received, thanks",
    });
  });

  it("refuses a deleted expense or payment", async () => {
    await db.expense.update({ where: { id: expense.id }, data: { deletedAt: new Date() } });
    await db.settlement.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
    await expect(addComment(ravi.id, onExpense(), "Hi")).rejects.toThrow(new UserError("This expense was deleted."));
    await expect(addComment(ravi.id, { kind: "settlement", id: payment.id }, "Hi")).rejects.toThrow(new UserError("This payment was deleted."));
    expect(await db.comment.count()).toBe(0);
    expect(await activityOf()).toEqual([]);
  });

  it("refuses an archived group", async () => {
    await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
    await expect(addComment(ravi.id, onExpense(), "Hi")).rejects.toThrow("This group is archived.");
    // Read-only now, so nothing offers a delete that would be refused.
    await createCommentRow({ groupId: g.id, expenseId: expense.id, authorMemberId: raviM.id });
    expect((await listComments(ravi.id, onExpense())).map((c) => c.canDelete)).toEqual([false]);
  });

  it("refuses an outsider, and someone who left, without writing anything", async () => {
    await expect(addComment(mallory.id, onExpense(), "Hi")).rejects.toBeInstanceOf(ForbiddenError);
    await db.groupMember.update({ where: { id: raviM.id }, data: { leftAt: new Date() } });
    await expect(addComment(ravi.id, onExpense(), "Hi")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.comment.count()).toBe(0);
    expect(await activityOf()).toEqual([]);
  });
});

describe("listComments", () => {
  it("leaves out deleted comments and shows who can delete what", async () => {
    await createCommentRow({ groupId: g.id, expenseId: expense.id, authorMemberId: raviM.id, body: "Mine" });
    await createCommentRow({ groupId: g.id, expenseId: expense.id, authorMemberId: ashaM.id, body: "Hers" });
    await db.comment.create({ data: { groupId: g.id, expenseId: expense.id, authorMemberId: ashaM.id, body: "Gone", deletedAt: new Date() } });
    await createCommentRow({ groupId: g.id, settlementId: payment.id, authorMemberId: ashaM.id, body: "On the payment" });

    const asRavi = await listComments(ravi.id, onExpense());
    expect(asRavi.map((c) => [c.body, c.canDelete])).toEqual([["Mine", true], ["Hers", false]]);
    expect((await listComments(dev.id, onExpense())).map((c) => c.canDelete)).toEqual([true, true]);
  });

  it("names an author who has left", async () => {
    await createCommentRow({ groupId: g.id, expenseId: expense.id, authorMemberId: raviM.id });
    await db.groupMember.update({ where: { id: raviM.id }, data: { leftAt: new Date() } });
    expect(await listComments(asha.id, onExpense())).toMatchObject([{ author: { displayName: "Ravi" } }]);
  });

  it("refuses an outsider", async () => {
    await expect(listComments(mallory.id, onExpense())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("deleteComment", () => {
  let commentId: string;
  beforeEach(async () => {
    commentId = (await createCommentRow({ groupId: g.id, expenseId: expense.id, authorMemberId: raviM.id })).id;
  });
  const isDeleted = async () => (await db.comment.findUniqueOrThrow({ where: { id: commentId } })).deletedAt !== null;

  it("lets the author soft-delete it, with no activity", async () => {
    await deleteComment(ravi.id, commentId);
    expect(await isDeleted()).toBe(true);
    expect(await listComments(ravi.id, onExpense())).toEqual([]);
    expect(await activityOf()).toEqual([]);
  });

  it("takes the excerpt out of the feed, keeping the row", async () => {
    const { id } = await addComment(ravi.id, onExpense(), "Did we include the tip?");
    await addComment(meera.id, onExpense(), "Yes, 10%");
    await deleteComment(ravi.id, id);

    const feed = (await listGroupActivity(asha.id, g.id)).items.filter((i) => i.kind === "comment.created");
    expect(feed.map((i) => describeActivity(i).detail).sort()).toEqual(["Yes, 10%", null]);
    expect(describeActivity(feed.find((i) => i.entityId === id)!).title).toBe("Ravi commented on “Dinner at Thalassa”");
    expect(JSON.stringify(await activityOf())).not.toContain("include the tip");
  });

  it("refuses another member", async () => {
    await expect(deleteComment(meera.id, commentId)).rejects.toThrow(new UserError(ONLY_AUTHOR));
    expect(await isDeleted()).toBe(false);
  });

  it.each([["an admin", () => dev], ["the owner", () => asha]])("lets %s delete it", async (_, who) => {
    await deleteComment(who().id, commentId);
    expect(await isDeleted()).toBe(true);
  });

  it("is a no-op the second time", async () => {
    await deleteComment(ravi.id, commentId);
    const { deletedAt } = await db.comment.findUniqueOrThrow({ where: { id: commentId } });
    await deleteComment(ravi.id, commentId);
    expect((await db.comment.findUniqueOrThrow({ where: { id: commentId } })).deletedAt).toEqual(deletedAt);
  });

  it("refuses an outsider and an unknown id", async () => {
    await expect(deleteComment(mallory.id, commentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteComment(asha.id, "no-such-comment")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await isDeleted()).toBe(false);
  });
});

describe("comment actions", () => {
  beforeEach(() => void (session.user = { ...ravi, defaultCurrency: ravi.defaultCurrency, upiId: ravi.upiId, image: ravi.image }));

  it("adds a trimmed comment to the target's group and deletes it again", async () => {
    const added = await addCommentAction({ target: { kind: "expense", id: expense.id }, body: "  Looks right  " });
    expect(added).toEqual({ ok: true, data: { id: expect.any(String) } });
    expect(await db.comment.findFirstOrThrow()).toMatchObject({ body: "Looks right", groupId: g.id });

    expect(await deleteCommentAction({ commentId: (added as { data: { id: string } }).data.id })).toEqual({ ok: true, data: undefined });
    expect(await listComments(ravi.id, onExpense())).toEqual([]);
  });

  it.each([
    ["   ", "Write a comment"],
    ["x".repeat(1001), "Comments must be 1,000 characters or fewer"],
  ])("refuses %j", async (body, error) => {
    expect(await addCommentAction({ target: { kind: "expense", id: expense.id }, body })).toEqual({ ok: false, error });
    expect(await db.comment.count()).toBe(0);
  });

  it("accepts exactly 1,000 characters", async () => {
    expect(await addCommentAction({ target: { kind: "settlement", id: payment.id }, body: "x".repeat(1000) })).toMatchObject({ ok: true });
  });
});
