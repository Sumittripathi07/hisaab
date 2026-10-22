import { Archive, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ArchiveToggle, LeaveGroup } from "@/components/group-actions";
import { InviteSheet } from "@/components/invite-sheet";
import { MemberList } from "@/components/member-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { GROUP_TYPES, groupTint, type GroupType } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import { ForbiddenError } from "@/server/errors";
import { getGroupDetail } from "@/server/groups";
import { claimUrl, inviteUrl } from "@/server/members";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Group · Hisaab" };

export default async function GroupPage({ params }: PageProps<"/groups/[groupId]">) {
  const user = await requireOnboardedUser();
  const { groupId } = await params;
  const { group, me, members } = await getGroupDetail(user.id, groupId).catch((error) => {
    if (error instanceof ForbiddenError) notFound(); // missing, or not theirs: the same 404 either way
    throw error;
  });
  const isAdmin = me.role !== "MEMBER";
  const archived = group.archivedAt !== null;
  const link = inviteUrl(group.inviteCode);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-4">
        <span aria-hidden className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl text-4xl", groupTint(group.color).tile)}>
          {group.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" title={group.name}>
            {group.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {/* DIRECT groups (Phase 4) have no page of this kind. */}
            <Badge variant="secondary">{GROUP_TYPES[group.type as GroupType]?.label}</Badge>
            <span>{members.length === 1 ? "1 member" : `${members.length} members`}</span>
            <span aria-hidden>·</span>
            <span>{group.baseCurrency}</span>
          </p>
        </div>
        {/* On phones, Invite gets a row of its own; with nothing else to show, the cog stays beside the name. */}
        <div className={cn("flex gap-2", !archived && "w-full sm:w-auto")}>
          {!archived && (
            <InviteSheet
              groupId={group.id}
              groupName={group.name}
              inviteUrl={link}
              qrCode={await QRCode.toDataURL(link, { margin: 1, width: 224 })}
              className="flex-1 sm:flex-none"
            />
          )}
          {isAdmin && (
            <Link
              href={`/groups/${group.id}/settings`}
              aria-label="Group settings"
              title="Group settings"
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11 rounded-xl")}
            >
              <Settings className="size-5" aria-hidden />
            </Link>
          )}
        </div>
      </header>

      {archived && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-3 dark:bg-amber-400/10">
          <Archive className="size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">This group is archived</p>
            <p className="text-sm text-muted-foreground">
              Everything in it is kept, but nothing can change{isAdmin ? " until you unarchive it" : " until an admin unarchives it"}.
            </p>
          </div>
          {isAdmin && (
            <ArchiveToggle groupId={group.id} groupName={group.name} archived className="h-10 w-full rounded-xl bg-background sm:w-auto" />
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Phase 2 puts expenses and balances here. */}
        {/* A compact row on phones, so the members stay near the top; a roomy card beside them on wider screens. */}
        <section
          aria-labelledby="expenses-heading"
          className="flex items-start gap-4 rounded-3xl border border-dashed p-5 sm:flex-col sm:items-center sm:px-6 sm:py-10 sm:text-center lg:py-16"
        >
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl sm:size-14 sm:text-3xl">
            🧾
          </span>
          <div>
            <h2 id="expenses-heading" className="font-semibold tracking-tight sm:text-lg">
              Expenses are coming next
            </h2>
            <p className="mt-1 max-w-sm text-sm text-balance text-muted-foreground sm:text-base">
              Soon you&apos;ll add what everyone paid, see who owes whom, and settle up over UPI. For now, get everyone in.
            </p>
          </div>
        </section>

        <section aria-labelledby="members-heading" className="space-y-3">
          <h2 id="members-heading" className="text-lg font-semibold tracking-tight">
            Members
          </h2>
          <MemberList
            groupId={group.id}
            members={members.map((m) => ({ ...m, claimUrl: m.claimToken && claimUrl(m.claimToken) }))}
            me={{ id: me.id, role: me.role }}
            archived={archived}
          />
          {/* Admins leave from settings; everyone else, here. */}
          {!isAdmin && (
            <div className="pt-3">
              <LeaveGroup groupId={group.id} groupName={group.name} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
