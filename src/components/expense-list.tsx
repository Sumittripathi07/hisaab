import { Plus } from "lucide-react";
import Link from "next/link";
import { AddExpenseButton } from "@/components/expense-sheet";
import { buttonVariants } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/categories";
import { formatDay, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { ExpenseListItem } from "@/server/expenses";

type Props = {
  items: ExpenseListItem[];
  currency: string;
  groupId: string;
  hasMore: boolean;
  /** Where "Show more" goes: the same page with a bigger `limit`. */
  moreHref: string;
  /** False for an archived group: nothing can be added, so the empty state doesn't offer to. */
  canAdd?: boolean;
};

/** What the viewer lent or owes on one expense, in words as well as colour. */
function Net({ myNet, currency }: { myNet: bigint; currency: string }) {
  if (myNet > 0n) return <span className="text-positive">you lent {formatMoney(myNet, currency)}</span>;
  if (myNet < 0n) return <span className="text-negative">you owe {formatMoney(-myNet, currency)}</span>;
  return <span className="text-muted-foreground">not involved</span>;
}

/** The group's expenses, newest first under their month, each a link to the expense. Server-rendered: amounts are bigint. */
export function ExpenseList({ items, currency, groupId, hasMore, moreHref, canAdd = false }: Props) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center sm:py-16">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-muted text-3xl">
          🧾
        </span>
        <h3 className="mt-4 font-semibold tracking-tight sm:text-lg">No expenses yet</h3>
        <p className="mt-1 max-w-sm text-balance text-muted-foreground">
          {canAdd ? "Add the first one and Hisaab works out who owes whom." : "Nothing was added before this group was archived."}
        </p>
        {/* From 768px the header has the button; on phones the + sits in the corner, so this one is easier to find. */}
        {canAdd && (
          <AddExpenseButton className="mt-6 h-12 rounded-xl px-6 text-base md:hidden">
            <Plus aria-hidden />
            Add expense
          </AddExpenseButton>
        )}
      </div>
    );
  }

  // Already newest first, so each month's rows are together.
  const months: [string, ExpenseListItem[]][] = [];
  for (const item of items) {
    const label = monthLabel(item.date);
    if (months.at(-1)?.[0] === label) months.at(-1)![1].push(item);
    else months.push([label, [item]]);
  }

  return (
    <div className="space-y-6">
      {months.map(([month, rows]) => (
        <section key={month} className="space-y-2">
          <h3 className="px-1 text-sm font-semibold text-muted-foreground">{month}</h3>
          <ul className="space-y-2">
            {rows.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/groups/${groupId}/expenses/${item.id}`}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-card-foreground shadow-xs outline-none transition-[translate,scale,box-shadow,border-color] duration-200 ease-out hover:border-foreground/15 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                  <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                    {CATEGORIES[item.category].emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.description}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {formatDay(item.date)} · {item.payerLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">{formatMoney(item.amount, currency)}</span>
                    <span className="block text-xs font-medium">
                      <Net myNet={item.myNet} currency={currency} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <Link href={moreHref} scroll={false} className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl text-base")}>
          Show more
        </Link>
      )}
    </div>
  );
}
