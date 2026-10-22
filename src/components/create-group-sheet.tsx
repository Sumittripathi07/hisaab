"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GroupForm } from "@/components/group-form";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import type { CurrencyOptions } from "@/lib/currency";
import type { GroupInput } from "@/lib/validation";
import { createGroupAction } from "@/server/actions/groups";

const SetOpen = createContext<(open: boolean) => void>(() => {});

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
  const nameRef = useRef<HTMLInputElement>(null);

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

  return (
    <SetOpen value={setOpen}>
      {children}
      {/* Opens with the name field focused. */}
      <ResponsiveSheet open={open} onOpenChange={setOpen} title={TITLE} description={DESCRIPTION} initialFocus={nameRef}>
        <GroupForm
          currencies={currencies}
          defaultValues={{ baseCurrency: defaultCurrency }}
          submitLabel="Create group"
          onSubmit={create}
          nameInputRef={nameRef}
        />
      </ResponsiveSheet>
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
  const router = useRouter();
  useEffect(() => {
    setOpen(true);
    // A one-shot trigger: neither Back nor a refresh should reopen the sheet. Through the router, not
    // history.replaceState, which keeps this page's tree (with this component in it) for Back to replay.
    router.replace("/dashboard", { scroll: false });
  }, [setOpen, router]);
  return null;
}
