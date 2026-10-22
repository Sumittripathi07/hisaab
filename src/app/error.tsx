"use client";

import { CloudOff, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/join-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Something broke outside the app's shell: the shell itself ((app)/layout.tsx, which (app)/error.tsx can't catch, since
 * an error file never wraps the layout beside it), sign-in, onboarding, or an invite or claim link.
 */
export default function RootError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Shell>
      <span aria-hidden className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CloudOff className="size-7" />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">Something went wrong</h1>
      <p className="mt-2 text-balance text-muted-foreground">That&apos;s on us, not you. Try again in a moment.</p>
      <Button className="mt-8 h-12 w-full rounded-xl text-base shadow-sm shadow-primary/20" onClick={() => retry()}>
        <RotateCcw aria-hidden />
        Try again
      </Button>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "mt-2 h-12 w-full rounded-xl text-base")}>
        Go to dashboard
      </Link>
    </Shell>
  );
}
