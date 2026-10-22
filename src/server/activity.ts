import type { Prisma } from "@/generated/prisma/client";
import type { ActivityKind, ActivityPayloads } from "@/lib/activity";

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
