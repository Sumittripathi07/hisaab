import { Archive, Plus, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { GroupPageFab } from "@/components/add-expense-fab";
import { BalancePanel } from "@/components/balance-panel";
import { ExpenseFilterBar } from "@/components/expense-filters";
import { ExpenseList } from "@/components/expense-list";
import { AddExpenseButton, AddExpenseProvider } from "@/components/expense-sheet";
import { ArchiveToggle, LeaveGroup } from "@/components/group-actions";
import { GroupTabs } from "@/components/group-tabs";
import { InviteSheet } from "@/components/invite-sheet";
import { MemberList } from "@/components/member-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { parseFilters, toQuery } from "@/lib/expense-filters";
import { GROUP_TYPES, groupTint, type GroupType } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import { getGroupBalances } from "@/server/balances";
import { ForbiddenError } from "@/server/errors";
import { getExpenseFormData, listExpenses } from "@/server/expenses";
import { getGroupDetail } from "@/server/groups";
import { claimUrl, inviteUrl } from "@/server/members";
import { requireOnboardedUser } from "@/server/session";
import { listSettlements } from "@/server/settlements";

export const metadata: Metadata = { title: "Group · Hisaab" };

const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

export default async function GroupPage({ params, searchParams }: PageProps<"/groups/[groupId]">) {
  const user = await requireOnboardedUser();
  const [{ groupId }, query] = await Promise.all([params, searchParams]);
  const { group, me, members } = await getGroupDetail(user.id, groupId).catch((error) => {
    if (error instanceof ForbiddenError) notFound(); // missing, or not theirs: the same 404 either way
    throw error;
  });
  const isAdmin = me.role !== "MEMBER";
  const archived = group.archivedAt !== null;
  const link = inviteUrl(group.inviteCode);
  // "Show more" asks for another page's worth; a hand-edited limit is kept within what the list allows.
  const limit = Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, Math.trunc(Number([query.limit].flat()[0])) || PAGE_SIZE));
  const filters = parseFilters(query);
  const filtered = Object.keys(filters).length > 0;
  const tab = [query.tab].flat()[0] === "balances" ? "balances" : "expenses";
  // Only the tab on show is read; the add-expense sheet is on both.
  const [expenses, balances, formData] = await Promise.all([
    tab === "expenses" ? listExpenses(user.id, group.id, filters, limit) : null,
    tab === "balances" ? Promise.all([getGroupBalances(user.id, group.id), listSettlements(user.id, group.id)]) : null,
    archived ? null : getExpenseFormData(user.id, group.id),
  ]);

  const page = (
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
          {/* Phones have the + button instead. */}
          {!archived && (
            <AddExpenseButton className="hidden h-11 rounded-xl px-4 text-base shadow-sm shadow-primary/20 md:inline-flex">
              <Plus aria-hidden />
              Add expense
            </AddExpenseButton>
          )}
          {!archived && (
            <InviteSheet
              groupId={group.id}
              groupName={group.name}
              inviteUrl={link}
              qrCode={await QRCode.toDataURL(link, { margin: 1, width: 224 })}
              className="flex-1 sm:flex-none md:bg-secondary md:text-secondary-foreground md:shadow-none md:hover:bg-secondary/80"
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
        <section aria-labelledby="tab-heading" className="min-w-0 space-y-4">
          <h2 id="tab-heading" className="sr-only">
            {tab === "balances" ? "Balances" : "Expenses"}
          </h2>
          <GroupTabs groupId={group.id} current={tab} />
          {balances && <BalancePanel groupId={group.id} balances={balances[0]} settlements={balances[1]} archived={archived} />}
          {expenses && (
            <>
              {/* A group with nothing in it has nothing to search. */}
              {(expenses.items.length > 0 || filtered) && (
                <ExpenseFilterBar groupId={group.id} members={members.map((m) => ({ id: m.id, displayName: m.displayName }))} filters={filters} />
              )}
              <ExpenseList
                items={expenses.items}
                currency={group.baseCurrency}
                groupId={group.id}
                hasMore={expenses.hasMore}
                moreHref={`/groups/${group.id}?${toQuery(filters, { tab: "expenses", limit: String(limit + PAGE_SIZE) })}`}
                canAdd={!archived}
                clearHref={filtered ? `/groups/${group.id}?tab=expenses` : undefined}
              />
            </>
          )}
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

  // The add-expense sheet needs the group's people and history, which an archived group has no use for.
  return formData ? (
    <AddExpenseProvider data={formData} openOnLoad={[query.add].flat()[0] === "1"}>
      {page}
      <GroupPageFab />
    </AddExpenseProvider>
  ) : (
    page
  );
}
