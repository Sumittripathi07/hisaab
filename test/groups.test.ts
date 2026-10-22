import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { groupInputSchema, type GroupInput } from "@/lib/validation";
import { archiveGroupAction, createGroupAction, unarchiveGroupAction, updateGroupAction } from "@/server/actions/groups";
import { ForbiddenError } from "@/server/errors";
import { archiveGroup, createGroup, getGroupDetail, listGroupsForUser, unarchiveGroup, updateGroup } from "@/server/groups";
import type { SessionUser } from "@/server/session";
import type { User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup as makeGroup, createUser } from "./factories";

// The action tests sign in as whoever `session.user` is; next/cache needs a request, so it's stubbed.
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(resetDb);
beforeEach(() => vi.mocked(revalidatePath).mockClear());

const input = (overrides: Partial<GroupInput> = {}): GroupInput => ({
  name: "Goa Trip",
  emoji: "🏖️",
  color: "sky",
  type: "TRIP",
  baseCurrency: "INR",
  simplifyDebts: true,
  ...overrides,
});

/** Run the input through the schema, as defineAction does, so tests can write the trimmed-name case like a form would. */
const parsed = (raw: Partial<Record<keyof GroupInput, unknown>>) => groupInputSchema.parse({ ...input(), ...raw });

let asha: User;
beforeEach(async () => {
  asha = await createUser({ name: "Asha" });
});

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

describe("createGroup", () => {
  it("creates the group with the creator as OWNER and an 11-char invite code", async () => {
    const g = await createGroup(asha.id, parsed({ name: "  Goa Trip " }));
    expect(g.name).toBe("Goa Trip");
    expect(g.inviteCode).toHaveLength(11);
    expect(g).toMatchObject({ createdById: asha.id, emoji: "🏖️", color: "sky", type: "TRIP", baseCurrency: "INR", simplifyDebts: true });
    const m = await db.groupMember.findFirstOrThrow({ where: { groupId: g.id } });
    expect(m).toMatchObject({ userId: asha.id, role: "OWNER", displayName: "Asha", leftAt: null });
  });

  it("gives every group its own invite code", async () => {
    const [a, b] = [await createGroup(asha.id, input()), await createGroup(asha.id, input())];
    expect(a.inviteCode).not.toBe(b.inviteCode);
  });

  it("leaves no group behind when the creator doesn't exist", async () => {
    await expect(createGroup("nobody", input())).rejects.toThrow();
    expect(await db.group.count()).toBe(0);
  });
});

describe("updateGroup", () => {
  it("lets only admins update a group", async () => {
    const [member, admin, stranger] = [await createUser(), await createUser(), await createUser()];
    const g = await makeGroup(asha.id);
    await addMember(g.id, { userId: member.id, role: "MEMBER" });
    await addMember(g.id, { userId: admin.id, role: "ADMIN" });

    await expect(updateGroup(member.id, g.id, input({ name: "Hacked" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateGroup(stranger.id, g.id, input({ name: "Hacked" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).name).toBe(g.name);

    const updated = await updateGroup(admin.id, g.id, input({ name: "Goa 2027", color: "rose", simplifyDebts: false }));
    expect(updated).toMatchObject({ id: g.id, name: "Goa 2027", color: "rose", simplifyDebts: false });
    expect(await db.group.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ name: "Goa 2027", inviteCode: g.inviteCode });
    await expect(updateGroup(asha.id, g.id, input({ name: "Owner edit" }))).resolves.toMatchObject({ name: "Owner edit" });
  });

  it("refuses to edit an archived group", async () => {
    const g = await makeGroup(asha.id, { archivedAt: new Date() });
    await expect(updateGroup(asha.id, g.id, input())).rejects.toThrow("This group is archived.");
  });
});

describe("archiveGroup / unarchiveGroup", () => {
  it("moves archived groups to the archived list and back", async () => {
    const g = await makeGroup(asha.id);
    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([g.id]);

    await archiveGroup(asha.id, g.id);
    let lists = await listGroupsForUser(asha.id);
    expect(lists.active).toEqual([]);
    expect(lists.archived.map((x) => x.id)).toEqual([g.id]);

    await unarchiveGroup(asha.id, g.id);
    lists = await listGroupsForUser(asha.id);
    expect(lists.active.map((x) => x.id)).toEqual([g.id]);
    expect(lists.archived).toEqual([]);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).archivedAt).toBeNull();
  });

  it("lets only admins archive or unarchive", async () => {
    const [member, admin] = [await createUser(), await createUser()];
    const g = await makeGroup(asha.id);
    await addMember(g.id, { userId: member.id });
    await addMember(g.id, { userId: admin.id, role: "ADMIN" });

    await expect(archiveGroup(member.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    await archiveGroup(admin.id, g.id);
    await expect(unarchiveGroup(member.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).archivedAt).toBeInstanceOf(Date);
    await unarchiveGroup(admin.id, g.id);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).archivedAt).toBeNull();
  });

  it("refuses to archive a group that is already archived", async () => {
    const g = await makeGroup(asha.id, { archivedAt: new Date() });
    await expect(archiveGroup(asha.id, g.id)).rejects.toThrow("This group is archived.");
  });
});

describe("listGroupsForUser", () => {
  it("leaves out groups the user has left", async () => {
    const bina = await createUser();
    const [stayed, left, leftArchived] = [
      await makeGroup(asha.id),
      await makeGroup(asha.id),
      await makeGroup(asha.id, { archivedAt: new Date() }),
    ];
    for (const g of [stayed, left, leftArchived]) await addMember(g.id, { userId: bina.id });
    await db.groupMember.updateMany({ where: { userId: bina.id, groupId: { in: [left.id, leftArchived.id] } }, data: { leftAt: new Date() } });

    const lists = await listGroupsForUser(bina.id);
    expect(lists.active.map((x) => x.id)).toEqual([stayed.id]);
    expect(lists.archived).toEqual([]);
  });

  it("leaves out DIRECT groups and groups the user never joined", async () => {
    const bina = await createUser();
    await makeGroup(asha.id, { type: "DIRECT" });
    await makeGroup(bina.id);
    const mine = await makeGroup(asha.id, { type: "HOME" });
    const lists = await listGroupsForUser(asha.id);
    expect(lists.active.map((x) => x.id)).toEqual([mine.id]);
  });

  it("orders each list by most recently updated", async () => {
    const [a, b, c] = [await makeGroup(asha.id), await makeGroup(asha.id), await makeGroup(asha.id)];
    await db.group.update({ where: { id: a.id }, data: { updatedAt: new Date("2026-01-03") } });
    await db.group.update({ where: { id: b.id }, data: { updatedAt: new Date("2026-01-01") } });
    await db.group.update({ where: { id: c.id }, data: { updatedAt: new Date("2026-01-02") } });
    expect((await listGroupsForUser(asha.id)).active.map((x) => x.id)).toEqual([a.id, c.id, b.id]);
  });

  it("returns the card fields, counting only active members and previewing at most 5", async () => {
    const g = await makeGroup(asha.id, { name: "Flat 4B", emoji: "🏠", color: "teal", type: "HOME", baseCurrency: "USD" });
    const withPhoto = await createUser({ name: "Photo", image: "https://example.test/p.jpg" });
    await addMember(g.id, { userId: withPhoto.id });
    await addMember(g.id, { displayName: "Ghost" });
    await addMember(g.id, { userId: (await createUser()).id, leftAt: new Date() });
    for (let i = 0; i < 4; i++) await addMember(g.id, { displayName: `Extra ${i}` });

    const [item] = (await listGroupsForUser(asha.id)).active;
    expect(item).toMatchObject({ id: g.id, name: "Flat 4B", emoji: "🏠", color: "teal", type: "HOME", baseCurrency: "USD", memberCount: 7 });
    expect(Object.keys(item).sort()).toEqual(
      ["baseCurrency", "color", "emoji", "id", "memberCount", "name", "previewMembers", "type"].sort(),
    );
    expect(item.previewMembers).toHaveLength(5);
    expect(item.previewMembers).toContainEqual({ displayName: "Asha", image: null });
    expect(item.previewMembers).toContainEqual({ displayName: "Photo", image: "https://example.test/p.jpg" });
    expect(item.previewMembers).toContainEqual({ displayName: "Ghost", image: null });
  });

  it("previews nobody who has left", async () => {
    const g = await makeGroup(asha.id);
    await addMember(g.id, { userId: (await createUser({ name: "Gone" })).id, leftAt: new Date() });
    const [item] = (await listGroupsForUser(asha.id)).active;
    expect(item.memberCount).toBe(1);
    expect(item.previewMembers.map((p) => p.displayName)).toEqual(["Asha"]);
  });
});

describe("getGroupDetail", () => {
  it("lists only active members, owner first, with placeholder flag", async () => {
    const g = await makeGroup(asha.id);
    const [member, admin, gone] = [await createUser({ image: "https://example.test/m.jpg" }), await createUser(), await createUser()];
    // The admin joined last of the three, but role order still wins; the member beats the placeholder on joinedAt.
    const rows = [
      await addMember(g.id, { userId: member.id, role: "MEMBER" }),
      await addMember(g.id, { displayName: "Ghost", email: "ghost@example.test" }),
      await addMember(g.id, { userId: admin.id, role: "ADMIN" }),
      await addMember(g.id, { userId: gone.id, leftAt: new Date() }),
    ];
    for (const [i, row] of rows.entries()) {
      await db.groupMember.update({ where: { id: row.id }, data: { joinedAt: new Date(`2030-01-0${i + 1}`) } });
    }

    const detail = await getGroupDetail(member.id, g.id);
    expect(detail.group.id).toBe(g.id);
    expect(detail.me).toMatchObject({ userId: member.id, role: "MEMBER" });
    expect(detail.members.map((m) => [m.displayName, m.role])).toEqual([
      ["Asha", "OWNER"],
      [admin.name, "ADMIN"],
      [member.name, "MEMBER"],
      ["Ghost", "MEMBER"],
    ]);
    expect(detail.members.map((m) => m.isPlaceholder)).toEqual([false, false, false, true]);
    expect(detail.members.map((m) => m.image)).toEqual([null, null, "https://example.test/m.jpg", null]);
    expect(detail.members[3]).toMatchObject({ userId: null, email: "ghost@example.test" });
    expect(detail.members[0]).not.toHaveProperty("user");
  });

  it("orders members of the same role by when they joined", async () => {
    const g = await makeGroup(asha.id);
    const [late, early] = [await createUser({ name: "Late" }), await createUser({ name: "Early" })];
    await addMember(g.id, { userId: late.id });
    await addMember(g.id, { userId: early.id });
    await db.groupMember.updateMany({ where: { userId: late.id }, data: { joinedAt: new Date("2030-01-01") } });
    await db.groupMember.updateMany({ where: { userId: early.id }, data: { joinedAt: new Date("2029-01-01") } });
    const { members } = await getGroupDetail(asha.id, g.id);
    expect(members.map((m) => m.displayName)).toEqual(["Asha", "Early", "Late"]);
  });

  it("forbids non-members and people who left", async () => {
    const [stranger, gone] = [await createUser(), await createUser()];
    const g = await makeGroup(asha.id);
    await addMember(g.id, { userId: gone.id, leftAt: new Date() });
    await expect(getGroupDetail(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getGroupDetail(gone.id, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getGroupDetail(asha.id, "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("still reads an archived group", async () => {
    const g = await makeGroup(asha.id, { archivedAt: new Date() });
    await expect(getGroupDetail(asha.id, g.id)).resolves.toMatchObject({ group: { id: g.id } });
  });
});

describe("group actions", () => {
  beforeEach(() => signInAs(asha));

  it("creates a group and refreshes the dashboard", async () => {
    const res = await createGroupAction({ name: " Goa Trip ", type: "TRIP", baseCurrency: "inr" });
    expect(res).toMatchObject({ ok: true, data: { name: "Goa Trip", emoji: "👥", color: "emerald", baseCurrency: "INR", simplifyDebts: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("reports a bad group as a message, not an exception", async () => {
    expect(await createGroupAction({ name: "  ", type: "TRIP", baseCurrency: "INR" })).toEqual({ ok: false, error: "Enter a group name" });
    expect(await createGroupAction({ name: "x", type: "DIRECT" as "TRIP", baseCurrency: "INR" })).toMatchObject({ ok: false });
    expect(await db.group.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates a group by id and refreshes its page", async () => {
    const g = await makeGroup(asha.id);
    const res = await updateGroupAction({ groupId: g.id, name: "Renamed", type: "EVENT", baseCurrency: "USD" });
    expect(res).toMatchObject({ ok: true, data: { id: g.id, name: "Renamed", type: "EVENT", baseCurrency: "USD" } });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
  });

  it("hands a non-admin a safe message and changes nothing", async () => {
    const owner = await createUser();
    const g = await makeGroup(owner.id);
    await addMember(g.id, { userId: asha.id });
    const denied = { ok: false, error: "You don't have access to this group." };
    expect(await updateGroupAction({ groupId: g.id, name: "Mine now", type: "OTHER", baseCurrency: "INR" })).toEqual(denied);
    expect(await archiveGroupAction({ groupId: g.id })).toEqual(denied);
    expect(await db.group.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ name: g.name, archivedAt: null });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("archives and unarchives by id", async () => {
    const g = await makeGroup(asha.id);
    expect(await archiveGroupAction({ groupId: g.id })).toEqual({ ok: true, data: undefined });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).archivedAt).toBeInstanceOf(Date);
    expect(await archiveGroupAction({ groupId: g.id })).toEqual({ ok: false, error: "This group is archived." });
    expect(await unarchiveGroupAction({ groupId: g.id })).toEqual({ ok: true, data: undefined });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).archivedAt).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${g.id}`);
  });

  it("needs a group id", async () => {
    expect(await archiveGroupAction({ groupId: "" })).toMatchObject({ ok: false });
  });
});
