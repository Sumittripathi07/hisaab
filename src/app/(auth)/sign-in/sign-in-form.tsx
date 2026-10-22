"use client";

import { LoaderCircle, MailCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const EXPIRED = "That sign-in link has expired or was already used. Send yourself a new one below.";
const GOOGLE_CANCELLED = "Google sign-in was cancelled. Try again, or email yourself a sign-in link below.";
const RATE_LIMITED = "Too many links requested. Try again in an hour, or continue with Google.";
const FAILED = "Something went wrong. Check your connection and try again.";

/** The banner for an `error` query param Better Auth sent us back with. */
const bannerFor = (error: string | undefined) =>
  !error ? null : error === "access_denied" ? GOOGLE_CANCELLED : EXPIRED;

export function SignInForm({ callbackURL, error }: { callbackURL: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [banner, setBanner] = useState(bannerFor(error));

  // Where Better Auth sends people on failure. It keeps the callback, so a retry still ends up in the right place.
  const errorCallbackURL = `/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`;
  // First-time users go through onboarding, which then continues to the callback.
  const newUserCallbackURL = `/onboarding?callbackURL=${encodeURIComponent(callbackURL)}`;
  const urls = { callbackURL, newUserCallbackURL, errorCallbackURL };

  async function google() {
    setBanner(null);
    setPending("google");
    try {
      // On success the browser is sent to Google, so `pending` stays set until the page unloads.
      const res = await authClient.signIn.social({ provider: "google", ...urls });
      if (res.error) throw new Error(res.error.message);
    } catch {
      setBanner(FAILED);
      setPending(null);
    }
  }

  async function emailLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    setBanner(null);
    setPending("email");
    try {
      const res = await authClient.signIn.magicLink({ email: address, ...urls });
      if (res.error) setBanner(res.error.status === 429 ? RATE_LIMITED : FAILED);
      else setSentTo(address);
    } catch {
      setBanner(FAILED);
    }
    setPending(null);
  }

  if (sentTo) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">Check your inbox</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a sign-in link to
          <span className="block font-medium break-words text-foreground">{sentTo}</span>
          It works once and is valid for 10 minutes.
        </p>
        <Button variant="link" className="mt-4 h-auto p-0 text-sm" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
      {banner && (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
          <TriangleAlert aria-hidden />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <Button variant="outline" className="h-11 w-full text-base" disabled={pending !== null} onClick={google}>
        {pending === "google" ? <LoaderCircle className="animate-spin" aria-hidden /> : <GoogleMark />}
        {pending === "google" ? "Opening Google…" : "Continue with Google"}
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={emailLink} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="you@example.com"
            className="h-11"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending !== null}
          />
        </div>
        <Button type="submit" className="h-11 w-full bg-clip-border text-base" disabled={pending !== null}>
          {pending === "email" && <LoaderCircle className="animate-spin" aria-hidden />}
          {pending === "email" ? "Sending link…" : "Email me a sign-in link"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">No password. We email you a one-time link.</p>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
