import { Archive, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CreateGroupButton, OpenCreateGroupOnLoad } from "@/components/create-group-sheet";
import { EmptyGroups } from "@/components/empty-groups";
import { GroupGrid } from "@/components/group-card";
import { overallLines, TONE_CLASS } from "@/lib/balance-text";
import { cn } from "@/lib/utils";
import { listGroupsForUser } from "@/server/groups";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard · Hisaab" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireOnboardedUser();
  const [{ active, archived }, { new: openCreate }] = await Promise.all([listGroupsForUser(user.id), searchParams]);
  const firstName = user.name.trim().split(/\s+/)[0];
  // Currencies don't mix, so each is summed on its own. Archived groups still count: the money is still owed.
  const overall = overallLines([...active, ...archived].map((g) => ({ currency: g.baseCurrency, net: g.myNet })));
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: user.timezone }).format(new Date());

  return (
    <div className="space-y-8">
      {/* Onboarding's "Create a group" lands here. */}
      {openCreate === "1" && <OpenCreateGroupOnLoad />}
      <header>
        <p className="text-sm font-medium text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Hi, {firstName} <span aria-hidden className="inline-block origin-[70%_75%] motion-safe:animate-wave">👋</span>
        </h1>
        {/* A new account has no balance to speak of yet. */}
        {active.length + archived.length > 0 && (
          <ul aria-label="Your balance across groups" className="mt-2 space-y-0.5">
            {overall.map((line) => (
              <li key={line.tone} className={cn("text-lg font-semibold tabular-nums", TONE_CLASS[line.tone])}>
                {line.text}
              </li>
            ))}
          </ul>
        )}
      </header>

      {active.length === 0 ? (
        <EmptyGroups archivedCount={archived.length} />
      ) : (
        <section aria-labelledby="groups-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 id="groups-heading" className="text-lg font-semibold tracking-tight">
              Your groups
            </h2>
            <div className="flex items-center gap-4">
              {archived.length > 0 && (
                <Link
                  href="/groups?tab=archived"
                  className="flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Archive className="size-4" aria-hidden />
                  Archived ({archived.length})
                </Link>
              )}
              {/* The sidebar has this from 768px; on phones the + button adds expenses, so this is where a group starts. */}
              <CreateGroupButton variant="outline" className="h-11 rounded-xl px-3.5 md:hidden">
                <Plus aria-hidden />
                New group
              </CreateGroupButton>
            </div>
          </div>
          <GroupGrid groups={active} />
        </section>
      )}
    </div>
  );
}
