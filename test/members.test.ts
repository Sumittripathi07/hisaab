import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import {
  addPlaceholderAction,
  claimPlaceholderAction,
  joinByInviteCodeAction,
  leaveGroupAction,
  regenerateClaimTokenAction,
  removeMemberAction,
  rotateInviteCodeAction,
  setMemberRoleAction,
  transferOwnershipAction,
} from "@/server/actions/members";
import { ForbiddenError, NotFoundError, UserError } from "@/server/errors";
import {
  addPlaceholder,
  claimPlaceholder,
  joinByInviteCode,
  leaveGroup,
  regenerateClaimToken,
  removeMember,
  rotateInviteCode,
  setMemberRole,
  transferOwnership,
} from "@/server/members";
import type { SessionUser } from "@/server/session";
import type { Group, GroupMember, User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup, createUser } from "./factories";
import { clearOutbox, lastEmailTo, readOutbox } from "./outbox";

// The action tests sign in as whoever `session.user` is; next/cache needs a request, so it's stubbed.
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Lets a test change the database right after the permission check, to play out a race in a fixed order.
const authz = vi.hoisted(() => ({ afterCheck: null as (() => Promise<unknown>) | null }));
vi.mock("@/server/authz", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/authz")>();
  return {
    requireMember: async (...args: Parameters<typeof original.requireMember>) => {
      const result = await original.requireMember(...args);
      const hook = authz.afterCheck;
      authz.afterCheck = null;
      await hook?.();
      return result;
    },
  };
});
// A passthrough spy, so one test can make a send fail.
vi.mock("@/lib/email", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/email")>();
  return { ...original, sendEmail: vi.fn(original.sendEmail) };
});

beforeEach(async () => {
  await resetDb();
  await clearOutbox();
  vi.mocked(revalidatePath).mockClear();
  authz.afterCheck = null;
});

let asha: User;
let g: Group;
beforeEach(async () => {
  asha = await createUser({ name: "Asha" });
  g = await createGroup(asha.id, { name: "Goa Trip" });
});

const memberRow = (id: string) => db.groupMember.findUniqueOrThrow({ where: { id } });
const rowFor = (userId: string, groupId = g.id) => db.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId, userId } } });
const activeOwners = (groupId = g.id) => db.groupMember.count({ where: { groupId, role: "OWNER", leftAt: null } });
const ownerRow = () => rowFor(asha.id);
const ALREADY_IN = "They're already in this group.";
const USED_LINK = "This link was already used or has been reset.";
const ARCHIVED = "This group is archived.";
const archive = () => db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });

/** A signed-up user who is an active member of `g` with `role`. */
async function memberWith(role: "ADMIN" | "MEMBER", overrides: Partial<User> = {}) {
  const user = await createUser(overrides);
  const member = await addMember(g.id, { userId: user.id, role });
  return { user, member };
}

const signInAs = (u: User) => {
  session.user = {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    defaultCurrency: u.defaultCurrency,
    upiId: u.upiId,
    timezone: u.timezone,
    onboardedAt: u.onboardedAt,
  };
};

describe("addPlaceholder", () => {
  it("adds a placeholder with a claim token, a lowercased email and no user", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "Rahul@Example.test" });
    expect(p).toMatchObject({ groupId: g.id, userId: null, displayName: "Rahul", email: "rahul@example.test", role: "MEMBER", leftAt: null });
    expect(p.claimToken).toHaveLength(32);
  });

  it("gives a placeholder without an email a claim token too, and sends nothing", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    expect(p).toMatchObject({ email: null, userId: null });
    expect(p.claimToken).toHaveLength(32);
    expect(await readOutbox()).toEqual([]);
  });

  it("sends an invite email with a claim link", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "Rahul@Example.test" });
    const m = await lastEmailTo("rahul@example.test");
    expect(m.subject).toBe("Asha added you to Goa Trip on Hisaab");
    expect(m.kind).toBe("invite");
    expect(m.text).toContain(`/claim/${p.claimToken}`);
    expect(m.text).toContain(`http://localhost:3000/claim/${p.claimToken}`);
  });

  it("lets any member add one, but not an outsider", async () => {
    const { user: ravi } = await memberWith("MEMBER");
    await expect(addPlaceholder(ravi.id, g.id, { displayName: "Rahul" })).resolves.toMatchObject({ displayName: "Rahul" });
    const stranger = await createUser();
    await expect(addPlaceholder(stranger.id, g.id, { displayName: "Rahul" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an archived group", async () => {
    await archive();
    await expect(addPlaceholder(asha.id, g.id, { displayName: "Rahul" })).rejects.toThrow(ARCHIVED);
  });

  it("refuses an email that belongs to a member, whatever its case", async () => {
    await memberWith("MEMBER", { email: "Ravi@Example.test" });
    await expect(addPlaceholder(asha.id, g.id, { displayName: "Ravi 2", email: "ravi@example.TEST" })).rejects.toThrow(ALREADY_IN);
    await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    await expect(addPlaceholder(asha.id, g.id, { displayName: "Rahul 2", email: "RAHUL@example.test" })).rejects.toThrow(ALREADY_IN);
    expect(await db.groupMember.count({ where: { groupId: g.id } })).toBe(3);
  });

  it("allows the email of someone who left", async () => {
    const left = await createUser({ email: "gone@example.test" });
    await addMember(g.id, { userId: left.id, leftAt: new Date() });
    await expect(addPlaceholder(asha.id, g.id, { displayName: "Gone", email: "gone@example.test" })).resolves.toBeDefined();
  });

  it("keeps the placeholder and says why when the sender hit the invite limit", async () => {
    await db.emailLog.createMany({
      data: Array.from({ length: 20 }, () => ({ kind: "invite", toEmail: "someone@example.test", senderUserId: asha.id })),
    });
    const err = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err).toHaveProperty("message", "You've sent a lot of invites. Try again in an hour.");
    expect(await db.groupMember.findFirst({ where: { groupId: g.id, email: "rahul@example.test" } })).toMatchObject({ userId: null });
    expect(await readOutbox()).toEqual([]);
  });

  it("limits invites per sender, not per group", async () => {
    await db.emailLog.createMany({
      data: Array.from({ length: 20 }, () => ({ kind: "invite", toEmail: "someone@example.test", senderUserId: asha.id })),
    });
    const { user: ravi } = await memberWith("MEMBER");
    await expect(addPlaceholder(ravi.id, g.id, { displayName: "Rahul", email: "rahul@example.test" })).resolves.toBeDefined();
  });

  it("lets other send failures through as they are, still keeping the placeholder", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));
    const err = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(UserError);
    expect(err).toHaveProperty("message", "smtp down");
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: null } })).toBe(1);
  });
});

describe("joinByInviteCode", () => {
  let ravi: User;
  beforeEach(async () => {
    ravi = await createUser({ name: "Ravi" });
  });

  it("makes the person a MEMBER named after their account", async () => {
    expect(await joinByInviteCode(ravi.id, g.inviteCode)).toEqual({ groupId: g.id });
    expect(await rowFor(ravi.id)).toMatchObject({ displayName: "Ravi", role: "MEMBER", leftAt: null, email: null });
  });

  it("joining twice keeps a single member row", async () => {
    await joinByInviteCode(ravi.id, g.inviteCode);
    expect(await joinByInviteCode(ravi.id, g.inviteCode)).toEqual({ groupId: g.id });
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: ravi.id } })).toBe(1);
  });

  it("leaves a single row when two joins race", async () => {
    const results = await Promise.all([joinByInviteCode(ravi.id, g.inviteCode), joinByInviteCode(ravi.id, g.inviteCode)]);
    expect(results).toEqual([{ groupId: g.id }, { groupId: g.id }]);
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: ravi.id } })).toBe(1);
  });

  it("is idempotent for someone who already has a role", async () => {
    const { user: admin, member } = await memberWith("ADMIN");
    await joinByInviteCode(admin.id, g.inviteCode);
    expect(await memberRow(member.id)).toMatchObject({ role: "ADMIN", leftAt: null });
  });

  it("rejoining after leaving reactivates the old row", async () => {
    const first = await joinByInviteCode(ravi.id, g.inviteCode).then(() => rowFor(ravi.id));
    await leaveGroup(ravi.id, g.id);
    expect((await rowFor(ravi.id)).leftAt).not.toBeNull();

    await joinByInviteCode(ravi.id, g.inviteCode);
    const again = await rowFor(ravi.id);
    expect(again).toMatchObject({ id: first.id, leftAt: null });
    expect(again.joinedAt.getTime()).toBeGreaterThan(first.joinedAt.getTime());
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: ravi.id } })).toBe(1);
  });

  it("brings a removed admin back as a plain member, not an admin", async () => {
    const { user: admin, member } = await memberWith("ADMIN");
    await removeMember(asha.id, member.id);
    await joinByInviteCode(admin.id, g.inviteCode);
    expect(await memberRow(member.id)).toMatchObject({ role: "MEMBER", leftAt: null });
  });

  it("joining claims a placeholder invited with the same email (case-insensitive)", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    const rahul = await createUser({ email: "Rahul@Example.test", name: "Rahul K" });
    expect(await joinByInviteCode(rahul.id, g.inviteCode)).toEqual({ groupId: g.id });
    expect(await memberRow(p.id)).toMatchObject({ userId: rahul.id, claimToken: null, displayName: "Rahul K" });
    expect(await db.groupMember.count({ where: { groupId: g.id } })).toBe(2);
  });

  it("leaves one row when joining races with itself over a placeholder", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    const rahul = await createUser({ email: "rahul@example.test", name: "Rahul K" });
    await Promise.all([joinByInviteCode(rahul.id, g.inviteCode), joinByInviteCode(rahul.id, g.inviteCode)]);
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: rahul.id } })).toBe(1);
    expect(await db.groupMember.count({ where: { groupId: g.id } })).toBe(2);
    expect((await memberRow(p.id)).userId).toBe(rahul.id);
  });

  it("does not claim a placeholder with another email, and treats _ in an email literally", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "A B", email: "a_b@example.test" });
    const other = await createUser({ email: "axb@example.test" });
    await joinByInviteCode(other.id, g.inviteCode);
    expect(await memberRow(p.id)).toMatchObject({ userId: null, claimToken: p.claimToken });
    expect(await rowFor(other.id)).not.toMatchObject({ id: p.id });
  });

  it("does not claim a placeholder that was removed", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    await removeMember(asha.id, p.id);
    const rahul = await createUser({ email: "rahul@example.test" });
    await joinByInviteCode(rahul.id, g.inviteCode);
    expect(await memberRow(p.id)).toMatchObject({ userId: null });
    expect((await rowFor(rahul.id)).id).not.toBe(p.id);
  });

  it("refuses joining an archived group", async () => {
    await archive();
    await expect(joinByInviteCode(ravi.id, g.inviteCode)).rejects.toThrow(ARCHIVED);
    await expect(joinByInviteCode(asha.id, g.inviteCode)).rejects.toThrow(ARCHIVED);
    expect(await db.groupMember.count({ where: { userId: ravi.id } })).toBe(0);
  });

  it("refuses an unknown or rotated invite code", async () => {
    const old = g.inviteCode;
    await rotateInviteCode(asha.id, g.id);
    for (const code of [old, "nope", ""]) {
      const err = await joinByInviteCode(ravi.id, code).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err).toHaveProperty("message", "This invite link is invalid or has been reset.");
    }
  });

  it("refuses the invite code of a DIRECT group", async () => {
    const direct = await createGroup(asha.id, { type: "DIRECT" });
    await expect(joinByInviteCode(ravi.id, direct.inviteCode)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("rotateInviteCode", () => {
  it("replaces the code and returns the new one", async () => {
    const code = await rotateInviteCode(asha.id, g.id);
    expect(code).toHaveLength(11);
    expect(code).not.toBe(g.inviteCode);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).inviteCode).toBe(code);
  });

  it("is for admins only", async () => {
    const { user: admin } = await memberWith("ADMIN");
    const { user: ravi } = await memberWith("MEMBER");
    await expect(rotateInviteCode(admin.id, g.id)).resolves.toHaveLength(11);
    await expect(rotateInviteCode(ravi.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an archived group and keeps its code", async () => {
    await archive();
    await expect(rotateInviteCode(asha.id, g.id)).rejects.toThrow(ARCHIVED);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).inviteCode).toBe(g.inviteCode);
  });
});

describe("claimPlaceholder", () => {
  let rahul: User;
  let p: GroupMember;
  beforeEach(async () => {
    p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
    rahul = await createUser({ email: "Rahul@Example.test", name: "Rahul K" });
  });
  const token = () => p.claimToken!;

  it("hands the placeholder to the claimer and kills the link", async () => {
    expect(await claimPlaceholder(rahul.id, token())).toEqual({ groupId: g.id });
    const claimed = await memberRow(p.id);
    expect(claimed).toMatchObject({ userId: rahul.id, claimToken: null, displayName: "Rahul K", role: "MEMBER", leftAt: null });
    expect(claimed.joinedAt.getTime()).toBeGreaterThan(p.joinedAt.getTime());
  });

  it("works once", async () => {
    await claimPlaceholder(rahul.id, token());
    const err = await claimPlaceholder(rahul.id, token()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toHaveProperty("message", USED_LINK);
    const someoneElse = await createUser({ email: "RAHUL@EXAMPLE.TEST" });
    await expect(claimPlaceholder(someoneElse.id, token())).rejects.toThrow(USED_LINK);
  });

  it("goes to exactly one of two people claiming at the same moment", async () => {
    const twin = await createUser({ email: "RAHUL@EXAMPLE.TEST", name: "Twin" });
    const results = await Promise.allSettled([claimPlaceholder(rahul.id, token()), claimPlaceholder(twin.id, token())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const loser = results.find((r) => r.status === "rejected")!;
    expect((loser as PromiseRejectedResult).reason).toHaveProperty("message", USED_LINK);
    const winner = (await memberRow(p.id)).userId;
    expect([rahul.id, twin.id]).toContain(winner);
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: { in: [rahul.id, twin.id] } } })).toBe(1);
  });

  it("refuses an unknown token", async () => {
    await expect(claimPlaceholder(rahul.id, "nope")).rejects.toThrow(USED_LINK);
  });

  it("refuses a token that was reset", async () => {
    const fresh = await regenerateClaimToken(asha.id, p.id);
    await expect(claimPlaceholder(rahul.id, token())).rejects.toThrow(USED_LINK);
    await expect(claimPlaceholder(rahul.id, fresh)).resolves.toEqual({ groupId: g.id });
  });

  it("refuses the token of a placeholder who was removed", async () => {
    await removeMember(asha.id, p.id);
    await expect(claimPlaceholder(rahul.id, token())).rejects.toThrow(USED_LINK);
  });

  it("refuses an archived group", async () => {
    await archive();
    await expect(claimPlaceholder(rahul.id, token())).rejects.toThrow(ARCHIVED);
    expect(await memberRow(p.id)).toMatchObject({ userId: null, claimToken: p.claimToken });
  });

  it("refuses a different email", async () => {
    const other = await createUser({ email: "someone.else@example.test" });
    await expect(claimPlaceholder(other.id, token())).rejects.toThrow("This invite was sent to a different email address.");
    expect(await memberRow(p.id)).toMatchObject({ userId: null, claimToken: p.claimToken });
  });

  it("lets anyone outside the group claim a placeholder that has no email", async () => {
    const open = await addPlaceholder(asha.id, g.id, { displayName: "Open" });
    const other = await createUser();
    await expect(claimPlaceholder(other.id, open.claimToken!)).resolves.toEqual({ groupId: g.id });
  });

  it("refuses someone already in the group, and keeps the link alive", async () => {
    const { user: ravi } = await memberWith("MEMBER", { email: "RAHUL@EXAMPLE.TEST" });
    await expect(claimPlaceholder(ravi.id, token())).rejects.toThrow("You're already in this group.");
    expect(await memberRow(p.id)).toMatchObject({ userId: null, claimToken: p.claimToken });
  });

  it("refuses someone who left and points them at the invite link", async () => {
    await addMember(g.id, { userId: rahul.id, leftAt: new Date() });
    await expect(claimPlaceholder(rahul.id, token())).rejects.toThrow(
      "You were in this group before. Use the group's invite link to rejoin.",
    );
    expect(await memberRow(p.id)).toMatchObject({ userId: null });
  });

  it("can't give one person two rows when they claim two placeholders at once", async () => {
    const second = await addPlaceholder(asha.id, g.id, { displayName: "Rahul again" });
    const results = await Promise.allSettled([claimPlaceholder(rahul.id, token()), claimPlaceholder(rahul.id, second.claimToken!)]);
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: rahul.id } })).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(UserError);
    expect(loser.reason).toHaveProperty("message", "You're already in this group.");
  });
});

describe("regenerateClaimToken", () => {
  it("replaces a placeholder's token, so the old link stops working", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    const fresh = await regenerateClaimToken(asha.id, p.id);
    expect(fresh).toHaveLength(32);
    expect(fresh).not.toBe(p.claimToken);
    expect((await memberRow(p.id)).claimToken).toBe(fresh);
  });

  it("is for admins only", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    const { user: admin } = await memberWith("ADMIN");
    const { user: ravi } = await memberWith("MEMBER");
    await expect(regenerateClaimToken(admin.id, p.id)).resolves.toHaveLength(32);
    await expect(regenerateClaimToken(ravi.id, p.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses people who have joined, and never gives them a token", async () => {
    const { member } = await memberWith("MEMBER");
    await expect(regenerateClaimToken(asha.id, member.id)).rejects.toBeInstanceOf(UserError);
    expect((await memberRow(member.id)).claimToken).toBeNull();
  });

  it("refuses an archived group", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await archive();
    await expect(regenerateClaimToken(asha.id, p.id)).rejects.toThrow(ARCHIVED);
  });

  it("forbids another group's admin, and an id that doesn't exist, the same way", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    const other = await createUser();
    await createGroup(other.id);
    await expect(regenerateClaimToken(other.id, p.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(regenerateClaimToken(asha.id, "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("removeMember", () => {
  it("lets an admin remove a member, keeping the row", async () => {
    const { user: admin } = await memberWith("ADMIN");
    const { member } = await memberWith("MEMBER");
    await removeMember(admin.id, member.id);
    expect((await memberRow(member.id)).leftAt).not.toBeNull();
  });

  it("can remove a placeholder", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await removeMember(asha.id, p.id);
    expect((await memberRow(p.id)).leftAt).not.toBeNull();
  });

  it("the owner cannot be removed", async () => {
    const { user: admin } = await memberWith("ADMIN");
    const owner = await ownerRow();
    await expect(removeMember(admin.id, owner.id)).rejects.toThrow("The owner can't be removed.");
    await expect(removeMember(asha.id, owner.id)).rejects.toThrow("The owner can't be removed.");
    expect((await ownerRow()).leftAt).toBeNull();
  });

  it("an admin cannot remove another admin, but the owner can", async () => {
    const { user: a1 } = await memberWith("ADMIN");
    const { member: a2 } = await memberWith("ADMIN");
    await expect(removeMember(a1.id, a2.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await memberRow(a2.id)).leftAt).toBeNull();
    await removeMember(asha.id, a2.id);
    expect((await memberRow(a2.id)).leftAt).not.toBeNull();
  });

  it("is for admins only", async () => {
    const { user: ravi } = await memberWith("MEMBER");
    const { member } = await memberWith("MEMBER");
    await expect(removeMember(ravi.id, member.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await memberRow(member.id)).leftAt).toBeNull();
  });

  it("refuses an archived group", async () => {
    const { member } = await memberWith("MEMBER");
    await archive();
    await expect(removeMember(asha.id, member.id)).rejects.toThrow(ARCHIVED);
  });

  it("forbids reaching into another group", async () => {
    const other = await createUser();
    await createGroup(other.id);
    const { member } = await memberWith("MEMBER");
    await expect(removeMember(other.id, member.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(asha.id, "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses someone who has already left", async () => {
    const { member } = await memberWith("MEMBER");
    await removeMember(asha.id, member.id);
    const before = (await memberRow(member.id)).leftAt;
    await expect(removeMember(asha.id, member.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await memberRow(member.id)).leftAt).toEqual(before);
  });
});

describe("setMemberRole", () => {
  it("lets the owner promote a member and demote an admin", async () => {
    const { member } = await memberWith("MEMBER");
    await setMemberRole(asha.id, member.id, "ADMIN");
    expect((await memberRow(member.id)).role).toBe("ADMIN");
    await setMemberRole(asha.id, member.id, "MEMBER");
    expect((await memberRow(member.id)).role).toBe("MEMBER");
  });

  it("is for the owner only", async () => {
    const { user: admin } = await memberWith("ADMIN");
    const { member } = await memberWith("MEMBER");
    await expect(setMemberRole(admin.id, member.id, "ADMIN")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await memberRow(member.id)).role).toBe("MEMBER");
  });

  it("can't change the owner's role", async () => {
    await expect(setMemberRole(asha.id, (await ownerRow()).id, "MEMBER")).rejects.toBeInstanceOf(UserError);
    expect((await ownerRow()).role).toBe("OWNER");
  });

  it("can't make a placeholder an admin", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await expect(setMemberRole(asha.id, p.id, "ADMIN")).rejects.toBeInstanceOf(UserError);
    expect((await memberRow(p.id)).role).toBe("MEMBER");
  });

  it("refuses someone who has left, and an archived group", async () => {
    const { member } = await memberWith("MEMBER");
    await archive();
    await expect(setMemberRole(asha.id, member.id, "ADMIN")).rejects.toThrow(ARCHIVED);
    await db.group.update({ where: { id: g.id }, data: { archivedAt: null } });
    await removeMember(asha.id, member.id);
    await expect(setMemberRole(asha.id, member.id, "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("transferOwnership", () => {
  it("transferring ownership swaps roles atomically", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    await transferOwnership(asha.id, member.id);
    expect((await rowFor(ravi.id)).role).toBe("OWNER");
    expect((await ownerRow()).role).toBe("ADMIN");
    expect(await activeOwners()).toBe(1);
  });

  it("is for the owner only", async () => {
    const { user: admin } = await memberWith("ADMIN");
    const { member } = await memberWith("MEMBER");
    await expect(transferOwnership(admin.id, member.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await activeOwners()).toBe(1);
    expect((await ownerRow()).role).toBe("OWNER");
  });

  it("can't hand the group to a placeholder or someone who left", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    await expect(transferOwnership(asha.id, p.id)).rejects.toBeInstanceOf(UserError);
    const { member } = await memberWith("MEMBER");
    await removeMember(asha.id, member.id);
    await expect(transferOwnership(asha.id, member.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await ownerRow()).role).toBe("OWNER");
    expect(await activeOwners()).toBe(1);
  });

  it("refuses an archived group", async () => {
    const { member } = await memberWith("MEMBER");
    await archive();
    await expect(transferOwnership(asha.id, member.id)).rejects.toThrow(ARCHIVED);
  });

  it("leaves one owner when the owner hands over to two people at once", async () => {
    const { member: m1 } = await memberWith("MEMBER");
    const { member: m2 } = await memberWith("MEMBER");
    const results = await Promise.allSettled([transferOwnership(asha.id, m1.id), transferOwnership(asha.id, m2.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await activeOwners()).toBe(1);
    expect((await ownerRow()).role).toBe("ADMIN");
  });

  it("never leaves the group ownerless when the new owner is removed or leaves at the same moment", async () => {
    for (let i = 0; i < 5; i++) {
      const owner = await createUser();
      const group = await createGroup(owner.id);
      const target = await createUser();
      const targetMember = await addMember(group.id, { userId: target.id, role: "MEMBER" });
      const racers =
        i % 2
          ? [transferOwnership(owner.id, targetMember.id), removeMember(owner.id, targetMember.id)]
          : [transferOwnership(owner.id, targetMember.id), leaveGroup(target.id, group.id)];
      await Promise.allSettled(racers);
      expect(await activeOwners(group.id)).toBe(1);
    }
  });

  it("never leaves the group ownerless when the new owner is demoted at the same moment", async () => {
    const { member } = await memberWith("ADMIN");
    await Promise.allSettled([transferOwnership(asha.id, member.id), setMemberRole(asha.id, member.id, "MEMBER")]);
    expect(await activeOwners()).toBe(1);
  });
});

describe("leaveGroup", () => {
  it("the owner cannot leave or be removed", async () => {
    const { user: adminUser } = await memberWith("ADMIN");
    const ownerMember = await ownerRow();
    await expect(leaveGroup(asha.id, g.id)).rejects.toThrow("Transfer ownership before leaving.");
    await expect(removeMember(adminUser.id, ownerMember.id)).rejects.toThrow("The owner can't be removed.");
    expect((await ownerRow()).leftAt).toBeNull();
  });

  it("lets a member leave, after which they lose access", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    await leaveGroup(ravi.id, g.id);
    expect((await memberRow(member.id)).leftAt).not.toBeNull();
    await expect(leaveGroup(ravi.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a former owner leave once ownership has moved", async () => {
    const { member } = await memberWith("MEMBER");
    await transferOwnership(asha.id, member.id);
    await leaveGroup(asha.id, g.id);
    expect((await ownerRow()).leftAt).not.toBeNull();
    expect(await activeOwners()).toBe(1);
  });

  it("lets someone leave an archived group", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    await archive();
    await leaveGroup(ravi.id, g.id);
    expect((await memberRow(member.id)).leftAt).not.toBeNull();
  });

  it("forbids an outsider", async () => {
    const stranger = await createUser();
    await expect(leaveGroup(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a change landing between the permission check and the write", () => {
  /** What a completed ownership transfer from Asha to `memberId` leaves behind. */
  const transferBehindTheirBack = (memberId: string) => async () => {
    await db.groupMember.update({ where: { id: memberId }, data: { role: "OWNER" } });
    await db.groupMember.update({ where: { id: (await ownerRow()).id }, data: { role: "ADMIN" } });
  };
  const stale = "That changed while you were doing it. Please try again.";

  it("can't remove someone who just became the owner", async () => {
    const { member } = await memberWith("MEMBER");
    authz.afterCheck = transferBehindTheirBack(member.id);
    await expect(removeMember(asha.id, member.id)).rejects.toThrow(stale);
    expect((await memberRow(member.id)).leftAt).toBeNull();
    expect(await activeOwners()).toBe(1);
  });

  it("can't leave after just becoming the owner", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    authz.afterCheck = transferBehindTheirBack(member.id);
    await expect(leaveGroup(ravi.id, g.id)).rejects.toThrow(stale);
    expect((await memberRow(member.id)).leftAt).toBeNull();
    expect(await activeOwners()).toBe(1);
  });

  it("can't demote someone who just became the owner", async () => {
    const { member } = await memberWith("ADMIN");
    authz.afterCheck = transferBehindTheirBack(member.id);
    await expect(setMemberRole(asha.id, member.id, "MEMBER")).rejects.toThrow(stale);
    expect((await memberRow(member.id)).role).toBe("OWNER");
  });

  it("rolls the owner's demotion back when the new owner left in the meantime", async () => {
    const { member } = await memberWith("MEMBER");
    authz.afterCheck = () => db.groupMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
    await expect(transferOwnership(asha.id, member.id)).rejects.toThrow(stale);
    expect((await ownerRow()).role).toBe("OWNER");
    expect(await activeOwners()).toBe(1);
  });

  it("won't hand a claim link to someone who joined in the meantime", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    const rahul = await createUser();
    authz.afterCheck = () => db.groupMember.update({ where: { id: p.id }, data: { userId: rahul.id, claimToken: null } });
    await expect(regenerateClaimToken(asha.id, p.id)).rejects.toBeInstanceOf(UserError);
    expect((await memberRow(p.id)).claimToken).toBeNull();
  });
});

describe("actions", () => {
  it("joinByInviteCodeAction returns the group and refreshes its pages", async () => {
    const ravi = await createUser();
    signInAs(ravi);
    expect(await joinByInviteCodeAction({ code: g.inviteCode })).toEqual({ ok: true, data: { groupId: g.id } });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
  });

  it("shows the invite errors as they are", async () => {
    signInAs(await createUser());
    expect(await joinByInviteCodeAction({ code: "nope" })).toEqual({ ok: false, error: "This invite link is invalid or has been reset." });
    await archive();
    expect(await joinByInviteCodeAction({ code: g.inviteCode })).toEqual({ ok: false, error: ARCHIVED });
  });

  it("addPlaceholderAction cleans the form input and refreshes the group", async () => {
    signInAs(asha);
    const res = await addPlaceholderAction({ groupId: g.id, displayName: " Rahul ", email: "Rahul@Example.test" });
    expect(res).toMatchObject({ ok: true, data: { displayName: "Rahul", email: "rahul@example.test" } });
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
    expect(await addPlaceholderAction({ groupId: g.id, displayName: "Priya", email: "" })).toMatchObject({ ok: true, data: { email: null } });
    expect(await addPlaceholderAction({ groupId: g.id, displayName: "Bad", email: "nope" })).toMatchObject({ ok: false });
    expect(await addPlaceholderAction({ groupId: "", displayName: "Bad" })).toMatchObject({ ok: false });
  });

  it("addPlaceholderAction tells the person about the invite limit, and still refreshes since the person was added", async () => {
    await db.emailLog.createMany({
      data: Array.from({ length: 20 }, () => ({ kind: "invite", toEmail: "someone@example.test", senderUserId: asha.id })),
    });
    signInAs(asha);
    expect(await addPlaceholderAction({ groupId: g.id, displayName: "Rahul", email: "rahul@example.test" })).toEqual({
      ok: false,
      error: "You've sent a lot of invites. Try again in an hour.",
    });
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: null } })).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
  });

  it("claimPlaceholderAction claims and refreshes", async () => {
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    const rahul = await createUser();
    signInAs(rahul);
    expect(await claimPlaceholderAction({ token: p.claimToken! })).toEqual({ ok: true, data: { groupId: g.id } });
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
    expect(await claimPlaceholderAction({ token: p.claimToken! })).toEqual({ ok: false, error: USED_LINK });
    expect(await claimPlaceholderAction({ token: "" })).toMatchObject({ ok: false });
  });

  it("member actions refuse a bad role or empty ids, and deny non-admins", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    signInAs(asha);
    expect(await setMemberRoleAction({ groupId: g.id, memberId: member.id, role: "OWNER" as "ADMIN" })).toMatchObject({ ok: false });
    expect(await removeMemberAction({ groupId: g.id, memberId: "" })).toMatchObject({ ok: false });
    expect(await rotateInviteCodeAction({ groupId: "" })).toMatchObject({ ok: false });
    expect((await memberRow(member.id)).role).toBe("MEMBER");

    signInAs(ravi);
    const denied = { ok: false, error: "You don't have access to this group." };
    expect(await removeMemberAction({ groupId: g.id, memberId: (await ownerRow()).id })).toEqual(denied);
    expect(await rotateInviteCodeAction({ groupId: g.id })).toEqual(denied);
    expect(await transferOwnershipAction({ groupId: g.id, memberId: member.id })).toEqual(denied);
  });

  it("run the admin and owner operations and refresh the dashboard and group", async () => {
    const { user: ravi, member } = await memberWith("MEMBER");
    const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul" });
    signInAs(asha);

    expect(await setMemberRoleAction({ groupId: g.id, memberId: member.id, role: "ADMIN" })).toEqual({ ok: true, data: undefined });
    const rotated = await rotateInviteCodeAction({ groupId: g.id });
    expect(rotated).toMatchObject({ ok: true });
    const fresh = await regenerateClaimTokenAction({ groupId: g.id, memberId: p.id });
    expect(fresh).toMatchObject({ ok: true });
    expect(await removeMemberAction({ groupId: g.id, memberId: p.id })).toEqual({ ok: true, data: undefined });
    expect(await transferOwnershipAction({ groupId: g.id, memberId: member.id })).toEqual({ ok: true, data: undefined });
    expect((await rowFor(ravi.id)).role).toBe("OWNER");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);

    expect(await leaveGroupAction({ groupId: g.id })).toEqual({ ok: true, data: undefined });
    expect(await leaveGroupAction({ groupId: g.id })).toEqual({ ok: false, error: "You don't have access to this group." });
  });
});
