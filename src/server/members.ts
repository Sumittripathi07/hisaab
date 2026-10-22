import { db } from "@/lib/db";
import { EmailRateLimitError, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { newClaimToken, newInviteCode } from "@/lib/tokens";
import type { PlaceholderInput } from "@/lib/validation";
import { inviteEmail } from "@/emails/invite";
import { Prisma, type GroupMember } from "@/generated/prisma/client";
import { requireMember } from "./authz";
import { ForbiddenError, NotFoundError, UserError } from "./errors";

const ARCHIVED = "This group is archived.";
const USED_LINK = "This link was already used or has been reset.";
const NOT_JOINED = "They haven't joined Hisaab yet.";
const STALE = "That changed while you were doing it. Please try again.";

/** Matches an email whatever its case. Prisma lowers both sides, so `_` and `%` in an address stay literal. */
const sameEmail = (email: string) => ({ equals: email, mode: "insensitive" as const });

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const isActiveMember = async (userId: string, groupId: string) =>
  (await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId }, leftAt: null }, select: { id: true } })) !== null;

/**
 * The active member `memberId` and the caller's own membership, once the caller is cleared to act in that group.
 * An unknown id is as forbidden as a group the caller can't see, so ids never confirm anything to outsiders.
 */
async function requireTarget(userId: string, memberId: string, opts: Parameters<typeof requireMember>[2]) {
  const target = await db.groupMember.findUnique({ where: { id: memberId } });
  if (!target) throw new ForbiddenError();
  const { member: actor } = await requireMember(userId, target.groupId, opts);
  if (target.leftAt) throw new NotFoundError("They're not in this group.");
  return { target, actor };
}

/**
 * Adds someone by name, with a claim link (and an invite email when we have their address).
 * The row is written before the email goes out and stays if the send is refused, so the person is still
 * in the group and an admin can copy the link to them by hand.
 */
export async function addPlaceholder(userId: string, groupId: string, input: PlaceholderInput): Promise<GroupMember> {
  const { group } = await requireMember(userId, groupId, { write: true });
  const email = input.email?.toLowerCase();
  if (email) {
    const taken = await db.groupMember.findFirst({
      where: { groupId, leftAt: null, OR: [{ email: sameEmail(email) }, { user: { email: sameEmail(email) } }] },
      select: { id: true },
    });
    if (taken) throw new UserError("They're already in this group.");
  }

  const placeholder = await db.groupMember.create({
    data: { groupId, displayName: input.displayName, email, claimToken: newClaimToken() },
  });
  if (!email) return placeholder;

  const inviter = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  try {
    await sendEmail({
      to: email,
      kind: "invite",
      senderUserId: userId, // without it the per-sender limit is skipped
      ...inviteEmail({
        inviterName: inviter.name,
        groupName: group.name,
        claimUrl: new URL(`/claim/${placeholder.claimToken}`, env.BETTER_AUTH_URL).href,
      }),
    });
  } catch (error) {
    if (error instanceof EmailRateLimitError) throw new UserError("You've sent a lot of invites. Try again in an hour.");
    throw error;
  }
  return placeholder;
}

/**
 * Puts the person in the group the invite code belongs to. Safe to repeat: someone already in gets their group back,
 * someone who left gets their old row back, and someone a placeholder was made for (same email) takes it over.
 */
export async function joinByInviteCode(userId: string, code: string): Promise<{ groupId: string }> {
  const group = await db.group.findUnique({ where: { inviteCode: code } });
  if (!group || group.type === "DIRECT") throw new NotFoundError("This invite link is invalid or has been reset.");
  if (group.archivedAt) throw new UserError(ARCHIVED);
  const groupId = group.id;

  const existing = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (existing && !existing.leftAt) return { groupId };

  try {
    if (existing) {
      // Back as a plain member, so someone removed as an admin can't take the role back through the public link.
      await db.groupMember.update({ where: { id: existing.id }, data: { leftAt: null, joinedAt: new Date(), role: "MEMBER" } });
    } else {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
      const placeholder = await db.groupMember.findFirst({
        where: { groupId, userId: null, leftAt: null, email: sameEmail(user.email) },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      // Conditional, so a placeholder someone else just claimed isn't taken twice; then we fall back to a new row.
      const claimed = placeholder
        ? await db.groupMember.updateMany({
            where: { id: placeholder.id, userId: null, leftAt: null },
            data: { userId, claimToken: null, displayName: user.name, joinedAt: new Date() },
          })
        : { count: 0 };
      if (claimed.count === 0) await db.groupMember.create({ data: { groupId, userId, displayName: user.name } });
    }
  } catch (error) {
    // A parallel join of ours won the (groupId, userId) unique: the person is in, which is all this call promises.
    if (!isUniqueViolation(error) || !(await isActiveMember(userId, groupId))) throw error;
  }
  return { groupId };
}

/** Invalidates the old invite link by issuing a new code. */
export async function rotateInviteCode(userId: string, groupId: string): Promise<string> {
  await requireMember(userId, groupId, { role: "admin", write: true });
  const { inviteCode } = await db.group.update({
    where: { id: groupId },
    data: { inviteCode: newInviteCode() },
    select: { inviteCode: true },
  });
  return inviteCode;
}

/** Takes over the placeholder a claim link points at. The token is spent in the same write, so it works once. */
export async function claimPlaceholder(userId: string, token: string): Promise<{ groupId: string }> {
  // A removed placeholder's link is dead too (leftAt), the same as a spent or reset one.
  const placeholder = await db.groupMember.findUnique({
    where: { claimToken: token, userId: null, leftAt: null },
    include: { group: { select: { archivedAt: true } } },
  });
  if (!placeholder) throw new NotFoundError(USED_LINK);
  if (placeholder.group.archivedAt) throw new UserError(ARCHIVED);
  const { groupId } = placeholder;

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  if (placeholder.email && placeholder.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new UserError("This invite was sent to a different email address.");
  }
  const mine = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (mine?.leftAt) throw new UserError("You were in this group before. Use the group's invite link to rejoin.");
  if (mine) throw new UserError("You're already in this group.");

  try {
    const claimed = await db.groupMember.updateMany({
      where: { id: placeholder.id, claimToken: token, userId: null, leftAt: null },
      data: { userId, claimToken: null, displayName: user.name, joinedAt: new Date() },
    });
    if (claimed.count === 0) throw new NotFoundError(USED_LINK);
  } catch (error) {
    // Two claims by one person at once: the other one won the (groupId, userId) unique.
    if (isUniqueViolation(error)) throw new UserError("You're already in this group.");
    throw error;
  }
  return { groupId };
}

/** A fresh claim link for a placeholder; the old one stops working. */
export async function regenerateClaimToken(userId: string, memberId: string): Promise<string> {
  const { target } = await requireTarget(userId, memberId, { role: "admin", write: true });
  const claimToken = newClaimToken();
  // Conditional on still being a placeholder, so a claim landing in between can't leave a joined member holding a token.
  const { count } = await db.groupMember.updateMany({ where: { id: target.id, userId: null, leftAt: null }, data: { claimToken } });
  if (count === 0) throw new UserError("They've already joined, so there's no link to reset.");
  return claimToken;
}

export async function removeMember(userId: string, memberId: string): Promise<void> {
  const { target, actor } = await requireTarget(userId, memberId, { role: "admin", write: true });
  if (target.role === "OWNER") throw new UserError("The owner can't be removed.");
  if (target.role === "ADMIN" && actor.role !== "OWNER") throw new ForbiddenError();
  // Conditional on the role we checked: if ownership just moved to them, this must not remove the new owner.
  const { count } = await db.groupMember.updateMany({
    where: { id: target.id, role: target.role, leftAt: null },
    data: { leftAt: new Date() },
  });
  if (count === 0) throw new UserError(STALE);
}

export async function setMemberRole(userId: string, memberId: string, role: "ADMIN" | "MEMBER"): Promise<void> {
  const { target } = await requireTarget(userId, memberId, { role: "owner", write: true });
  if (target.role === "OWNER") throw new UserError("Transfer ownership to change the owner's role.");
  if (!target.userId) throw new UserError(NOT_JOINED);
  // Conditional, so a transfer landing in between can't demote the new owner and leave the group without one.
  const { count } = await db.groupMember.updateMany({
    where: { id: target.id, role: { not: "OWNER" }, userId: { not: null }, leftAt: null },
    data: { role },
  });
  if (count === 0) throw new UserError(STALE);
}

/** Makes `memberId` the owner and the caller an admin, together or not at all. */
export async function transferOwnership(userId: string, memberId: string): Promise<void> {
  const { target, actor } = await requireTarget(userId, memberId, { role: "owner", write: true });
  if (!target.userId) throw new UserError(NOT_JOINED);
  await db.$transaction(async (tx) => {
    // Demote first, conditional on still being the owner: of two transfers at once, the second finds no owner and fails,
    // and its rollback means the group is never left with two owners or none.
    const demoted = await tx.groupMember.updateMany({
      where: { id: actor.id, role: "OWNER", leftAt: null },
      data: { role: "ADMIN" },
    });
    const promoted = await tx.groupMember.updateMany({
      where: { id: target.id, userId: { not: null }, leftAt: null },
      data: { role: "OWNER" },
    });
    if (demoted.count !== 1 || promoted.count !== 1) throw new UserError(STALE);
  });
}

/** Archived groups can be left too: leaving is how someone clears one from their list. */
export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  const { member } = await requireMember(userId, groupId);
  if (member.role === "OWNER") throw new UserError("Transfer ownership before leaving.");
  // Conditional on the role we checked, so becoming the owner in the meantime can't leave the group ownerless.
  const { count } = await db.groupMember.updateMany({
    where: { id: member.id, role: member.role, leftAt: null },
    data: { leftAt: new Date() },
  });
  if (count === 0) throw new UserError(STALE);
}
