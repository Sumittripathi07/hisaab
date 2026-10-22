import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as groupActions from "@/server/actions/groups";
import * as memberActions from "@/server/actions/members";
import * as profileActions from "@/server/actions/profile";
import type { ActionResult } from "@/server/action";
import type { SessionUser } from "@/server/session";
import type { User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createGroup, createUser } from "./factories";
import { clearOutbox, readOutbox } from "./outbox";

// The spec's authz check: someone outside a group gets "no access" from every server action, and nothing changes.
// Every action is signed in as `session.user`; next/cache needs a request, so it's stubbed.
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = { ...groupActions, ...memberActions, ...profileActions };
type ActionName = keyof typeof actions;

const FORBIDDEN = { ok: false, error: "You don't have access to this group." };
// Code- and token-based actions can't name a group, so a guess just isn't found.
const BAD_INVITE = { ok: false, error: "This invite link is invalid or has been reset." };
const BAD_CLAIM = { ok: false, error: "This link was already used or has been reset." };
// Actions on the caller's own things: they succeed, and must still leave the group alone.
const OWN = expect.objectContaining({ ok: true });

/** The group under attack: an owner, an admin, a member and a placeholder with a live claim link. */
type Target = { groupId: string; inviteCode: string; memberIds: string[] };
type Row = { expected: unknown; calls: (t: Target) => (() => Promise<ActionResult<unknown>>)[] };
const once = (run: () => Promise<ActionResult<unknown>>) => [run];
/** One call per member of the group, so no row is spared. */
const perMember = (t: Target, run: (memberId: string) => Promise<ActionResult<unknown>>) => t.memberIds.map((id) => () => run(id));

const table: Record<ActionName, Row> = {
  createGroupAction: { expected: OWN, calls: () => once(() => actions.createGroupAction({ name: "Mine", type: "OTHER", baseCurrency: "INR" })) },
  updateGroupAction: {
    expected: FORBIDDEN,
    calls: ({ groupId }) => once(() => actions.updateGroupAction({ groupId, name: "Taken over", type: "TRIP", baseCurrency: "USD" })),
  },
  archiveGroupAction: { expected: FORBIDDEN, calls: ({ groupId }) => once(() => actions.archiveGroupAction({ groupId })) },
  unarchiveGroupAction: { expected: FORBIDDEN, calls: ({ groupId }) => once(() => actions.unarchiveGroupAction({ groupId })) },

  addPlaceholderAction: {
    expected: FORBIDDEN,
    calls: ({ groupId }) => once(() => actions.addPlaceholderAction({ groupId, displayName: "Mallory", email: "victim@example.test" })),
  },
  joinByInviteCodeAction: { expected: BAD_INVITE, calls: ({ inviteCode }) => once(() => actions.joinByInviteCodeAction({ code: `${inviteCode}x` })) },
  rotateInviteCodeAction: { expected: FORBIDDEN, calls: ({ groupId }) => once(() => actions.rotateInviteCodeAction({ groupId })) },
  claimPlaceholderAction: { expected: BAD_CLAIM, calls: () => once(() => actions.claimPlaceholderAction({ token: "not-a-real-claim-token" })) },
  regenerateClaimTokenAction: {
    expected: FORBIDDEN,
    calls: (t) => perMember(t, (memberId) => actions.regenerateClaimTokenAction({ groupId: t.groupId, memberId })),
  },
  removeMemberAction: { expected: FORBIDDEN, calls: (t) => perMember(t, (memberId) => actions.removeMemberAction({ groupId: t.groupId, memberId })) },
  setMemberRoleAction: {
    expected: FORBIDDEN,
    calls: (t) => perMember(t, (memberId) => actions.setMemberRoleAction({ groupId: t.groupId, memberId, role: "ADMIN" })),
  },
  transferOwnershipAction: {
    expected: FORBIDDEN,
    calls: (t) => perMember(t, (memberId) => actions.transferOwnershipAction({ groupId: t.groupId, memberId })),
  },
  leaveGroupAction: { expected: FORBIDDEN, calls: ({ groupId }) => once(() => actions.leaveGroupAction({ groupId })) },

  // Under their current name: a new one would rightly follow them onto their own old row in a group they left. A save
  // that reached anyone else's row would still show, as "Mallory" in place of their name.
  completeOnboardingAction: {
    expected: OWN,
    calls: () => once(() => actions.completeOnboardingAction({ name: "Mallory", defaultCurrency: "USD", upiId: "", timezone: "UTC" })),
  },
  updateProfileAction: {
    expected: OWN,
    calls: () => once(() => actions.updateProfileAction({ name: "Mallory", defaultCurrency: "EUR", upiId: "mallory@okaxis", timezone: "UTC" })),
  },
};

let outsider: User;
let target: Target;

beforeEach(async () => {
  await resetDb();
  await clearOutbox();
  const [owner, admin, member] = [await createUser(), await createUser(), await createUser()];
  const g = await createGroup(owner.id);
  const rows = [
    await addMember(g.id, { userId: admin.id, role: "ADMIN" }),
    await addMember(g.id, { userId: member.id }),
    await addMember(g.id, { displayName: "Rahul", email: "rahul@example.test", claimToken: "live-claim-token" }),
  ];
  const ownerRow = await db.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId: g.id, userId: owner.id } } });
  target = { groupId: g.id, inviteCode: g.inviteCode, memberIds: [ownerRow.id, ...rows.map((r) => r.id)] };

  // The outsider owns a group of their own, so a role there must not count here.
  outsider = await createUser({ name: "Mallory" });
  await createGroup(outsider.id);
  session.user = { ...outsider, defaultCurrency: outsider.defaultCurrency, upiId: outsider.upiId, image: outsider.image };
});

/** Everything an outsider could touch: the group, its members, everyone else's account, and email. */
const snapshot = async () => ({
  group: await db.group.findUniqueOrThrow({ where: { id: target.groupId } }),
  members: await db.groupMember.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  users: await db.user.findMany({ where: { id: { not: outsider.id } }, orderBy: { id: "asc" } }),
  emails: await readOutbox(),
});

it("has a row for every exported action, in every actions file", () => {
  // A new file of actions must be imported above, and each new action needs a row in the table.
  expect(readdirSync(fileURLToPath(new URL("../src/server/actions", import.meta.url))).sort()).toEqual([
    "groups.ts",
    "members.ts",
    "profile.ts",
  ]);
  expect(Object.keys(table).sort()).toEqual(Object.keys(actions).sort());
});

describe.each([
  ["a stranger", async () => {}],
  // Someone who left (even a former admin) is as much an outsider as someone who never joined.
  ["someone who left, once an admin", async () => void (await addMember(target.groupId, { userId: outsider.id, role: "ADMIN", leftAt: new Date() }))],
])("as %s", (_, setUp) => {
  it.each(Object.keys(table) as ActionName[])("%s gets no access and changes nothing", async (name) => {
    await setUp();
    const before = await snapshot();
    const { expected, calls } = table[name];
    for (const call of calls(target)) expect(await call()).toEqual(expected);
    expect(await snapshot()).toEqual(before);
  });
});
