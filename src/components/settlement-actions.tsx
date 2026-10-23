"use client";

import { CircleX, LoaderCircle, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/group-actions";
import { settle } from "@/components/profile-fields";
import { SettlementSheet, type SettlementValues, type SheetMember } from "@/components/settlement-sheet";
import { Button } from "@/components/ui/button";
import { deleteSettlementAction, disputeSettlementAction, restoreSettlementAction } from "@/server/actions/settlements";

type Props = {
  groupId: string;
  settlementId: string;
  /** Named in the dispute's confirm: the payer is the one who gets told. */
  payerName: string;
  currency: string;
  today: string;
  /** Everyone a payment can be between. */
  members: SheetMember[];
  /** The payment as the form holds it. */
  initial: SettlementValues;
  /** Edit and Delete: the person who recorded it, or an admin. */
  canEdit: boolean;
  /** The payee, for a payment that still counts. */
  canDispute: boolean;
  /** A disputed payment can be recorded again by whoever paid or was paid. */
  canRecordAgain: boolean;
};

const button = "h-11 flex-1 rounded-xl text-base sm:flex-none sm:px-5";

/** "I didn't receive this", Edit, Delete and "Record it again" for a payment's page. Delete has no "are you sure?": the toast it leaves behind undoes it. */
export function SettlementActions({ groupId, settlementId, payerName, currency, today, members, initial, canEdit, canDispute, canRecordAgain }: Props) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Kept apart from `sheetOpen`, so the sheet doesn't change its title while it slides away.
  const [again, setAgain] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false); // set before any re-render, so a double tap sees it

  const show = (recordAgain: boolean) => {
    setAgain(recordAgain);
    setSheetOpen(true);
  };

  async function undo() {
    const result = await settle(() => restoreSettlementAction({ settlementId }));
    if (!result.ok) return void toast.error(result.error);
    toast.success("Payment restored");
    router.refresh();
  }

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    // Away first: deleting refreshes the page you're on, and this one is about to stop existing (a flash of "not found").
    // Navigations and actions run in the order they're asked for, so the delete lands once the balances are up.
    router.replace(`/groups/${groupId}?tab=balances`);
    const result = await settle(() => deleteSettlementAction({ settlementId }));
    if (!result.ok) {
      busy.current = false;
      setDeleting(false);
      return void toast.error(result.error);
    }
    // The toaster lives in the layout, so it outlasts this page.
    toast("Payment deleted", { duration: 8_000, action: { label: "Undo", onClick: () => void undo() } });
  }

  if (!canEdit && !canDispute && !canRecordAgain) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canDispute && (
          <Button variant="outline" className={button} onClick={() => setDisputeOpen(true)}>
            <CircleX aria-hidden />
            I didn&apos;t receive this
          </Button>
        )}
        {canRecordAgain && (
          <Button className={button} onClick={() => show(true)}>
            <RotateCcw aria-hidden />
            Record it again
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" className={button} onClick={() => show(false)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
        {canEdit && (
          <Button variant="destructive" className={button} disabled={deleting} onClick={() => void remove()}>
            {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            Delete
          </Button>
        )}
      </div>

      {canDispute && (
        <ConfirmDialog
          open={disputeOpen}
          onOpenChange={setDisputeOpen}
          title="Mark as not received?"
          description={`It stops counting toward balances, and ${payerName} will see it's disputed.`}
          confirmLabel="Not received"
          onConfirm={async () => {
            const result = await disputeSettlementAction({ settlementId });
            if (result.ok) {
              toast.success("Marked as not received");
              router.refresh();
            }
            return result;
          }}
        />
      )}

      {(canEdit || canRecordAgain) && (
        <SettlementSheet
          groupId={groupId}
          members={members}
          currency={currency}
          today={today}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={again ? { kind: "record" } : { kind: "edit", settlementId }}
          // Recording it again is a new payment, so it is dated today rather than on the day of the one that was disputed.
          initial={again ? { ...initial, date: today } : initial}
        />
      )}
    </>
  );
}
