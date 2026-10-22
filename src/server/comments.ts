import { db } from "@/lib/db";
import { recordActivity } from "./activity";
import { requireMemberFor } from "./authz";
import { UserError } from "./errors";

export type CommentTarget = { kind: "expense" | "settlement"; id: string };

export type CommentItem = {
  id: string;
  body: string;
  createdAt: Date;
  author: { memberId: string; displayName: string; image: string | null };
  /** The author, or an admin or the owner. */
  canDelete: boolean;
};

const isAdmin = (member: { role: string }) => member.role === "ADMIN" || member.role === "OWNER";

/** The column a comment on `target` hangs off; exactly one of the two is ever set. */
const column = (target: CommentTarget) => (target.kind === "expense" ? { expenseId: target.id } : { settlementId: target.id });

/** The first 80 characters, counted whole: cutting an emoji in half would leave text the database can't store. */
const excerptOf = (body: string) => Array.from(body).slice(0, 80).join("");

export async function addComment(userId: string, target: CommentTarget, body: string): Promise<{ id: string }> {
  const { member, group, row } = await requireMemberFor(userId, target.kind, target.id, { write: true });
  if (row.deletedAt) throw new UserError(target.kind === "expense" ? "This expense was deleted." : "This payment was deleted.");
  let targetLabel: string;
  if ("description" in row) targetLabel = row.description;
  else {
    const { fromMember, toMember } = await db.settlement.findUniqueOrThrow({
      where: { id: row.id },
      select: { fromMember: { select: { displayName: true } }, toMember: { select: { displayName: true } } },
    });
    targetLabel = `payment from ${fromMember.displayName} to ${toMember.displayName}`;
  }
  return db.$transaction(async (tx) => {
    const { id } = await tx.comment.create({
      data: { groupId: group.id, authorMemberId: member.id, body, ...column(target) },
      select: { id: true },
    });
    await recordActivity(tx, {
      groupId: group.id,
      actorMemberId: member.id,
      kind: "comment.created",
      entityId: id,
      payload: { targetKind: target.kind, targetId: target.id, targetLabel, excerpt: excerptOf(body) },
    });
    return { id };
  });
}

/** A soft delete, conditional on it still being there, so a second tap changes nothing. Leaves no activity. */
export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const { member, row } = await requireMemberFor(userId, "comment", commentId, { write: true });
  if (row.authorMemberId !== member.id && !isAdmin(member)) throw new UserError("Only the author or an admin can delete this comment.");
  await db.comment.updateMany({ where: { id: commentId, deletedAt: null }, data: { deletedAt: new Date() } });
}

/** Oldest first. A deleted expense's comments are still readable here; the page decides whether to show them. */
export async function listComments(userId: string, target: CommentTarget): Promise<CommentItem[]> {
  const { member, group } = await requireMemberFor(userId, target.kind, target.id);
  const rows = await db.comment.findMany({
    where: { ...column(target), deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { author: { select: { displayName: true, user: { select: { image: true } } } } },
  });
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: { memberId: c.authorMemberId, displayName: c.author.displayName, image: c.author.user?.image ?? null },
    canDelete: !group.archivedAt && (c.authorMemberId === member.id || isAdmin(member)),
  }));
}
