import { db } from "@/lib/db";
import { EmailRateLimitError, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { newClaimToken, newInviteCode } from "@/lib/tokens";
import type { PlaceholderInput } from "@/lib/validation";
import { inviteEmail } from "@/emails/invite";
import { Prisma, type GroupMember } from "@/generated/prisma/client";
import { recordActivity } from "./activity";
import { requireMember } from "./authz";
import { ForbiddenError, NotFoundError, UserError } from "./errors";

const ARCHIVED = "This group is archived.";
const USED_LINK = "This link was already used or has been reset.";
const NOT_JOINED = "They haven't joined Hisaab yet.";
const STALE = "That changed while you were doing it. Please try again.";

// Emails are compared as exact strings (lowercased), never with Prisma's `mode: "insensitive"`: on Postgres that compiles
// to ILIKE and doesn't escape the value, so a `_` or `%` in an address would match other people's addresses.
// Placeholder emails are stored lowercased (addPlaceholder is the only writer); a user's email may not be, so it is lowercased
// at the comparison point.

/** The links people open, on the app's public origin: a group's invite link, and a placeholder's claim link. */
export const inviteUrl = (code: string) => new URL(`/join/${code}`, env.BETTER_AUTH_URL).href;
export const claimUrl = (token: string) => new URL(`/claim/${token}`, env.BETTER_AUTH_URL).href;

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
 * The row is written before the email goes out and stays whatever happens to the email, so the person is in the group
 * and anyone in it can copy their link by hand. `emailSent`: true when the invite went out, false when an email limit
 * refused it (not an error: the person was added), and null when no email was given. Any other send failure throws.
 */
export async function addPlaceholder(
  userId: string,
  groupId: string,
  input: PlaceholderInput,
): Promise<{ member: GroupMember; emailSent: boolean | null }> {
  const { group, member: actor } = await requireMember(userId, groupId, { write: true });
  const email = input.email?.toLowerCase();
  if (email) {
    // ponytail: compares in JS over the group's rows (a handful to a few dozen); use SQL lower(email) if groups ever get huge.
    const rows = await db.groupMember.findMany({
      where: { groupId },
      select: { email: true, leftAt: true, user: { select: { email: true } } },
    });
    const same = rows.filter((m) => [m.email, m.user?.email].some((known) => known?.toLowerCase() === email));
    if (same.some((m) => !m.leftAt)) throw new UserError("They're already in this group.");
    // Someone with an account who left: claiming refuses them (checkClaim), and only the invite link brings them back.
    // A removed placeholder never joined, so a new one for the same email is fine.
    if (same.some((m) => m.user)) throw new UserError("They were in this group before. Share the group's invite link so they can rejoin.");
  }

  const claimToken = newClaimToken();
  const member = await db.$transaction(async (tx) => {
    const created = await tx.groupMember.create({ data: { groupId, displayName: input.displayName, email, claimToken } });
    await recordActivity(tx, {
      groupId,
      actorMemberId: actor.id,
      kind: "member.added",
      entityId: created.id,
      payload: { memberId: created.id, displayName: created.displayName },
    });
    return created;
  });
  if (!email) return { member, emailSent: null };

  const inviter = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  try {
    await sendEmail({
      to: email,
      kind: "invite",
      senderUserId: userId, // without it the per-sender limit is skipped
      ...inviteEmail({
        inviterName: inviter.name,
        groupName: group.name,
        claimUrl: claimUrl(claimToken),
      }),
    });
  } catch (error) {
    if (error instanceof EmailRateLimitError) return { member, emailSent: false };
    throw error;
  }
  return { member, emailSent: true };
}

/**
 * The rules for using an invite code, shared by joining and its preview so the two can't drift apart. An active member
 * is let through even when the group is archived (they can still read it); anyone else is refused once it is.
 */
async function checkInvite(userId: string, code: string) {
  const group = await db.group.findUnique({ where: { inviteCode: code } });
  if (!group || group.type === "DIRECT") throw new NotFoundError("This invite link is invalid or has been reset.");
  const existing = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId } } });
  const isMember = !!existing && !existing.leftAt;
  if (!isMember && group.archivedAt) throw new UserError(ARCHIVED);
  return { group, existing, isMember };
}

/** What the join page shows before anyone taps "Join group": refuses exactly what joining would, and writes nothing. */
export async function getInvitePreview(
  userId: string,
  code: string,
): Promise<
  | { status: "member"; groupId: string }
  | { status: "invite"; group: { name: string; emoji: string; color: string }; memberCount: number; memberNames: string[] }
> {
  const { group, isMember } = await checkInvite(userId, code);
  if (isMember) return { status: "member", groupId: group.id };
  const members = await db.groupMember.findMany({
    where: { groupId: group.id, leftAt: null },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    select: { displayName: true },
  });
  return {
    status: "invite",
    group: { name: group.name, emoji: group.emoji, color: group.color },
    memberCount: members.length,
    memberNames: members.slice(0, 3).map((m) => m.displayName.trim().split(/\s+/)[0]),
  };
}

/**
 * Puts the person in the group the invite code belongs to. Safe to repeat: someone already in gets their group back
 * (even if it's archived, where they can still read it), someone who left gets their old row back, and someone a
 * placeholder was made for (same email) takes it over. Anyone not in the group is refused once it is archived.
 */
export async function joinByInviteCode(userId: string, code: string): Promise<{ groupId: string }> {
  const { group, existing, isMember } = await checkInvite(userId, code);
  const groupId = group.id;
  if (isMember) return { groupId };

  try {
    await db.$transaction(async (tx) => {
      let joined: { id: string; displayName: string } | null;
      if (existing) {
        // Back as a plain member, so someone removed as an admin can't take the role back through the public link.
        // Conditional on still being gone: of two taps at once, only the one that brings them back logs it.
        const back = await tx.groupMember.updateMany({
          where: { id: existing.id, leftAt: { not: null } },
          data: { leftAt: null, joinedAt: new Date(), role: "MEMBER" },
        });
        joined = back.count === 1 ? existing : null;
      } else {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
        const placeholder = await tx.groupMember.findFirst({
          where: { groupId, userId: null, leftAt: null, email: user.email.toLowerCase() },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        // Conditional, so a placeholder someone else just claimed isn't taken twice; then we fall back to a new row.
        const claimed = placeholder
          ? await tx.groupMember.updateMany({
              where: { id: placeholder.id, userId: null, leftAt: null },
              data: { userId, claimToken: null, displayName: user.name, joinedAt: new Date() },
            })
          : { count: 0 };
        joined =
          placeholder && claimed.count === 1
            ? { id: placeholder.id, displayName: user.name }
            : await tx.groupMember.create({ data: { groupId, userId, displayName: user.name } });
      }
      if (joined) {
        await recordActivity(tx, {
          groupId,
          actorMemberId: joined.id,
          kind: "member.joined",
          entityId: joined.id,
          payload: { memberId: joined.id, displayName: joined.displayName },
        });
      }
    });
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

/** The rules for using a claim link, shared by claiming and its preview so the two can't drift apart. */
async function checkClaim(userId: string, token: string) {
  // A removed placeholder's link is dead too (leftAt), the same as a spent or reset one.
  const placeholder = await db.groupMember.findUnique({
    where: { claimToken: token, userId: null, leftAt: null },
    include: { group: { select: { archivedAt: true, name: true, emoji: true, color: true } } },
  });
  if (!placeholder) throw new NotFoundError(USED_LINK);
  if (placeholder.group.archivedAt) throw new UserError(ARCHIVED);

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  if (placeholder.email && placeholder.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new UserError("This invite was sent to a different email address.");
  }
  const mine = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: placeholder.groupId, userId } } });
  if (mine?.leftAt) throw new UserError("You were in this group before. Use the group's invite link to rejoin.");
  if (mine) throw new UserError("You're already in this group.");
  return { placeholder, user };
}

/** What the claim page shows before anyone taps "Join group": refuses exactly what claiming would, and writes nothing. */
export async function getClaimPreview(
  userId: string,
  token: string,
): Promise<{ group: { name: string; emoji: string; color: string }; placeholderName: string }> {
  const { placeholder } = await checkClaim(userId, token);
  const { name, emoji, color } = placeholder.group;
  return { group: { name, emoji, color }, placeholderName: placeholder.displayName };
}

/** Takes over the placeholder a claim link points at. The token is spent in the same write, so it works once. */
export async function claimPlaceholder(userId: string, token: string): Promise<{ groupId: string }> {
  const { placeholder, user } = await checkClaim(userId, token);
  const { groupId } = placeholder;

  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.groupMember.updateMany({
        where: { id: placeholder.id, claimToken: token, userId: null, leftAt: null },
        data: { userId, claimToken: null, displayName: user.name, joinedAt: new Date() },
      });
      if (claimed.count === 0) throw new NotFoundError(USED_LINK);
      await recordActivity(tx, {
        groupId,
        actorMemberId: placeholder.id,
        kind: "member.joined",
        entityId: placeholder.id,
        payload: { memberId: placeholder.id, displayName: user.name },
      });
    });
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
  await db.$transaction(async (tx) => {
    const { count } = await tx.groupMember.updateMany({
      where: { id: target.id, role: target.role, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (count === 0) throw new UserError(STALE);
    await recordActivity(tx, {
      groupId: target.groupId,
      actorMemberId: actor.id,
      kind: "member.removed",
      entityId: target.id,
      payload: { memberId: target.id, displayName: target.displayName },
    });
  });
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
  await db.$transaction(async (tx) => {
    const { count } = await tx.groupMember.updateMany({
      where: { id: member.id, role: member.role, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (count === 0) throw new UserError(STALE);
    await recordActivity(tx, {
      groupId,
      actorMemberId: member.id,
      kind: "member.left",
      entityId: member.id,
      payload: { memberId: member.id, displayName: member.displayName },
    });
  });
}
