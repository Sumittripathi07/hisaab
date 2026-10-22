"use client";

import { LinkIcon, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { NETWORK_ERROR } from "@/components/profile-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { groupTint } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action";

const bigButton = "h-12 w-full rounded-xl text-base";

/** The page around a join or claim card: centred, with the brand above it. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(70%_45%_at_50%_0%,color-mix(in_oklch,var(--color-emerald-500)_14%,transparent),transparent)] px-4 py-10">
      <p className="mb-6 text-2xl font-semibold tracking-tight">
        Hisaab<span className="text-emerald-500">.</span>
      </p>
      <div className="w-full max-w-sm rounded-3xl border bg-card p-6 text-center text-card-foreground shadow-sm sm:p-8">{children}</div>
    </main>
  );
}

/**
 * An invitation: the group, a line about it, and one "Join group" button that runs `join` (a server action bound to
 * the invite code or claim token), then opens the group. Nothing is joined until the button is pressed.
 */
export function JoinCard({ group, kicker, title, detail, join }: {
  group: { name: string; emoji: string; color: string };
  kicker?: string;
  title: string;
  detail: string;
  join: () => Promise<ActionResult<{ groupId: string }>>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onJoin() {
    setPending(true);
    setError(undefined);
    const result = await join().catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    if (!result.ok) {
      setPending(false);
      return setError(result.error);
    }
    toast.success(`You're in ${group.name}`);
    navigator.vibrate?.(10);
    router.replace(`/groups/${result.data.groupId}`); // stays "Joining…" until the group opens; Back skips this page
  }

  return (
    <Shell>
      <span
        aria-hidden
        className={cn("mx-auto flex size-20 items-center justify-center rounded-3xl text-5xl shadow-sm", groupTint(group.color).tile)}
      >
        {group.emoji}
      </span>
      {kicker && <p className="mt-6 text-sm font-medium text-muted-foreground">{kicker}</p>}
      <h1 className={cn("text-2xl font-semibold tracking-tight text-balance break-words", kicker ? "mt-1" : "mt-6")}>{title}</h1>
      <p className="mt-2 text-balance text-muted-foreground">{detail}</p>
      <Button className={cn(bigButton, "mt-8 shadow-sm shadow-primary/20")} onClick={onJoin} disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden />}
        {pending ? "Joining…" : "Join group"}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}

/** Why a join or claim link can't be used, in the service's own words, with a way out. */
export function JoinError({ message, email }: { message: string; email: string }) {
  return (
    <Shell>
      <span aria-hidden className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <LinkIcon className="size-7" />
      </span>
      <h1 className="mt-6 text-xl font-semibold tracking-tight text-balance">{message}</h1>
      {/* Which account is signed in is often the whole story ("sent to a different email address"). */}
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as <span className="font-medium break-all text-foreground">{email}</span>
      </p>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), bigButton, "mt-8")}>
        Go to dashboard
      </Link>
    </Shell>
  );
}
