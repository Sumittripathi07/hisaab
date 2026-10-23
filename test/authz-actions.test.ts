import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { ExpenseFormValues } from "@/lib/validation";
import * as commentActions from "@/server/actions/comments";
import * as expenseActions from "@/server/actions/expenses";
import * as groupActions from "@/server/actions/groups";
import * as memberActions from "@/server/actions/members";
import * as profileActions from "@/server/actions/profile";
import * as settlementActions from "@/server/actions/settlements";
import type { ActionResult } from "@/server/action";
import type { SessionUser } from "@/server/session";
import type { User } from "@/generated/prisma/client";
import { resetDb } from "./db";
import { addMember, createCommentRow, createExpenseRow, createGroup, createSettlementRow, createUser } from "./factories";
import { clearOutbox, readOutbox } from "./outbox";

// The spec's authz check: someone outside a group gets "no access" from every server action, and nothing changes.
// Every action is signed in as `session.user`; next/cache needs a request, so it's stubbed.
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/server/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = { ...commentActions, ...expenseActions, ...groupActions, ...memberActions, ...profileActions, ...settlementActions };
type ActionName = keyof typeof actions;

const FORBIDDEN = { ok: false, error: "You don't have access to this group." };
// Code- and token-based actions can't name a group, so a guess just isn't found.
const BAD_INVITE = { ok: false, error: "This invite link is invalid or has been reset." };
const BAD_CLAIM = { ok: false, error: "This link was already used or has been reset." };
// Actions on the caller's own things: they succeed, and must still leave the group alone.
const OWN = expect.objectContaining({ ok: true });

/** The group under attack: an owner, an admin, a member and a placeholder with a live claim link. */
type Target = { groupId: string; inviteCode: string; memberIds: string[]; expenseId: string; settlementId: string; commentId: string };
type Row = { expected: unknown; calls: (t: Target) => (() => Promise<ActionResult<unknown>>)[] };
const once = (run: () => Promise<ActionResult<unknown>>) => [run];
/** One call per member of the group, so no row is spared. */
const perMember = (t: Target, run: (memberId: string) => Promise<ActionResult<unknown>>) => t.memberIds.map((id) => () => run(id));

const expenseForm = (memberIds: string[]): ExpenseFormValues => ({
  description: "Taken over",
  amount: "300",
  category: "other",
  date: "2026-01-15",
  notes: "",
  payers: [{ memberId: memberIds[0], value: "300" }],
  split: { method: "EQUAL", memberIds },
});

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

  // A valid expense among the group's own members, so only membership can refuse it.
  createExpenseAction: {
    expected: FORBIDDEN,
    calls: ({ groupId, memberIds }) => once(() => actions.createExpenseAction({ groupId, ...expenseForm(memberIds) })),
  },
  updateExpenseAction: {
    expected: FORBIDDEN,
    calls: ({ expenseId, memberIds }) => once(() => actions.updateExpenseAction({ expenseId, version: 1, ...expenseForm(memberIds) })),
  },
  deleteExpenseAction: { expected: FORBIDDEN, calls: ({ expenseId }) => once(() => actions.deleteExpenseAction({ expenseId })) },
  restoreExpenseAction: { expected: FORBIDDEN, calls: ({ expenseId }) => once(() => actions.restoreExpenseAction({ expenseId })) },

  // A valid payment between the group's own members, so only membership can refuse it.
  recordSettlementAction: {
    expected: FORBIDDEN,
    calls: ({ groupId, memberIds }) =>
      once(() =>
        actions.recordSettlementAction({
          groupId,
          fromMemberId: memberIds[2],
          toMemberId: memberIds[0],
          amount: "300",
          method: "UPI",
          date: "2026-01-15",
          note: "",
        }),
      ),
  },
  updateSettlementAction: {
    expected: FORBIDDEN,
    calls: ({ settlementId }) =>
      once(() => actions.updateSettlementAction({ settlementId, amount: "1", method: "CASH", date: "2026-01-15", note: "Taken over" })),
  },
  deleteSettlementAction: { expected: FORBIDDEN, calls: ({ settlementId }) => once(() => actions.deleteSettlementAction({ settlementId })) },
  restoreSettlementAction: { expected: FORBIDDEN, calls: ({ settlementId }) => once(() => actions.restoreSettlementAction({ settlementId })) },
  disputeSettlementAction: { expected: FORBIDDEN, calls: ({ settlementId }) => once(() => actions.disputeSettlementAction({ settlementId })) },

  // On the group's own expense, so only membership can refuse it.
  addCommentAction: {
    expected: FORBIDDEN,
    calls: ({ expenseId }) => once(() => actions.addCommentAction({ target: { kind: "expense", id: expenseId }, body: "Taken over" })),
  },
  deleteCommentAction: { expected: FORBIDDEN, calls: ({ commentId }) => once(() => actions.deleteCommentAction({ commentId })) },

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
  const memberIds = [ownerRow.id, ...rows.map((r) => r.id)];
  const expense = await createExpenseRow(g.id, { createdByMemberId: ownerRow.id, payers: [[ownerRow.id, 300n]], shares: memberIds.map((id) => [id, 75n]) });
  const settlement = await createSettlementRow(g.id, { fromMemberId: memberIds[2], toMemberId: ownerRow.id, amount: 75n, createdByMemberId: ownerRow.id });
  const comment = await createCommentRow({ groupId: g.id, authorMemberId: ownerRow.id, expenseId: expense.id });
  target = { groupId: g.id, inviteCode: g.inviteCode, memberIds, expenseId: expense.id, settlementId: settlement.id, commentId: comment.id };

  // The outsider owns a group of their own, so a role there must not count here.
  outsider = await createUser({ name: "Mallory" });
  await createGroup(outsider.id);
  session.user = { ...outsider, defaultCurrency: outsider.defaultCurrency, upiId: outsider.upiId, image: outsider.image };
});

/** Everything an outsider could touch: the group, its members and money, everyone else's account, and email. */
const snapshot = async () => ({
  group: await db.group.findUniqueOrThrow({ where: { id: target.groupId } }),
  members: await db.groupMember.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  expenses: await db.expense.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  payers: await db.expensePayer.findMany({ where: { expense: { groupId: target.groupId } }, orderBy: { id: "asc" } }),
  shares: await db.expenseShare.findMany({ where: { expense: { groupId: target.groupId } }, orderBy: { id: "asc" } }),
  settlements: await db.settlement.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  comments: await db.comment.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  activity: await db.activity.findMany({ where: { groupId: target.groupId }, orderBy: { id: "asc" } }),
  users: await db.user.findMany({ where: { id: { not: outsider.id } }, orderBy: { id: "asc" } }),
  emails: await readOutbox(),
});

it("has a row for every exported action, in every actions file", () => {
  // A new file of actions must be imported above, and each new action needs a row in the table.
  expect(readdirSync(fileURLToPath(new URL("../src/server/actions", import.meta.url))).sort()).toEqual([
    "comments.ts",
    "expenses.ts",
    "groups.ts",
    "members.ts",
    "profile.ts",
    "settlements.ts",
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

// Pages send people who haven't onboarded there first; the actions must too, or a sign-up name that onboarding never
// checked could be copied onto a membership by a direct call.
describe("before onboarding", () => {
  const toOnboarding = { digest: expect.stringContaining(";/onboarding;") };
  beforeEach(() => void (session.user = { ...session.user!, onboardedAt: null }));

  it.each((Object.keys(table) as ActionName[]).filter((name) => name !== "completeOnboardingAction"))(
    "%s sends them to onboarding and changes nothing",
    async (name) => {
      const before = await snapshot();
      for (const call of table[name].calls(target)) await expect(call()).rejects.toMatchObject(toOnboarding);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("won't let them join a group, even with its real invite code", async () => {
    await expect(actions.joinByInviteCodeAction({ code: target.inviteCode })).rejects.toMatchObject(toOnboarding);
    expect(await db.groupMember.count({ where: { userId: outsider.id } })).toBe(1); // only their own group
  });

  it("still lets them finish onboarding", async () => {
    const input = { name: "Mallory", defaultCurrency: "INR", upiId: "", timezone: "UTC" };
    expect(await actions.completeOnboardingAction(input)).toEqual({ ok: true, data: undefined });
    expect((await db.user.findUniqueOrThrow({ where: { id: outsider.id } })).onboardedAt).not.toBeNull();
  });
});
