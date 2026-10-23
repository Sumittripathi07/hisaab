import { db } from "@/lib/db";
import { pairwiseDebts, simplifyDebts, type Transfer } from "@/lib/money/simplify";
import { Prisma } from "@/generated/prisma/client";
import { requireMember } from "./authz";

// Balances are computed on read from `baseAmount`, so Phase 4's FX doesn't change this file. A net is positive when the
// member is owed, negative when they owe.

/**
 * Every live money row of the group as (event, member, delta): payers +, shares −, and for a RECORDED payment the payer
 * + and the payee −. Each event (an expense or a payment) sums to zero, so any total over it does too.
 */
const ledger = (groupId: string) => Prisma.sql`
  SELECT e.id AS event, p."memberId", p."baseAmount" AS delta FROM "ExpensePayer" p JOIN "Expense" e ON e.id = p."expenseId"
    WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL
  UNION ALL SELECT e.id, s."memberId", -s."baseAmount" FROM "ExpenseShare" s JOIN "Expense" e ON e.id = s."expenseId"
    WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL
  UNION ALL SELECT id, "fromMemberId", "baseAmount" FROM "Settlement"
    WHERE "groupId" = ${groupId} AND "deletedAt" IS NULL AND status = 'RECORDED'
  UNION ALL SELECT id, "toMemberId", -"baseAmount" FROM "Settlement"
    WHERE "groupId" = ${groupId} AND "deletedAt" IS NULL AND status = 'RECORDED'`;

/** memberId → net, for members with any money in the group. One statement, so one snapshot that always nets to zero. No authz: callers authorise. */
export async function groupNets(groupId: string): Promise<Map<string, bigint>> {
  // SUM(bigint) is numeric in Postgres, hence the cast back, which the driver hands over as a bigint.
  const rows = await db.$queryRaw<{ memberId: string; net: bigint }[]>`
    SELECT "memberId", SUM(delta)::bigint AS net FROM (${ledger(groupId)}) t GROUP BY "memberId"`;
  return new Map(rows.map((r) => [r.memberId, r.net]));
}

/** One map of nets per live expense and RECORDED payment, for pairwise debts. */
async function groupEvents(groupId: string): Promise<Map<string, bigint>[]> {
  // ponytail: loads a row per payer, share and payment; fine for groups of hundreds of expenses, aggregate per pair in SQL past that.
  const rows = await db.$queryRaw<{ event: string; memberId: string; net: bigint }[]>`
    SELECT event, "memberId", SUM(delta)::bigint AS net FROM (${ledger(groupId)}) t GROUP BY event, "memberId"`;
  const events = new Map<string, Map<string, bigint>>();
  for (const { event, memberId, net } of rows) events.set(event, (events.get(event) ?? new Map()).set(memberId, net));
  return [...events.values()];
}

export type MemberBalance = { memberId: string; displayName: string; image: string | null; isPlaceholder: boolean; active: boolean; net: bigint };
export type GroupBalances = {
  currency: string;
  simplified: boolean;
  members: MemberBalance[];
  transfers: Transfer[];
  myMemberId: string;
  myNet: bigint;
  settled: boolean;
};

/**
 * Everyone's balance and who should pay whom. People who left are listed while they still owe or are owed, or while a
 * transfer names them: pairwise debts can leave someone with a net of zero both owing and owed.
 */
export async function getGroupBalances(userId: string, groupId: string): Promise<GroupBalances> {
  const { group, member: me } = await requireMember(userId, groupId);
  const [nets, rows] = await Promise.all([
    groupNets(groupId),
    db.groupMember.findMany({
      where: { groupId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { user: { select: { image: true } } },
    }),
  ]);
  const transfers = group.simplifyDebts ? simplifyDebts(nets) : pairwiseDebts(await groupEvents(groupId));
  const involved = new Set(transfers.flatMap((x) => [x.from, x.to]));
  const members = rows
    .map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      image: m.user?.image ?? null,
      isPlaceholder: m.userId === null,
      active: m.leftAt === null,
      net: nets.get(m.id) ?? 0n,
    }))
    .filter((m) => m.active || m.net !== 0n || involved.has(m.memberId));
  return {
    currency: group.baseCurrency,
    simplified: group.simplifyDebts,
    members,
    transfers,
    myMemberId: me.id,
    myNet: nets.get(me.id) ?? 0n,
    settled: transfers.length === 0,
  };
}

/** groupId → the caller's net, over their active memberships. Groups where they have no money in are left out. */
export async function myBalancesByGroup(userId: string): Promise<Map<string, bigint>> {
  const rows = await db.$queryRaw<{ groupId: string; net: bigint }[]>`
    WITH me AS (SELECT id FROM "GroupMember" WHERE "userId" = ${userId} AND "leftAt" IS NULL)
    SELECT "groupId", SUM(delta)::bigint AS net FROM (
      SELECT e."groupId", p."baseAmount" AS delta FROM "ExpensePayer" p JOIN "Expense" e ON e.id = p."expenseId"
        WHERE p."memberId" IN (SELECT id FROM me) AND e."deletedAt" IS NULL
      UNION ALL SELECT e."groupId", -s."baseAmount" FROM "ExpenseShare" s JOIN "Expense" e ON e.id = s."expenseId"
        WHERE s."memberId" IN (SELECT id FROM me) AND e."deletedAt" IS NULL
      UNION ALL SELECT "groupId", "baseAmount" FROM "Settlement"
        WHERE "fromMemberId" IN (SELECT id FROM me) AND "deletedAt" IS NULL AND status = 'RECORDED'
      UNION ALL SELECT "groupId", -"baseAmount" FROM "Settlement"
        WHERE "toMemberId" IN (SELECT id FROM me) AND "deletedAt" IS NULL AND status = 'RECORDED'
    ) t GROUP BY "groupId"`;
  return new Map(rows.map((r) => [r.groupId, r.net]));
}
