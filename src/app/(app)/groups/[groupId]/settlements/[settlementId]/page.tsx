import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentThread } from "@/components/comment-thread";
import { SettlementActions } from "@/components/settlement-actions";
import { Badge } from "@/components/ui/badge";
import { describeActivity } from "@/lib/activity";
import { commentViews } from "@/lib/comment-view";
import { formatAgo, formatDay, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money/format";
import { METHOD_LABEL } from "@/lib/settlement-methods";
import { listEntityHistory } from "@/server/activity";
import { requireMember } from "@/server/authz";
import { getGroupBalances } from "@/server/balances";
import { listComments } from "@/server/comments";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { requireOnboardedUser } from "@/server/session";
import { getSettlement } from "@/server/settlements";

export const metadata: Metadata = { title: "Payment · Hisaab" };

const card = "rounded-2xl border bg-card p-4 text-card-foreground";
const heading = "text-base font-semibold tracking-tight";

export default async function SettlementPage({ params }: PageProps<"/groups/[groupId]/settlements/[settlementId]">) {
  const user = await requireOnboardedUser();
  const { groupId, settlementId } = await params;
  // An unknown id, someone else's, a deleted one and one under the wrong group are the same 404.
  const payment = await getSettlement(user.id, settlementId).catch((error) => {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) notFound();
    throw error;
  });
  if (payment.groupId !== groupId) notFound();

  const { group, member } = await requireMember(user.id, groupId);
  const archived = group.archivedAt !== null;
  const [history, comments, balances] = await Promise.all([
    listEntityHistory(user.id, "settlement", settlementId),
    listComments(user.id, { kind: "settlement", id: settlementId }),
    // An archived group can't change, so there is no sheet to fill.
    archived ? null : getGroupBalances(user.id, groupId),
  ]);

  const { from, to, currency } = payment;
  const disputed = payment.status === "DISPUTED";
  // Whoever paid or was paid can put it right by recording it again.
  const involved = member.id === from.memberId || member.id === to.memberId;
  const today = todayIn(user.timezone);
  // The people the group still counts, and the two in this payment (who may have left since).
  const people = new Map((balances?.members ?? []).map((m) => [m.memberId, { id: m.memberId, displayName: m.displayName, active: m.active }]));
  for (const p of [from, to]) if (balances && !people.has(p.memberId)) people.set(p.memberId, { id: p.memberId, displayName: p.displayName, active: false });

  return (
    <div className="space-y-6">
      <Link
        href={`/groups/${groupId}?tab=balances`}
        className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {group.name}
      </Link>

      <header className="flex items-center gap-4">
        <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl">
          💸
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{`${from.displayName} paid ${to.displayName} ${formatMoney(payment.amount, currency)}`}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {disputed && <Badge variant="destructive">Disputed</Badge>}
            <span>
              {formatDay(payment.date)} · {METHOD_LABEL[payment.method]}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">Recorded by {payment.recordedBy}</p>
        </div>
      </header>

      {disputed && <p className="text-sm text-muted-foreground">This payment isn&apos;t counted in anyone&apos;s balance.</p>}

      <SettlementActions
        groupId={groupId}
        settlementId={settlementId}
        payerName={from.displayName}
        currency={currency}
        today={today}
        members={[...people.values()]}
        initial={{
          fromMemberId: from.memberId,
          toMemberId: to.memberId,
          amount: payment.amount.toString(),
          method: payment.method,
          date: payment.date,
          note: payment.note ?? "",
        }}
        canEdit={payment.canEdit}
        canDispute={payment.canDispute}
        canRecordAgain={!archived && disputed && involved}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {payment.note && (
            <section aria-labelledby="note" className={card}>
              <h2 id="note" className={heading}>
                Note
              </h2>
              <p className="mt-1 break-words whitespace-pre-wrap">{payment.note}</p>
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
                const { title, detail } = describeActivity(item);
                return (
                  <li key={item.id} className="text-sm">
                    <p className="font-medium">{title}</p>
                    {detail && <p className="text-muted-foreground">{detail}</p>}
                    <time dateTime={item.createdAt.toISOString()} className="text-xs text-muted-foreground">
                      {formatAgo(item.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="comments" className={card}>
            <h2 id="comments" className={`${heading} mb-3`}>
              Comments
            </h2>
            <CommentThread
              groupId={groupId}
              target={{ kind: "settlement", id: settlementId }}
              comments={commentViews(comments, member.id)}
              canComment={!archived}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
