"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CreateGroupButton } from "@/components/create-group-sheet";
import { useOpenAddExpense } from "@/components/expense-sheet";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";

/** Phones only: floats above the bottom nav. */
const fab =
  "fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg shadow-primary/30 transition-transform duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 md:hidden";

const icon = <Plus className="size-6" strokeWidth={2.5} aria-hidden />;

/** A group's own page puts its + button there; it opens the sheet in place. */
export function GroupPageFab() {
  const openSheet = useOpenAddExpense();
  return (
    <Button aria-label="Add expense" className={fab} onClick={() => openSheet?.()}>
      {icon}
    </Button>
  );
}

type Group = { id: string; name: string; emoji: string };

/**
 * The + above the bottom nav, on every page but a group's own (which has the one above). With no group yet it starts one;
 * otherwise it asks which group the expense is for and goes there with the sheet open.
 */
export function AddExpenseFab({ groups }: { groups: Group[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (/^\/groups\/[^/]+\/?$/.test(pathname)) return null;
  if (!groups.length) {
    return (
      <CreateGroupButton aria-label="Create a group" className={fab}>
        {icon}
      </CreateGroupButton>
    );
  }
  return (
    <>
      <Button aria-label="Add expense" className={fab} onClick={() => setOpen(true)}>
        {icon}
      </Button>
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Add an expense to…" description="Pick the group it belongs to.">
        <ul className="flex flex-col gap-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}?add=1`}
                onClick={() => setOpen(false)}
                className="flex min-h-14 items-center gap-3 rounded-2xl px-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted motion-reduce:transition-none"
              >
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                  {group.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </ResponsiveSheet>
    </>
  );
}
