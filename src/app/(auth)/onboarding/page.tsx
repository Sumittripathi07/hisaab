import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currencyOptions } from "@/lib/currency";
import { safeCallback } from "@/lib/safe-redirect";
import { requireUser } from "@/server/session";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Welcome · Hisaab" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const callbackURL = safeCallback(first((await searchParams).callbackURL));
  if (user.onboardedAt) redirect(callbackURL);

  return (
    // overflow-x-clip: a step sliding in must not make the page scroll sideways on a phone.
    <main className="flex min-h-dvh flex-col items-center overflow-x-clip bg-[radial-gradient(70%_40%_at_50%_0%,color-mix(in_oklch,var(--color-emerald-500)_12%,transparent),transparent)] px-4 pt-6 pb-10 sm:justify-center sm:py-12">
      <OnboardingFlow
        user={{ name: user.name, email: user.email, image: user.image, timezone: user.timezone }}
        currencies={currencyOptions()}
        callbackURL={callbackURL}
        // Someone headed somewhere specific (an invite link) goes straight there; everyone else gets the welcome step.
        showWelcome={callbackURL === "/dashboard"}
      />
    </main>
  );
}
