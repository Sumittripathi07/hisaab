import { Plus } from "lucide-react";
import Link from "next/link";
import { CreateGroupButton } from "@/components/create-group-sheet";
import { JoinWithLink } from "@/components/join-with-link";

const bigButton = "h-12 w-full rounded-xl text-base";

// Little tiles drifting around the wave, hinting at what a group can be for.
const ORBIT = [
  { emoji: "✈️", className: "-top-3 -left-9 rotate-[-10deg] bg-sky-100 dark:bg-sky-400/15" },
  { emoji: "🏠", className: "top-2 -right-11 rotate-[8deg] bg-amber-100 dark:bg-amber-400/15" },
  { emoji: "🍕", className: "-bottom-3 -left-7 rotate-[6deg] bg-rose-100 dark:bg-rose-400/15" },
];

/** Shown until someone has a group: start one, or join one from a friend's link. */
export function EmptyGroups({ archivedCount = 0 }: { archivedCount?: number }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-card px-6 py-12 text-center sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_0%,color-mix(in_oklch,var(--color-emerald-500)_16%,transparent),transparent),radial-gradient(40%_40%_at_90%_100%,color-mix(in_oklch,var(--color-sky-500)_10%,transparent),transparent)]"
      />
      <div className="relative mx-auto flex max-w-sm flex-col items-center">
        <div aria-hidden className="relative mb-8">
          <div className="flex size-24 items-center justify-center rounded-full bg-linear-to-br from-emerald-100 to-teal-50 text-5xl shadow-sm ring-8 ring-emerald-500/5 dark:from-emerald-400/20 dark:to-teal-400/5">
            <span className="inline-block origin-[70%_75%] motion-safe:animate-wave">👋</span>
          </div>
          {ORBIT.map(({ emoji, className }) => (
            <span key={emoji} className={`absolute flex size-10 items-center justify-center rounded-xl text-xl shadow-sm ${className}`}>
              {emoji}
            </span>
          ))}
        </div>
        <h2 className="text-xl font-semibold tracking-tight">No groups yet</h2>
        <p className="mt-2 text-balance text-muted-foreground">Create a group for your next trip, your flat, or anything you split.</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <CreateGroupButton className={bigButton}>
            <Plus aria-hidden />
            Create a group
          </CreateGroupButton>
          <JoinWithLink className={bigButton} />
        </div>
        {archivedCount > 0 && (
          <Link
            href="/groups?tab=archived"
            className="mt-6 rounded-md text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {archivedCount === 1 ? "See your archived group" : `See your ${archivedCount} archived groups`}
          </Link>
        )}
      </div>
    </section>
  );
}
