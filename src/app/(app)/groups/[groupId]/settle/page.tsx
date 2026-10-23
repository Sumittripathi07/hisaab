import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { SettleCard, type SettleCardData } from "@/components/settle-card";
import { formatMoney } from "@/lib/money/format";
import { requireMember } from "@/server/authz";
import { getGroupBalances } from "@/server/balances";
import { ForbiddenError } from "@/server/errors";
import { requireOnboardedUser } from "@/server/session";
import { getSettleUp } from "@/server/settlements";

export const metadata: Metadata = { title: "Settle up · Hisaab" };

const back =
  "-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";

export default async function SettlePage({ params }: PageProps<"/groups/[groupId]/settle">) {
  const user = await requireOnboardedUser();
  const { groupId } = await params;
  // Missing, or not theirs: the same 404 either way.
  const { group } = await requireMember(user.id, groupId).catch((error) => {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  });
  const [{ currency, today, myMemberId, transfers }, { members }] = await Promise.all([
    getSettleUp(user.id, groupId),
    getGroupBalances(user.id, groupId),
  ]);
  // People who left are in the list while they still owe or are owed, so what's left can be settled with them.
  const sheetMembers = members.map((m) => ({ id: m.memberId, displayName: m.displayName, active: m.active }));

  const cards = await Promise.all(
    transfers.map(async (t) => {
      const role = !t.involvesMe ? "other" : t.from === myMemberId ? "pay" : "receive";
      const data: SettleCardData = {
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
        amountText: formatMoney(t.amount, currency),
        fromName: t.fromName,
        toName: t.toName,
        role,
        canRecord: t.canRecord,
        upi: t.upi,
        // What the viewer pays, so a second phone can scan it.
        qr: role === "pay" && t.canRecord && t.upi ? await QRCode.toDataURL(t.upi.link, { margin: 1, width: 224 }) : null,
      };
      return data;
    }),
  );
  const mine = cards.filter((c) => c.role !== "other");
  const others = cards.filter((c) => c.role === "other");
  const card = (c: SettleCardData) => (
    <li key={`${c.from}-${c.to}`}>
      <SettleCard groupId={groupId} currency={currency} today={today} members={sheetMembers} transfer={c} />
    </li>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href={`/groups/${groupId}?tab=balances`} className={back}>
          <ChevronLeft className="size-4" aria-hidden />
          {group.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Settle up</h1>
      </div>

      {group.archivedAt && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-400/10">
          This group is archived, so payments can&apos;t be recorded in it.
        </p>
      )}

      {cards.length === 0 && (
        <div className="flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center sm:py-16">
          <p className="text-2xl font-semibold tracking-tight">All settled up 🎉</p>
          <p className="mt-1 max-w-sm text-balance text-muted-foreground">Nobody in {group.name} owes anyone anything.</p>
        </div>
      )}

      {mine.length > 0 && (
        <section aria-labelledby="yours" className="space-y-3">
          <h2 id="yours" className="text-lg font-semibold tracking-tight">
            Your payments
          </h2>
          <ul className="space-y-3">{mine.map(card)}</ul>
        </section>
      )}

      {others.length > 0 && (
        <section aria-labelledby="others" className="space-y-3">
          <h2 id="others" className="text-lg font-semibold tracking-tight">
            Between others
          </h2>
          <ul className="space-y-3">{others.map(card)}</ul>
        </section>
      )}
    </div>
  );
}
