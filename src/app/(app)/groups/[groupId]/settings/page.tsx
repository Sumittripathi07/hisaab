import { ChevronLeft, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveToggle, GroupDetailsForm, LeaveGroup, ResetInviteLink } from "@/components/group-actions";
import { MemberList } from "@/components/member-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currencyOptions } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { GroupInput } from "@/lib/validation";
import { requireMember } from "@/server/authz";
import { ForbiddenError } from "@/server/errors";
import { getGroupDetail } from "@/server/groups";
import { claimUrl } from "@/server/members";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Group settings · Hisaab" };

/**
 * For members, people who left, and groups that don't exist alike, so it never says which. The way out is the dashboard,
 * not the group, which an outsider can't open.
 */
function NoAccess() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
      <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Lock className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">You don&apos;t have access</h1>
      <p className="mt-2 text-balance text-muted-foreground">Only the group&apos;s owner and admins can change its settings.</p>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "mt-6 h-11 rounded-xl px-4")}>
        Go to dashboard
      </Link>
    </div>
  );
}

export default async function GroupSettingsPage({ params }: PageProps<"/groups/[groupId]/settings">) {
  const user = await requireOnboardedUser();
  const { groupId } = await params;
  const allowed = await requireMember(user.id, groupId, { role: "admin" }).then(
    () => true,
    (error) => {
      if (error instanceof ForbiddenError) return false;
      throw error;
    },
  );
  if (!allowed) return <NoAccess />;

  const { group, me, members, currencyLocked } = await getGroupDetail(user.id, groupId);
  const archived = group.archivedAt !== null;
  const isOwner = me.role === "OWNER";
  const ownerHint = !isOwner
    ? undefined
    : archived
      ? "You're the owner. To leave, unarchive the group and make someone else the owner first."
      : members.some((m) => m.id !== me.id && !m.isPlaceholder)
        ? "You're the owner. Make someone else the owner first, from the menu next to their name, and then you can leave."
        : "You're the owner, and nobody else has joined yet. To clear the group from your list, archive it instead.";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/groups/${group.id}`}
          className="-ml-1 inline-flex max-w-full items-center gap-1 rounded-md pr-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{group.name}</span>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Group settings</h1>
          {archived && <Badge variant="secondary">Archived</Badge>}
        </div>
      </div>

      {/* Archived, nothing can change: what's left is who's in it, unarchiving, and leaving. */}
      {!archived && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Everyone in the group sees these.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupDetailsForm
              groupId={group.id}
              currencies={currencyOptions(group.baseCurrency)}
              currencyLocked={currencyLocked}
              defaultValues={{
                name: group.name,
                emoji: group.emoji,
                color: group.color as GroupInput["color"],
                type: group.type as GroupInput["type"],
                baseCurrency: group.baseCurrency,
                simplifyDebts: group.simplifyDebts,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {isOwner
              ? "Admins can edit the group, add and remove members, and reset the invite link."
              : "As an admin, you can add and remove members. Only the owner can change roles or remove admins."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemberList
            groupId={group.id}
            members={members.map((m) => ({ ...m, claimUrl: m.claimToken && claimUrl(m.claimToken) }))}
            me={{ id: me.id, role: me.role }}
            archived={archived}
            manage
          />
        </CardContent>
      </Card>

      {!archived && (
        <Card>
          <CardHeader>
            <CardTitle>Invite link</CardTitle>
            <CardDescription>Shared it somewhere it shouldn&apos;t be? Get a new one, and the current one stops letting people in.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResetInviteLink groupId={group.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Archive</CardTitle>
          <CardDescription>
            {archived
              ? "This group is archived, so nothing in it can change. Unarchive it to edit its details, members or invite link."
              : "For a trip that's over or a flat you've moved out of. It's kept, read-only, under Archived."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArchiveToggle groupId={group.id} groupName={group.name} archived={archived} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave group</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveGroup groupId={group.id} groupName={group.name} ownerHint={ownerHint} />
        </CardContent>
      </Card>
    </div>
  );
}
