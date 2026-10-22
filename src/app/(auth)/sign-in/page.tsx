import type { Metadata } from "next";
import { safeCallback } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Hisaab" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const callbackURL = safeCallback(first(params.callbackURL));
  const error = first(params.error);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(70%_45%_at_50%_0%,color-mix(in_oklch,var(--color-emerald-500)_14%,transparent),transparent)] px-4 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">
            Hisaab<span className="text-emerald-500">.</span>
          </h1>
          <p className="mt-2 text-balance text-muted-foreground">Split expenses. Settle up. Stay friends.</p>
        </header>
        <SignInForm callbackURL={callbackURL} error={error} />
      </div>
    </main>
  );
}
