import type { ActivityKind } from "@/lib/activity";
import { fromDbDate, toDbDate, todayIn } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Transfer } from "@/lib/money/simplify";
import { upiPayLink } from "@/lib/upi";
import type { SettlementInput } from "@/lib/validation";
import type { Group, GroupMember, Prisma, Settlement, SettlementMethod, SettlementStatus } from "@/generated/prisma/client";
import { recordActivity } from "./activity";
import { requireMember, requireMemberFor } from "./authz";
import { getGroupBalances } from "./balances";
import { NotFoundError, UserError } from "./errors";

const DELETED = "This payment was deleted.";

type Person = Pick<GroupMember, "id" | "userId">;

const isAdmin = (member: GroupMember) => member.role === "ADMIN" || member.role === "OWNER";
/** The payer or the payee (either side can resolve a dispute by re-recording it), or anyone for two placeholders. */
const mayRecord = (meId: string, from: Person, to: Person) => meId === from.id || meId === to.id || (from.userId === null && to.userId === null);
/** The person who recorded it, or an admin or the owner. */
const mayChange = (me: GroupMember, s: Settlement) => me.id === s.createdByMemberId || isAdmin(me);
/** Only the payee knows whether the money arrived; for a placeholder payee, who can't say, an admin or the owner. */
const mayDispute = (me: GroupMember, payee: Pick<GroupMember, "userId">) => (payee.userId === null ? isAdmin(me) : payee.userId === me.userId);

/** Records `kind` with the payment as it now stands. */
const log = (tx: Prisma.TransactionClient, actor: GroupMember, kind: Extract<ActivityKind, `settlement.${string}`>, s: Settlement) =>
  recordActivity(tx, {
    groupId: s.groupId,
    actorMemberId: actor.id,
    kind,
    entityId: s.id,
    payload: { fromMemberId: s.fromMemberId, toMemberId: s.toMemberId, amount: s.amount.toString(), currency: s.currency, method: s.method },
  });

/** Phase 2 is single-currency: the payment is in the group's currency, so the base amount is the amount. */
export async function recordSettlement(userId: string, input: SettlementInput): Promise<{ id: string }> {
  const { groupId, fromMemberId, toMemberId, amount, method, date, note } = input;
  const { member, group } = await requireMember(userId, groupId, { write: true });
  // People who left count too, so what they still owe or are owed can be settled.
  const people = await db.groupMember.findMany({ where: { groupId, id: { in: [fromMemberId, toMemberId] } }, select: { id: true, userId: true } });
  const from = people.find((p) => p.id === fromMemberId);
  const to = people.find((p) => p.id === toMemberId);
  if (!from || !to) throw new UserError("Choose people in this group.");
  if (!mayRecord(member.id, from, to)) throw new UserError("You can only record payments you made or received.");
  return db.$transaction(async (tx) => {
    const settlement = await tx.settlement.create({
      data: {
        groupId,
        fromMemberId,
        toMemberId,
        currency: group.baseCurrency,
        amount,
        baseAmount: amount,
        method,
        date: toDbDate(date),
        note,
        createdByMemberId: member.id,
      },
    });
    await log(tx, member, "settlement.created", settlement);
    return { id: settlement.id };
  });
}

async function requireEditor(userId: string, settlementId: string) {
  const found = await requireMemberFor(userId, "settlement", settlementId, { write: true });
  if (!mayChange(found.member, found.row)) throw new UserError("Only the person who recorded this payment or an admin can change it.");
  return found;
}

/** Last write wins (there's no version). Keeps the status: editing a disputed payment doesn't make it count again. */
export async function updateSettlement(
  userId: string,
  settlementId: string,
  input: { amount: bigint; method: SettlementMethod; date: string; note: string | null },
): Promise<void> {
  const { member, row } = await requireEditor(userId, settlementId);
  if (row.deletedAt) throw new UserError(DELETED);
  const { amount, method, date, note } = input;
  if (amount === row.amount && method === row.method && date === fromDbDate(row.date) && note === row.note) return;
  await db.$transaction(async (tx) => {
    const [updated] = await tx.settlement.updateManyAndReturn({
      where: { id: settlementId, deletedAt: null },
      data: { amount, baseAmount: amount, method, date: toDbDate(date), note },
    });
    if (!updated) throw new UserError(DELETED);
    await log(tx, member, "settlement.updated", updated);
  });
}

/** Conditional on the state it changes, so repeating it (a double tap) is a no-op and logs nothing. */
async function setDeleted(userId: string, settlementId: string, deleted: boolean): Promise<void> {
  const { member } = await requireEditor(userId, settlementId);
  await db.$transaction(async (tx) => {
    const [changed] = await tx.settlement.updateManyAndReturn({
      where: { id: settlementId, deletedAt: deleted ? null : { not: null } },
      data: { deletedAt: deleted ? new Date() : null },
    });
    if (changed) await log(tx, member, deleted ? "settlement.deleted" : "settlement.restored", changed);
  });
}

export const deleteSettlement = (userId: string, settlementId: string): Promise<void> => setDeleted(userId, settlementId, true);
export const restoreSettlement = (userId: string, settlementId: string): Promise<void> => setDeleted(userId, settlementId, false);

/** "I didn't receive this": the payment stops counting toward balances. */
export async function disputeSettlement(userId: string, settlementId: string): Promise<void> {
  const { member, row } = await requireMemberFor(userId, "settlement", settlementId, { write: true });
  const payee = await db.groupMember.findUniqueOrThrow({ where: { id: row.toMemberId }, select: { userId: true } });
  if (!mayDispute(member, payee)) throw new UserError("Only the person who was paid can dispute this.");
  if (row.deletedAt) throw new UserError(DELETED);
  await db.$transaction(async (tx) => {
    const [disputed] = await tx.settlement.updateManyAndReturn({
      where: { id: settlementId, status: "RECORDED", deletedAt: null },
      data: { status: "DISPUTED", disputedAt: new Date() },
    });
    if (!disputed) throw new UserError("This payment is already disputed.");
    await log(tx, member, "settlement.disputed", disputed);
  });
}

export type SettlementView = {
  id: string;
  groupId: string;
  from: { memberId: string; displayName: string };
  to: { memberId: string; displayName: string };
  amount: bigint;
  currency: string;
  method: SettlementMethod;
  status: SettlementStatus;
  note: string | null;
  date: string;
  /** Display name of the member who recorded it. */
  recordedBy: string;
  disputedAt: Date | null;
  canEdit: boolean;
  canDispute: boolean;
};

const VIEW = {
  fromMember: { select: { displayName: true } },
  toMember: { select: { displayName: true, userId: true } },
  createdBy: { select: { displayName: true } },
} as const;

function view(s: Prisma.SettlementGetPayload<{ include: typeof VIEW }>, me: GroupMember, group: Group): SettlementView {
  const writable = !group.archivedAt;
  return {
    id: s.id,
    groupId: s.groupId,
    from: { memberId: s.fromMemberId, displayName: s.fromMember.displayName },
    to: { memberId: s.toMemberId, displayName: s.toMember.displayName },
    amount: s.amount,
    currency: s.currency,
    method: s.method,
    status: s.status,
    note: s.note,
    date: fromDbDate(s.date),
    recordedBy: s.createdBy.displayName,
    disputedAt: s.disputedAt,
    canEdit: writable && mayChange(me, s),
    canDispute: writable && s.status === "RECORDED" && mayDispute(me, s.toMember),
  };
}

export async function getSettlement(userId: string, settlementId: string): Promise<SettlementView> {
  const { member, group, row } = await requireMemberFor(userId, "settlement", settlementId);
  if (row.deletedAt) throw new NotFoundError(DELETED);
  return view(await db.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: VIEW }), member, group);
}

/** Newest first, disputed ones included, deleted ones not. */
export async function listSettlements(userId: string, groupId: string, limit = 20): Promise<SettlementView[]> {
  const { member, group } = await requireMember(userId, groupId);
  const rows = await db.settlement.findMany({
    where: { groupId, deletedAt: null },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: Math.min(500, Math.max(1, Math.trunc(limit) || 1)),
    include: VIEW,
  });
  return rows.map((s) => view(s, member, group));
}

export type SettleUpTransfer = Transfer & {
  fromName: string;
  toName: string;
  involvesMe: boolean;
  canRecord: boolean;
  /** Offered to the payer only (a UPI ID can embed a phone number), when the group is in INR and the payee has a UPI ID on their profile. */
  upi: { link: string; upiId: string } | null;
};

/** The suggested transfers, the viewer's own first and the rest in the group's order. */
export async function getSettleUp(
  userId: string,
  groupId: string,
): Promise<{ groupName: string; currency: string; today: string; myMemberId: string; transfers: SettleUpTransfer[] }> {
  const { currency, transfers, myMemberId } = await getGroupBalances(userId, groupId); // authorises
  const named = [...new Set(transfers.flatMap((x) => [x.from, x.to]))];
  const [group, user, people] = await Promise.all([
    db.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true, archivedAt: true } }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    db.groupMember.findMany({
      where: { groupId, id: { in: named } },
      select: { id: true, userId: true, displayName: true, user: { select: { upiId: true } } },
    }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const list = transfers.map((x): SettleUpTransfer => {
    const from = byId.get(x.from)!;
    const to = byId.get(x.to)!;
    const upiId = currency === "INR" && x.from === myMemberId ? to.user?.upiId : null;
    return {
      ...x,
      fromName: from.displayName,
      toName: to.displayName,
      involvesMe: x.from === myMemberId || x.to === myMemberId,
      canRecord: !group.archivedAt && mayRecord(myMemberId, from, to),
      upi: upiId ? { upiId, link: upiPayLink({ upiId, payeeName: to.displayName, amount: x.amount, groupName: group.name }) } : null,
    };
  });
  return {
    groupName: group.name,
    currency,
    today: todayIn(user.timezone),
    myMemberId,
    transfers: [...list.filter((x) => x.involvesMe), ...list.filter((x) => !x.involvesMe)],
  };
}
