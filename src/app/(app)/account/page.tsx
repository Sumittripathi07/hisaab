import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { userAgentFromString } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { currencyOptions } from "@/lib/currency";
import { listActiveSessions, requireOnboardedUser } from "@/server/session";
import { SignOutButton, SignOutOthersButton, ThemePicker } from "./account-controls";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Account · Hisaab" };

const OS_NAMES: Record<string, string> = { "Mac OS": "macOS", "Chromium OS": "ChromeOS" };

/** "Chrome on macOS", from a stored user-agent string. */
function describeDevice(ua: string | null) {
  const { browser, os, device } = userAgentFromString(ua ?? "");
  const browserName = browser.name?.replace(/^Mobile /, "");
  const osName = os.name && (OS_NAMES[os.name] ?? os.name);
  const label = browserName && osName ? `${browserName} on ${osName}` : (browserName ?? osName ?? "Unknown device");
  const Icon = device.type === "mobile" ? Smartphone : device.type === "tablet" ? Tablet : Monitor;
  return { label, Icon };
}

const days = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** Sessions refresh about once a day, so day precision is all we honestly know. */
function lastActive(date: Date) {
  const ago = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return ago < 1 ? "Active today" : `Active ${days.format(-ago, "day")}`;
}

export default async function AccountPage() {
  const [user, current] = await Promise.all([
    requireOnboardedUser("/account"),
    auth.api.getSession({ headers: await headers() }),
  ]);
  const sessions = await listActiveSessions(user.id);
  // This device first.
  sessions.sort((a, b) => Number(b.id === current?.session.id) - Number(a.id === current?.session.id));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Account</h1>
        <p className="mt-1 text-muted-foreground">Your profile, how Hisaab looks, and where you&apos;re signed in.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How friends see you, and how they pay you back.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm user={user} currencies={currencyOptions()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>System follows your device&apos;s light or dark setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemePicker />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>Anywhere you&apos;re signed in to Hisaab right now.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-xl border">
            {sessions.map((s) => {
              const { label, Icon } = describeDevice(s.userAgent);
              const isCurrent = s.id === current?.session.id;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{label}</p>
                    <p className="text-sm text-muted-foreground">{isCurrent ? "You're using it now" : lastActive(s.updatedAt)}</p>
                  </div>
                  {isCurrent && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">This device</span>
                  )}
                </li>
              );
            })}
          </ul>
          <SignOutOthersButton others={sessions.length - 1} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium break-all text-foreground">{user.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
