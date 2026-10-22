import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard · Hisaab" };

// Placeholder: groups arrive in a later task.
export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const firstName = user.name.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: user.timezone }).format(new Date());

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Hi, {firstName} <span aria-hidden>👋</span>
        </h1>
      </div>
      <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">Your groups will show up here.</div>
    </div>
  );
}
