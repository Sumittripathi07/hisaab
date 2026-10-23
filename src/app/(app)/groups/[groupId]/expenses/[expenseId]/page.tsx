import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentThread } from "@/components/comment-thread";
import { ExpenseActions } from "@/components/expense-actions";
import { UserAvatar } from "@/components/user-avatar";
import { describeActivity } from "@/lib/activity";
import { CATEGORIES } from "@/lib/categories";
import { commentViews } from "@/lib/comment-view";
import { formatAgo, formatDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { ExpenseFormValues } from "@/lib/validation";
import { listEntityHistory } from "@/server/activity";
import { requireMember } from "@/server/authz";
import { listComments } from "@/server/comments";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getExpense, getExpenseFormData } from "@/server/expenses";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Expense · Hisaab" };

const METHOD_CAPTION = {
  EQUAL: "Split equally",
  EXACT: "Split by exact amounts",
  PERCENT: "Split by percentage",
  SHARES: "Split by shares",
  ITEMIZED: "Split by items",
} as const;

const card = "rounded-2xl border bg-card p-4 text-card-foreground";
const heading = "text-base font-semibold tracking-tight";

export default async function ExpensePage({ params }: PageProps<"/groups/[groupId]/expenses/[expenseId]">) {
  const user = await requireOnboardedUser();
  const { groupId, expenseId } = await params;
  // An unknown id, someone else's, a deleted one and one under the wrong group are the same 404.
  const detail = await getExpense(user.id, expenseId).catch((error) => {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) notFound();
    throw error;
  });
  if (detail.expense.groupId !== groupId) notFound();
  const { expense, payers, shares, canEdit } = detail;

  const { group, member } = await requireMember(user.id, groupId);
  const archived = group.archivedAt !== null;
  const [history, comments, formData] = await Promise.all([
    listEntityHistory(user.id, "expense", expenseId),
    listComments(user.id, { kind: "expense", id: expenseId }),
    // An archived group can't change, so there is no form to fill.
    archived ? null : getExpenseFormData(user.id, groupId, expenseId),
  ]);

  const { currency } = expense;
  const money = (amount: bigint) => formatMoney(amount, currency);
  const nameOf = (memberId: string, displayName: string) => (memberId === member.id ? "You" : displayName);
  const names = new Map([...payers, ...shares].map((p) => [p.memberId, nameOf(p.memberId, p.displayName)]));
  const initial: ExpenseFormValues = {
    description: expense.description,
    amount: expense.amount.toString(),
    category: expense.category,
    date: expense.date,
    notes: expense.notes ?? "",
    payers: payers.map((p) => ({ memberId: p.memberId, value: p.amount.toString() })),
    split: detail.split,
  };
  const people = (list: typeof payers) => (
    <ul className="mt-2 divide-y">
      {list.map((p) => (
        <li key={p.memberId} className="flex min-h-12 items-center gap-3 py-1.5">
          <UserAvatar name={p.displayName} size="sm" />
          <span className="min-w-0 flex-1 truncate">{nameOf(p.memberId, p.displayName)}</span>
          <span className="font-medium tabular-nums">{money(p.amount)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/groups/${groupId}`}
        className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {group.name}
      </Link>

      <header className="flex items-center gap-4">
        <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl">
          {CATEGORIES[expense.category].emoji}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{expense.description}</h1>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums sm:text-3xl">{money(expense.amount)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDay(expense.date)} · {CATEGORIES[expense.category].label} · Added by {expense.createdBy}
          </p>
        </div>
      </header>

      <ExpenseActions data={formData} expenseId={expenseId} version={expense.version} initial={initial} canEdit={canEdit} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="paid-by" className={card}>
            <h2 id="paid-by" className={heading}>
              Paid by
            </h2>
            {people(payers)}
          </section>

          <section aria-labelledby="split" className={card}>
            <h2 id="split" className={heading}>
              Split
            </h2>
            <p className="text-sm text-muted-foreground">{METHOD_CAPTION[expense.splitMethod]}</p>
            {people(shares)}
            {detail.split.method === "ITEMIZED" && (
              <div className="mt-4 border-t pt-3">
                <h3 className="text-sm font-semibold">Items</h3>
                <ul className="mt-1 divide-y">
                  {detail.split.items.map((item, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{item.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {item.memberIds.map((id) => names.get(id) ?? "Someone").join(", ")}
                        </span>
                      </span>
                      <span className="font-medium tabular-nums">{money(BigInt(item.amount))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {expense.notes && (
            <section aria-labelledby="notes" className={card}>
              <h2 id="notes" className={heading}>
                Notes
              </h2>
              <p className="mt-1 break-words whitespace-pre-wrap">{expense.notes}</p>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="history" className={card}>
            <h2 id="history" className={heading}>
              History
            </h2>
            <ol className="mt-3 space-y-3">
              {history.map((item) => {
                const { title, detail: more, money: mine } = describeActivity(item);
                return (
                  <li key={item.id} className="text-sm">
                    <p className="font-medium">{title}</p>
                    {more && <p className="text-muted-foreground">{more}</p>}
                    {mine && <p className={cn("font-medium", mine.tone === "owe" ? "text-negative" : "text-positive")}>{mine.text}</p>}
                    <time dateTime={item.createdAt.toISOString()} className="text-xs text-muted-foreground">
                      {formatAgo(item.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="comments" className={card}>
            <h2 id="comments" className={cn(heading, "mb-3")}>
              Comments
            </h2>
            <CommentThread
              groupId={groupId}
              target={{ kind: "expense", id: expenseId }}
              comments={commentViews(comments, member.id)}
              canComment={!archived}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
