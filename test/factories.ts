import { db } from "@/lib/db";
import { newInviteCode } from "@/lib/tokens";
import type {
  Comment,
  Expense,
  Group,
  GroupMember,
  MemberRole,
  Settlement,
  SettlementStatus,
  User,
} from "@/generated/prisma/client";

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

/** The member row `userId` has in the group, whether or not they have left. */
export function memberOf(groupId: string, userId: string): Promise<GroupMember> {
  return db.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId, userId } } });
}

/**
 * An expense written straight to the tables, as the group's own currency: `amount` is the sum of the payers and the
 * method EXACT. It skips the service's rules, so use it for what hangs off an expense, not for testing the rules.
 * `splitInput` is left empty for the same reason.
 */
export async function createExpenseRow(
  groupId: string,
  data: {
    createdByMemberId: string;
    payers: [string, bigint][];
    shares: [string, bigint][];
    description?: string;
    deletedAt?: Date;
  },
): Promise<Expense> {
  const { baseCurrency } = await db.group.findUniqueOrThrow({ where: { id: groupId }, select: { baseCurrency: true } });
  const amount = data.payers.reduce((sum, [, paid]) => sum + paid, 0n);
  const rows = (pairs: [string, bigint][]) => ({
    create: pairs.map(([memberId, value]) => ({ memberId, amount: value, baseAmount: value })),
  });
  return db.expense.create({
    data: {
      groupId,
      description: data.description ?? "Dinner",
      category: "other",
      date: new Date("2026-01-15"),
      currency: baseCurrency,
      amount,
      baseAmount: amount,
      splitMethod: "EXACT",
      splitInput: {},
      createdByMemberId: data.createdByMemberId,
      deletedAt: data.deletedAt,
      payers: rows(data.payers),
      shares: rows(data.shares),
    },
  });
}

/** A settlement (UPI, in the group's own currency) written straight to the table. */
export async function createSettlementRow(
  groupId: string,
  data: {
    fromMemberId: string;
    toMemberId: string;
    amount: bigint;
    createdByMemberId: string;
    status?: SettlementStatus;
    deletedAt?: Date;
  },
): Promise<Settlement> {
  const { baseCurrency } = await db.group.findUniqueOrThrow({ where: { id: groupId }, select: { baseCurrency: true } });
  return db.settlement.create({
    data: { ...data, groupId, currency: baseCurrency, baseAmount: data.amount, method: "UPI", date: new Date("2026-01-15") },
  });
}

/** A comment on an expense or a settlement (the caller gives one of the two ids). */
export function createCommentRow(data: {
  groupId: string;
  authorMemberId: string;
  expenseId?: string;
  settlementId?: string;
  body?: string;
}): Promise<Comment> {
  return db.comment.create({ data: { ...data, body: data.body ?? "Looks right" } });
}
