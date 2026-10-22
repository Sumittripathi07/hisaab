import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/join-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Page not found · Hisaab" };

/** Any unknown address, and any group the viewer can't see (missing and not theirs look the same). */
export default function NotFound() {
  return (
    <Shell>
      <span aria-hidden className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Compass className="size-7" />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-balance text-muted-foreground">
        The link may be old or mistyped, or it&apos;s for a group you&apos;re not in. Your groups are all on your dashboard.
      </p>
      <Link href="/dashboard" className={cn(buttonVariants(), "mt-8 h-12 w-full rounded-xl text-base shadow-sm shadow-primary/20")}>
        Go to dashboard
      </Link>
    </Shell>
  );
}
