import { db } from "@/lib/db";
import { newInviteCode } from "@/lib/tokens";
import type { Group, GroupMember, MemberRole, User } from "@/generated/prisma/client";

let counter = 0;

/** A user who has finished onboarding, with a unique email. Better Auth normally supplies the id, so we do. */
export function createUser(overrides: Partial<User> = {}): Promise<User> {
  counter += 1;
  return db.user.create({
    data: {
      id: crypto.randomUUID(),
      name: `User ${counter}`,
      email: `user${counter}-${crypto.randomUUID().slice(0, 8)}@example.test`,
      onboardedAt: new Date(),
      ...overrides,
    },
  });
}

let groupCounter = 0;

/** A group with `ownerId` as its OWNER member. */
export async function createGroup(ownerId: string, overrides: Partial<Group> = {}): Promise<Group> {
  groupCounter += 1;
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  return db.group.create({
    data: {
      name: `Group ${groupCounter}`,
      emoji: "👥",
      color: "emerald",
      type: "OTHER",
      baseCurrency: "INR",
      inviteCode: newInviteCode(),
      createdById: ownerId,
      ...overrides,
      members: { create: { userId: ownerId, displayName: owner.name, role: "OWNER" } },
    },
  });
}

/** A member row: a real user when `userId` is given, otherwise a placeholder. */
export async function addMember(
  groupId: string,
  data: { userId?: string; role?: MemberRole; leftAt?: Date; displayName?: string; email?: string; claimToken?: string } = {},
): Promise<GroupMember> {
  const user = data.userId ? await db.user.findUniqueOrThrow({ where: { id: data.userId } }) : null;
  return db.groupMember.create({ data: { ...data, groupId, displayName: data.displayName ?? user?.name ?? "Placeholder" } });
}
