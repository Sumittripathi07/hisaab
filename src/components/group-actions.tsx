"use client";

import { Archive, ArchiveRestore, LoaderCircle, LogOut, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GroupForm } from "@/components/group-form";
import { settle } from "@/components/profile-fields";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CurrencyOptions } from "@/lib/currency";
import type { GroupInput } from "@/lib/validation";
import type { ActionResult } from "@/server/action";
import { archiveGroupAction, unarchiveGroupAction, updateGroupAction } from "@/server/actions/groups";
import { leaveGroupAction, rotateInviteCodeAction } from "@/server/actions/members";

type Action = () => Promise<ActionResult<unknown>>;
const sectionButton = "h-11 w-full rounded-xl sm:w-auto";

/**
 * "Are you sure?" for an action. Runs `onConfirm` (which also says what happened), closing when it worked and showing
 * the error in place when it didn't. Focus goes back to whatever opened it, or to `finalFocus`.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive = true, onConfirm, finalFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: Action;
  finalFocus?: React.ComponentProps<typeof AlertDialogContent>["finalFocus"];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setPending(true);
    setError(undefined);
    const result = await settle(onConfirm);
    setPending(false);
    if (result.ok) onOpenChange(false);
    else setError(result.error);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The group's name, look and settings, saved in place. */
export function GroupDetailsForm({ groupId, defaultValues, currencies, currencyLocked }: {
  groupId: string;
  defaultValues: GroupInput;
  currencies: CurrencyOptions;
  currencyLocked: boolean;
}) {
  return (
    <GroupForm
      variant="inline"
      currencies={currencies}
      currencyLocked={currencyLocked}
      defaultValues={defaultValues}
      submitLabel="Save changes"
      onSubmit={async (values) => {
        const result = await updateGroupAction({ groupId, ...values });
        if (result.ok) toast.success("Changes saved");
        return result;
      }}
    />
  );
}

/**
 * "Archive group" (after a confirm) or "Unarchive", as one button that stays put when the state flips, so whoever pressed
 * it keeps their place on the page.
 */
export function ArchiveToggle({ groupId, groupName, archived, className }: {
  groupId: string;
  groupName: string;
  archived: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function unarchive() {
    if (pending) return;
    setPending(true);
    const result = await settle(() => unarchiveGroupAction({ groupId }));
    setPending(false);
    if (result.ok) toast.success("Group unarchived");
    else toast.error(result.error);
  }

  return (
    <>
      {/* aria-disabled rather than disabled while saving: a disabled button would drop the keyboard focus. */}
      <Button variant="outline" className={className ?? sectionButton} onClick={archived ? unarchive : () => setOpen(true)} aria-disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? "Unarchive" : "Archive group"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive ${groupName}?`}
        description="Everything in it is kept, and everyone can still see it under Archived. Nothing can be changed until it's unarchived."
        confirmLabel="Archive"
        destructive={false}
        onConfirm={async () => {
          const result = await archiveGroupAction({ groupId });
          if (result.ok) toast.success("Group archived");
          return result;
        }}
      />
    </>
  );
}

export function ResetInviteLink({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className={sectionButton} onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Reset invite link
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reset the invite link?"
        description="The old link will stop working."
        confirmLabel="Reset link"
        onConfirm={async () => {
          const result = await rotateInviteCodeAction({ groupId });
          if (result.ok) toast.success("Invite link reset");
          return result;
        }}
      />
    </>
  );
}

/** "Leave group", after a confirm. The owner can't leave, so gets `ownerHint` (how to hand the group over) instead. */
export function LeaveGroup({ groupId, groupName, ownerHint }: { groupId: string; groupName: string; ownerHint?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (ownerHint) return <p className="text-sm text-muted-foreground">{ownerHint}</p>;

  return (
    <>
      <Button variant="destructive" className={sectionButton} onClick={() => setOpen(true)}>
        <LogOut aria-hidden />
        Leave group
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Leave ${groupName}?`}
        description="You'll stop seeing the group. To come back, you'll need its invite link again."
        confirmLabel="Leave"
        onConfirm={async () => {
          const result = await leaveGroupAction({ groupId });
          if (result.ok) {
            toast.success(`You left ${groupName}`);
            router.replace("/dashboard");
          }
          return result;
        }}
      />
    </>
  );
}
