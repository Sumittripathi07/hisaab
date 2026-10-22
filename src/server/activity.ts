import { db } from "@/lib/db";
import type { ActivityKind, ActivityPayloads, ActivityView } from "@/lib/activity";
import type { Prisma } from "@/generated/prisma/client";
import { requireMember, requireMemberFor } from "./authz";

/**
 * Writes one feed row and moves the group to the top of the dashboard (`updatedAt`), inside the caller's transaction so
 * the change and its record stand or fall together.
 */
export async function recordActivity<K extends ActivityKind>(
  tx: Prisma.TransactionClient,
  input: { groupId: string; actorMemberId: string; kind: K; entityId: string; payload: ActivityPayloads[K] },
): Promise<void> {
  await tx.activity.create({ data: input });
  await tx.group.update({ where: { id: input.groupId }, data: { updatedAt: new Date() } });
}

export type ActivityItem = ActivityView & { id: string; createdAt: Date; groupId: string; groupName: string; entityId: string };

/** Newest first; the id breaks ties so a page never repeats or skips a row. */
const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }] as const;
const WITH_GROUP = { group: { select: { name: true, baseCurrency: true } } } as const;

/** Reads `rows` as seen by the viewer's member in each group (`viewers`: group id → member id). */
async function toItems(rows: Prisma.ActivityGetPayload<{ include: typeof WITH_GROUP }>[], viewers: Map<string, string>): Promise<ActivityItem[]> {
  const members = await db.groupMember.findMany({
    where: { groupId: { in: [...new Set(rows.map((r) => r.groupId))] } },
    select: { id: true, groupId: true, displayName: true },
  });
  const names = new Map<string, Record<string, string>>();
  for (const m of members) names.set(m.groupId, { ...names.get(m.groupId), [m.id]: m.displayName });
  // kind and payload come out of the table as plain string and JSON; recordActivity is what keeps them paired.
  return rows.map(
    (r) =>
      ({
        id: r.id,
        createdAt: r.createdAt,
        groupId: r.groupId,
        groupName: r.group.name,
        entityId: r.entityId,
        kind: r.kind,
        payload: r.payload,
        actorMemberId: r.actorMemberId,
        viewerMemberId: viewers.get(r.groupId) ?? "",
        currency: r.group.baseCurrency,
        names: names.get(r.groupId) ?? {},
      }) as ActivityItem,
  );
}

const clamp = (limit: number) => Math.min(500, Math.max(1, Math.trunc(limit) || 1));

export async function listGroupActivity(userId: string, groupId: string, limit = 50): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const { member } = await requireMember(userId, groupId);
  const take = clamp(limit);
  const rows = await db.activity.findMany({ where: { groupId }, orderBy: [...NEWEST_FIRST], take: take + 1, include: WITH_GROUP });
  return { items: await toItems(rows.slice(0, take), new Map([[groupId, member.id]])), hasMore: rows.length > take };
}

/** Every group the user is in now; a group they left is no longer theirs to read. */
export async function listMyActivity(userId: string, limit = 50): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const mine = await db.groupMember.findMany({ where: { userId, leftAt: null }, select: { id: true, groupId: true } });
  const take = clamp(limit);
  const rows = await db.activity.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) } },
    orderBy: [...NEWEST_FIRST],
    take: take + 1,
    include: WITH_GROUP,
  });
  return { items: await toItems(rows.slice(0, take), new Map(mine.map((m) => [m.groupId, m.id]))), hasMore: rows.length > take };
}

/** What happened to one expense or payment, newest first. Comments on it are listed separately. */
export async function listEntityHistory(userId: string, entity: "expense" | "settlement", id: string): Promise<ActivityItem[]> {
  const { member, row } = await requireMemberFor(userId, entity, id);
  const rows = await db.activity.findMany({
    where: { groupId: row.groupId, entityId: id, kind: { startsWith: `${entity}.` } },
    orderBy: [...NEWEST_FIRST],
    include: WITH_GROUP,
  });
  return toItems(rows, new Map([[row.groupId, member.id]]));
}
