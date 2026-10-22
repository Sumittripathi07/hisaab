"use client";

import { CloudOff, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Something broke while loading a page. Shown inside the app's shell, so the nav still works. */
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
      <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CloudOff className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-balance text-muted-foreground">
        That&apos;s on us, not you. Try again, or head back to your dashboard.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button className="h-11 rounded-xl px-4" onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
