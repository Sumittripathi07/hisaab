import { db } from "@/lib/db";
import { newInviteCode } from "@/lib/tokens";
import type { GroupInput } from "@/lib/validation";
import type { Group, GroupMember, MemberRole } from "@/generated/prisma/client";
import { requireMember } from "./authz";
import { myBalancesByGroup } from "./balances";
import { UserError } from "./errors";

export type GroupListItem = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  type: Group["type"];
  baseCurrency: string;
  memberCount: number;
  previewMembers: { displayName: string; image: string | null }[];
  /** The person's net in the group: positive when they're owed. */
  myNet: bigint;
};

const PREVIEW_SIZE = 5;
const ROLE_RANK: Record<MemberRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

/** Creates the group and its OWNER member in one write, so a group never exists without an owner. */
export async function createGroup(userId: string, input: GroupInput): Promise<Group> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return db.group.create({
    data: {
      ...input,
      inviteCode: newInviteCode(),
      createdById: userId,
      members: { create: { userId, displayName: user.name, role: "OWNER" } },
    },
  });
}

/** Any expense or payment, deleted ones too (they can be restored), is in the group's currency, so the currency stays. */
async function isCurrencyLocked(groupId: string): Promise<boolean> {
  const [expense, settlement] = await Promise.all([
    db.expense.findFirst({ where: { groupId }, select: { id: true } }),
    db.settlement.findFirst({ where: { groupId }, select: { id: true } }),
  ]);
  return expense !== null || settlement !== null;
}

export async function updateGroup(userId: string, groupId: string, input: GroupInput): Promise<Group> {
  const { group } = await requireMember(userId, groupId, { role: "admin", write: true });
  // ponytail: checked before the write, so an expense saved at the same moment keeps the old currency; lock the group row if that bites.
  if (input.baseCurrency !== group.baseCurrency && (await isCurrencyLocked(groupId))) {
    throw new UserError("The currency can't change once the group has expenses or payments.");
  }
  return db.group.update({ where: { id: groupId }, data: input });
}

export async function archiveGroup(userId: string, groupId: string): Promise<void> {
  await requireMember(userId, groupId, { role: "admin", write: true });
  await db.group.update({ where: { id: groupId }, data: { archivedAt: new Date() } });
}

/** No `write` check: archived is exactly the state this undoes. */
export async function unarchiveGroup(userId: string, groupId: string): Promise<void> {
  await requireMember(userId, groupId, { role: "admin" });
  await db.group.update({ where: { id: groupId }, data: { archivedAt: null } });
}

/** The person's current groups for the dashboard, most recently updated first. Two queries, however many groups. */
export async function listGroupsForUser(userId: string): Promise<{ active: GroupListItem[]; archived: GroupListItem[] }> {
  const [rows, nets] = await Promise.all([
    db.group.findMany({
      where: { type: { not: "DIRECT" }, members: { some: { userId, leftAt: null } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        emoji: true,
        color: true,
        type: true,
        baseCurrency: true,
        archivedAt: true,
        _count: { select: { members: { where: { leftAt: null } } } },
        members: {
          where: { leftAt: null },
          orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
          take: PREVIEW_SIZE,
          select: { displayName: true, user: { select: { image: true } } },
        },
      },
    }),
    myBalancesByGroup(userId),
  ]);
  const lists: { active: GroupListItem[]; archived: GroupListItem[] } = { active: [], archived: [] };
  for (const { archivedAt, _count, members, ...group } of rows) {
    const item: GroupListItem = {
      ...group,
      memberCount: _count.members,
      previewMembers: members.map((m) => ({ displayName: m.displayName, image: m.user?.image ?? null })),
      myNet: nets.get(group.id) ?? 0n,
    };
    (archivedAt ? lists.archived : lists.active).push(item);
  }
  return lists;
}

/** Everything the group page needs; any active member may read it, archived or not. */
export async function getGroupDetail(
  userId: string,
  groupId: string,
): Promise<{
  group: Group;
  me: GroupMember;
  members: (GroupMember & { image: string | null; isPlaceholder: boolean })[];
  currencyLocked: boolean;
}> {
  const { group, member: me } = await requireMember(userId, groupId);
  const [rows, currencyLocked] = await Promise.all([
    db.groupMember.findMany({
      where: { groupId, leftAt: null },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      include: { user: { select: { image: true } } },
    }),
    isCurrencyLocked(groupId),
  ]);
  // Sorted here rather than in SQL: Postgres orders an enum by declaration, which would silently change if a role were added.
  // Array.sort is stable, so the joinedAt order above survives within each role.
  const members = rows
    .map(({ user, ...m }) => ({ ...m, image: user?.image ?? null, isPlaceholder: m.userId === null }))
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  return { group, me, members, currencyLocked };
}
