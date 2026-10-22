import { db } from "@/lib/db";
import type { Group, GroupMember, MemberRole } from "@/generated/prisma/client";
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
