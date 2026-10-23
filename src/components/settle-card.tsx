"use client";

import { Copy, HandCoins, LoaderCircle, QrCode, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { copyLink } from "@/components/invite-sheet";
import { settle } from "@/components/profile-fields";
import { SettlementSheet, type SheetMember } from "@/components/settlement-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import type { MinorString } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { recordSettlementAction } from "@/server/actions/settlements";

/** One suggested payment, as text and ids: amounts arrive formatted, since a bigint can't cross to the browser. */
export type SettleCardData = {
  from: string;
  to: string;
  amount: MinorString;
  amountText: string;
  fromName: string;
  toName: string;
  /** "pay": the viewer owes it. "receive": they're owed it. "other": it's between two other people. */
  role: "pay" | "receive" | "other";
  canRecord: boolean;
  upi: { link: string; upiId: string } | null;
  /** The UPI link as a QR code image (a data: URL), made on the server. Only for what the viewer pays. */
  qr: string | null;
};

type Props = {
  groupId: string;
  currency: string;
  today: string;
  members: SheetMember[];
  transfer: SettleCardData;
};

const TITLE = {
  pay: (t: SettleCardData) => `You pay ${t.toName}`,
  receive: (t: SettleCardData) => `${t.fromName} pays you`,
  other: (t: SettleCardData) => `${t.fromName} pays ${t.toName}`,
};

const action = "h-11 rounded-xl text-base";

/** A payment to make or expect. Paying takes two taps: "Pay ₹850 via UPI" in the UPI app, then "Mark as paid". */
export function SettleCard({ groupId, currency, today, members, transfer: t }: Props) {
  const router = useRouter();
  const qrId = useId();
  const busy = useRef(false);
  const [recording, setRecording] = useState(false);
  // Pending until the page has the new payment in it, not just until the server has it.
  const [refreshing, refresh] = useTransition();
  // After the pay link is tapped, asks whether it went through.
  const [tapped, setTapped] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = recording || refreshing;

  async function markPaid() {
    if (busy.current) return;
    busy.current = true; // a ref, so a double tap in the same moment sees it before any re-render
    setRecording(true);
    const result = await settle(() =>
      recordSettlementAction({ groupId, fromMemberId: t.from, toMemberId: t.to, amount: t.amount, method: "UPI", date: today, note: "" }),
    );
    busy.current = false;
    setRecording(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Payment recorded");
    navigator.vibrate?.(10);
    refresh(() => router.refresh());
  }

  const upi = t.role === "pay" && t.canRecord ? t.upi : null;

  const markPaidButton = (variant: "default" | "secondary", className?: string) => (
    <Button variant={variant} className={cn(action, className)} disabled={pending} onClick={() => void markPaid()}>
      {pending && <LoaderCircle className="animate-spin" aria-hidden />}
      Mark as paid
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 text-card-foreground md:flex-row md:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-xl font-semibold tracking-tight break-words">
          {`${TITLE[t.role](t)} `}
          <span className="tabular-nums">{t.amountText}</span>
        </p>

        {upi && (
          <>
            <a
              href={upi.link}
              onClick={() => setTapped(true)}
              className={cn(buttonVariants(), "h-12 w-full rounded-xl text-base shadow-sm shadow-primary/20")}
            >
              <Smartphone aria-hidden />
              Pay {t.amountText} via UPI
            </a>
            {tapped && (
              <div className="space-y-2 rounded-2xl bg-muted/60 p-3">
                <p className="font-medium">Did it go through?</p>
                <div className="flex gap-2">
                  {markPaidButton("default", "flex-1")}
                  <Button variant="outline" className={cn(action, "px-5")} disabled={pending} onClick={() => setTapped(false)}>
                    Not yet
                  </Button>
                </div>
              </div>
            )}
            {/* Desktop users never tap the link, and a failed payment may need the ID again, so this is always here. */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className={cn(action, tapped && "col-span-2")} onClick={() => void copyLink(upi.upiId, "UPI ID")}>
                <Copy aria-hidden />
                Copy UPI ID
              </Button>
              {!tapped && markPaidButton("secondary")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t.toName}&apos;s UPI ID: <span className="font-medium break-all text-foreground">{upi.upiId}</span>
            </p>
          </>
        )}

        {t.canRecord && (
          <Button variant="outline" className={cn(action, "w-full sm:w-fit sm:px-5")} onClick={() => setSheetOpen(true)}>
            <HandCoins aria-hidden />
            Record a payment
          </Button>
        )}
      </div>

      {t.qr && (
        <div className="md:shrink-0">
          {/* Phones keep it out of the way; from 768px it sits beside the buttons. */}
          <Button
            variant="ghost"
            className={cn(action, "w-full md:hidden")}
            aria-expanded={qrOpen}
            aria-controls={qrId}
            onClick={() => setQrOpen((open) => !open)}
          >
            <QrCode aria-hidden />
            {qrOpen ? "Hide QR code" : "Show QR code"}
          </Button>
          <div id={qrId} className={cn("flex-col items-center gap-2 pt-2 text-center md:flex md:pt-0", qrOpen ? "flex" : "hidden")}>
            {/* A data: URL made on the server; next/image has nothing to optimise. White in both themes, so it scans. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.qr}
              alt={`QR code to pay ${t.toName} ${t.amountText} by UPI`}
              width={176}
              height={176}
              className="size-44 rounded-xl bg-white p-2"
            />
            <p className="max-w-44 text-sm text-muted-foreground">Scan with a UPI app on another phone.</p>
          </div>
        </div>
      )}

      {t.canRecord && (
        <SettlementSheet
          groupId={groupId}
          members={members}
          currency={currency}
          today={today}
          mode={{ kind: "record" }}
          initial={{ fromMemberId: t.from, toMemberId: t.to, amount: t.amount, method: upi ? "UPI" : "CASH", date: today, note: "" }}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </div>
  );
}
