import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GROUP_TYPES, groupTint, type GroupType } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import { ForbiddenError } from "@/server/errors";
import { getGroupDetail } from "@/server/groups";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Group · Hisaab" };

// Minimal for now: Task 13 adds members, invites and settings.
export default async function GroupPage({ params }: PageProps<"/groups/[groupId]">) {
  const user = await requireOnboardedUser();
  const { groupId } = await params;
  const { group, members } = await getGroupDetail(user.id, groupId).catch((error) => {
    if (error instanceof ForbiddenError) notFound(); // missing, or not theirs: the same 404 either way
    throw error;
  });

  return (
    <header className="flex items-center gap-4">
      <span aria-hidden className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl text-4xl", groupTint(group.color).tile)}>
        {group.emoji}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{group.name}</h1>
        <p className="text-sm text-muted-foreground">
          {GROUP_TYPES[group.type as GroupType]?.label} · {members.length === 1 ? "1 member" : `${members.length} members`} ·{" "}
          {group.baseCurrency}
        </p>
      </div>
    </header>
  );
}
