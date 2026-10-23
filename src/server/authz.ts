import { db } from "@/lib/db";
import type { Comment, Expense, Group, GroupMember, MemberRole, Settlement } from "@/generated/prisma/client";
import { ForbiddenError, UserError } from "./errors";

const ROLES_FOR: Record<"admin" | "owner", readonly MemberRole[]> = {
  admin: ["ADMIN", "OWNER"],
  owner: ["OWNER"],
};

/**
 * The gate for everything group-scoped: resolves the user to an *active* member of the group, or throws.
 * A missing group, a non-member and someone who left all get the same ForbiddenError, so a group's existence
 * never leaks. `write` also refuses an archived group; that's checked last so outsiders never learn it's archived.
 */
export async function requireMember(
  userId: string,
  groupId: string,
  opts: { write?: boolean; role?: "admin" | "owner" } = {},
): Promise<{ member: GroupMember; group: Group }> {
  // findUnique on the compound key (not findFirst), so an undefined userId errors instead of matching anyone.
  const row = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId }, leftAt: null },
    include: { group: true },
  });
  if (!row) throw new ForbiddenError();
  const { group, ...member } = row;
  if (opts.role && !ROLES_FOR[opts.role].includes(member.role)) throw new ForbiddenError();
  if (opts.write && group.archivedAt) throw new UserError("This group is archived.");
  return { member, group };
}

type Rows = { expense: Expense; settlement: Settlement; comment: Comment };

const FIND: { [E in keyof Rows]: (id: string) => Promise<Rows[E] | null> } = {
  expense: (id) => db.expense.findUnique({ where: { id } }),
  settlement: (id) => db.settlement.findUnique({ where: { id } }),
  comment: (id) => db.comment.findUnique({ where: { id } }),
};

/**
 * `requireMember` for actions that name an expense, settlement or comment instead of a group: finds the row, then
 * checks the caller against the row's group. An unknown id is as forbidden as someone else's row, so ids never confirm
 * anything to outsiders. Soft-deleted rows are returned too; callers decide what a deleted row means to them.
 */
export async function requireMemberFor<E extends keyof Rows>(
  userId: string,
  entity: E,
  id: string,
  opts: { write?: boolean; role?: "admin" | "owner" } = {},
): Promise<{ member: GroupMember; group: Group; row: Rows[E] }> {
  const row = (await FIND[entity](id)) as Rows[E] | null;
  if (!row) throw new ForbiddenError();
  return { ...(await requireMember(userId, row.groupId, opts)), row };
}
