"use client";

import { LoaderCircle, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { NETWORK_ERROR } from "@/components/profile-fields";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const THEMES = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const subscribeNever = () => () => {};

/** System / Light / Dark as a segmented control, built on native radios so arrow keys and screen readers just work. */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  // The saved theme only exists in the browser; render nothing selected on the server so hydration matches.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {THEMES.map(({ value, label, Icon }) => (
          <label
            key={value}
            className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors select-none hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:has-checked:bg-input/50"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={hydrated && theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SignOutOthersButton({ others }: { others: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function signOutOthers() {
    setPending(true);
    const { error } = await authClient.revokeOtherSessions().catch(() => ({ error: { message: NETWORK_ERROR } }));
    setPending(false);
    if (error) return void toast.error(error.message || NETWORK_ERROR);
    setOpen(false);
    toast.success(others === 1 ? "Signed out of 1 other device" : `Signed out of ${others} other devices`);
    router.refresh();
  }

  if (others < 1) return <p className="text-sm text-muted-foreground">This is the only device you&apos;re signed in on.</p>;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="outline" className="h-11 w-full rounded-xl sm:w-auto" />}>
        Sign out other devices
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of {others === 1 ? "1 other device" : `${others} other devices`}?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll stay signed in here. Anywhere else, you&apos;ll need to sign in again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={signOutOthers} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {pending ? "Signing out…" : "Sign out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const { error } = await authClient.signOut().catch(() => ({ error: { message: NETWORK_ERROR } }));
    if (error) {
      setPending(false);
      return void toast.error(error.message || NETWORK_ERROR);
    }
    // A full page load, so nothing from the signed-in session lingers in the client.
    window.location.replace("/sign-in");
  }

  return (
    <Button variant="destructive" className="h-11 w-full rounded-xl sm:w-auto" onClick={signOut} disabled={pending}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
