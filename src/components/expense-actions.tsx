"use client";

import { Copy, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ExpenseSheet } from "@/components/expense-sheet";
import { NETWORK_ERROR } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import type { ExpenseFormValues } from "@/lib/validation";
import type { ActionResult } from "@/server/action";
import { deleteExpenseAction, restoreExpenseAction } from "@/server/actions/expenses";
import type { ExpenseFormData } from "@/server/expenses";

type Props = {
  /** Null in an archived group, where nothing can change, so there is nothing to offer. */
  data: ExpenseFormData | null;
  expenseId: string;
  version: number;
  /** The expense as the form holds it. */
  initial: ExpenseFormValues;
  /** Edit and Delete: the person who added it, or an admin. Duplicate is for any member. */
  canEdit: boolean;
};

const settle = (action: () => Promise<ActionResult<unknown>>) => action().catch(() => ({ ok: false as const, error: NETWORK_ERROR }));

const button = "h-11 flex-1 rounded-xl text-base sm:flex-none sm:px-5";

/** Edit, Duplicate and Delete for the expense page. Delete has no "are you sure?": the toast it leaves behind undoes it. */
export function ExpenseActions({ data, ...rest }: Props) {
  return data && <Actions data={data} {...rest} />;
}

function Actions({ data, expenseId, version, initial, canEdit }: Props & { data: ExpenseFormData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Kept apart from `open`, so the sheet doesn't change its title while it slides away.
  const [copy, setCopy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false); // set before any re-render, so a double tap sees it

  const show = (duplicate: boolean) => {
    setCopy(duplicate);
    setOpen(true);
  };

  async function undo() {
    const result = await settle(() => restoreExpenseAction({ expenseId }));
    if (!result.ok) return void toast.error(result.error);
    toast.success("Expense restored");
    router.refresh();
  }

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    // Away first: deleting refreshes the page you're on, and this one is about to stop existing (a flash of "not found").
    // Navigations and actions run in the order they're asked for, so the delete lands once the group's page is up.
    router.replace(`/groups/${data.groupId}`);
    const result = await settle(() => deleteExpenseAction({ expenseId }));
    if (!result.ok) {
      busy.current = false;
      setDeleting(false);
      return void toast.error(result.error);
    }
    // The toaster lives in the layout, so it outlasts this page.
    toast("Expense deleted", { duration: 8_000, action: { label: "Undo", onClick: () => void undo() } });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="outline" className={button} onClick={() => show(false)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
        <Button variant="outline" className={button} onClick={() => show(true)}>
          <Copy aria-hidden />
          Duplicate
        </Button>
        {canEdit && (
          <Button variant="destructive" className={button} disabled={deleting} onClick={() => void remove()}>
            {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            Delete
          </Button>
        )}
      </div>
      <ExpenseSheet
        data={data}
        open={open}
        onOpenChange={setOpen}
        mode={copy ? { kind: "add" } : { kind: "edit", expenseId, version }}
        // A copy is a new expense, so it is dated today rather than on the day of the one it was copied from.
        initial={copy ? { ...initial, date: data.today } : initial}
      />
    </>
  );
}
