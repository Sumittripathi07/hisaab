import { MessageSquare, Receipt, TriangleAlert, UserRound, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { describeActivity, type ActivityKind } from "@/lib/activity";
import { TONE_CLASS } from "@/lib/balance-text";
import { formatAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/activity";

type Props = {
  items: FeedItem[];
  /** The global feed names each row's group; a group's own feed doesn't need to. */
  showGroup?: boolean;
  hasMore: boolean;
  /** Where "Show more" goes: the same page with a bigger `limit`. */
  moreHref: string;
};

/** A dispute stands out; the rest take the icon of what they are about. */
function iconFor(kind: ActivityKind): { Icon: LucideIcon; tile: string } {
  if (kind === "settlement.disputed") return { Icon: TriangleAlert, tile: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" };
  const Icon = kind.startsWith("expense.") ? Receipt : kind.startsWith("settlement.") ? Wallet : kind === "comment.created" ? MessageSquare : UserRound;
  return { Icon, tile: "bg-muted text-muted-foreground" };
}

const row = "flex items-start gap-3 rounded-2xl border bg-card p-3.5 text-card-foreground shadow-xs";
const link =
  "outline-none transition-[translate,scale,box-shadow,border-color] duration-200 ease-out hover:border-foreground/15 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";

/** What happened, newest first, in each person's own words ("you owe ₹740"). Server-rendered, like the lists it sits beside. */
export function ActivityFeed({ items, showGroup = false, hasMore, moreHref }: Props) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center sm:py-16">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-muted text-3xl">
          🔔
        </span>
        <h3 className="mt-4 font-semibold tracking-tight sm:text-lg">Nothing here yet</h3>
        <p className="mt-1 max-w-sm text-balance text-muted-foreground">When people in your groups add expenses or settle up, it shows up here.</p>
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {items.map((item) => {
          const { title, detail, money } = describeActivity(item);
          const { Icon, tile } = iconFor(item.kind);
          const body = (
            <>
              <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", tile)}>
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">{title}</span>
                {detail && <span className="mt-0.5 line-clamp-2 block text-sm break-words text-muted-foreground">{detail}</span>}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {showGroup && <>{item.groupName} · </>}
                  <time dateTime={item.createdAt.toISOString()}>{formatAgo(item.createdAt, now)}</time>
                </span>
              </span>
              {/* In words as well as colour, and free to wrap so a long amount never squeezes the title on a small phone. */}
              {money && <span className={cn("max-w-28 shrink-0 text-right text-sm font-semibold sm:max-w-none", TONE_CLASS[money.tone])}>{money.text}</span>}
            </>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} className={cn(row, link)}>
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {hasMore && (
        <Link href={moreHref} scroll={false} className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl text-base")}>
          Show more
        </Link>
      )}
    </div>
  );
}
