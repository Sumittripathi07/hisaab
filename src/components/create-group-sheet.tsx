"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { GroupForm } from "@/components/group-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { CurrencyOptions } from "@/lib/currency";
import type { GroupInput } from "@/lib/validation";
import { createGroupAction } from "@/server/actions/groups";

const SetOpen = createContext<(open: boolean) => void>(() => {});

const DESKTOP = "(min-width: 768px)";
const subscribe = (onChange: () => void) => {
  const query = matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const TITLE = "New group";
const DESCRIPTION = "Name it and give it a look. You can add people next.";

/**
 * Holds the one create-group sheet for the whole app: a bottom drawer on phones, a dialog from 768px up.
 * Anything inside opens it with <CreateGroupButton>, or on arrival with <OpenCreateGroupOnLoad>.
 */
export function CreateGroupProvider({ currencies, defaultCurrency, children }: {
  currencies: CurrencyOptions;
  defaultCurrency: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribe, () => matchMedia(DESKTOP).matches, () => false);

  async function create(values: GroupInput) {
    const result = await createGroupAction(values);
    if (result.ok) {
      toast.success("Group created");
      navigator.vibrate?.(10);
      router.push(`/groups/${result.data.id}`);
      setOpen(false);
    }
    return result;
  }

  // Both open with the name field focused (the drawer would otherwise focus itself).
  const focusName = () => document.getElementById("group-name");
  const form = (
    <GroupForm currencies={currencies} defaultValues={{ baseCurrency: defaultCurrency }} submitLabel="Create group" onSubmit={create} />
  );

  return (
    <SetOpen value={setOpen}>
      {children}
      {desktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent initialFocus={focusName} className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
            <DialogHeader className="gap-1 p-6 pb-4">
              <DialogTitle className="text-xl font-semibold">{TITLE}</DialogTitle>
              <DialogDescription>{DESCRIPTION}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pt-1">{form}</div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
          <DrawerContent initialFocus={focusName} className="rounded-t-3xl">
            <DrawerHeader className="gap-1 pb-4">
              <DrawerTitle className="text-xl font-semibold">{TITLE}</DrawerTitle>
              <DrawerDescription>{DESCRIPTION}</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-1">{form}</div>
          </DrawerContent>
        </Drawer>
      )}
    </SetOpen>
  );
}

/** A button that opens the create-group sheet. Takes every Button prop. */
export function CreateGroupButton(props: React.ComponentProps<typeof Button>) {
  const setOpen = use(SetOpen);
  return <Button {...props} onClick={() => setOpen(true)} />;
}

/** Opens the sheet once the page has loaded, as a tap would; for /dashboard?new=1, which it then drops from the URL. */
export function OpenCreateGroupOnLoad() {
  const setOpen = use(SetOpen);
  useEffect(() => {
    setOpen(true);
    // A one-shot trigger: neither Back nor a refresh should reopen the sheet.
    window.history.replaceState(null, "", "/dashboard");
  }, [setOpen]);
  return null;
}
