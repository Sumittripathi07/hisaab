import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { headline, memberLine, TONE_CLASS } from "@/lib/balance-text";
import { formatDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money/format";
import { METHOD_LABEL } from "@/lib/settlement-methods";
import { cn } from "@/lib/utils";
import type { GroupBalances } from "@/server/balances";
import type { SettlementView } from "@/server/settlements";

type Props = {
  groupId: string;
  balances: GroupBalances;
  /** Newest first, disputed ones included. */
  settlements: SettlementView[];
  archived: boolean;
};

const row = "flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-card-foreground shadow-xs";
const heading = "px-1 text-sm font-semibold text-muted-foreground";

/** The Balances tab: where the viewer stands, what everyone owes, who should pay whom, and the latest payments. Server-rendered: amounts are bigint. */
export function BalancePanel({ groupId, balances, settlements, archived }: Props) {
  const { currency, members, transfers, myNet, settled, simplified } = balances;
  const money = (amount: bigint) => formatMoney(amount, currency);
  const names = new Map(members.map((m) => [m.memberId, m.displayName]));
  const mine = headline(myNet, currency);

  return (
    <div className="space-y-6">
      <section aria-label="Your balance" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border bg-card p-5 text-card-foreground">
        <p className={cn("min-w-0 flex-1 text-2xl font-semibold tracking-tight tabular-nums", settled ? "" : TONE_CLASS[mine.tone])}>
          {settled ? "All settled up 🎉" : mine.text}
        </p>
        {!archived && (
          <Link
            href={`/groups/${groupId}/settle`}
            className={cn(buttonVariants(), "h-11 w-full rounded-xl px-6 text-base shadow-sm shadow-primary/20 sm:w-auto")}
          >
            Settle up
          </Link>
        )}
      </section>

      <section aria-labelledby="members-balances" className="space-y-2">
        <h3 id="members-balances" className={heading}>
          Everyone
        </h3>
        <ul className="divide-y rounded-2xl border bg-card px-4 text-card-foreground shadow-xs">
          {members.map((m) => {
            const line = memberLine(m.net, currency);
            return (
              <li key={m.memberId} className="flex min-h-14 items-center gap-3 py-2">
                <UserAvatar name={m.displayName} image={m.image} />
                <span className="min-w-0 flex-1 truncate font-medium">{m.active ? m.displayName : `${m.displayName} (left)`}</span>
                {/* Words as well as colour. */}
                <span className={cn("shrink-0 text-sm font-medium tabular-nums", TONE_CLASS[line.tone])}>{line.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {transfers.length > 0 && (
        <section aria-labelledby="suggested-payments" className="space-y-2">
          <div className="px-1">
            <h3 id="suggested-payments" className="text-sm font-semibold text-muted-foreground">
              Suggested payments
            </h3>
            <p className="text-sm text-muted-foreground">
              {simplified ? `Simplified to ${transfers.length === 1 ? "1 payment" : `${transfers.length} payments`}` : "Showing who owes whom directly"}
            </p>
          </div>
          <ul className="space-y-2">
            {transfers.map((t) => (
              <li key={`${t.from}-${t.to}`} className={row}>
                <p className="min-w-0 flex-1 break-words">
                  {`${names.get(t.from) ?? "Someone"} pays ${names.get(t.to) ?? "someone"} `}
                  <span className="font-semibold tabular-nums">{money(t.amount)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settlements.length > 0 && (
        <section aria-labelledby="recent-payments" className="space-y-2">
          <h3 id="recent-payments" className={heading}>
            Recent payments
          </h3>
          <ul className="space-y-2">
            {settlements.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/groups/${groupId}/settlements/${s.id}`}
                  className={cn(
                    row,
                    "outline-none transition-[scale,box-shadow,border-color] duration-200 ease-out hover:border-foreground/15 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{`${s.from.displayName} paid ${s.to.displayName} ${formatMoney(s.amount, s.currency)}`}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {formatDay(s.date)} · {METHOD_LABEL[s.method]}
                    </span>
                  </span>
                  {s.status === "DISPUTED" && <Badge variant="destructive">Disputed</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
