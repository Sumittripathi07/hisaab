"use client";

import { Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { bigInput } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { inviteCodeFrom } from "@/lib/invite-code";
import { cn } from "@/lib/utils";

const BAD_INVITE = "Paste the invite link a friend sent you, or just its code.";

/** "Join with a link", which opens a box to paste an invite link (or code) into. Place it in a flex column. */
export function JoinWithLink({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string>();

  function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = inviteCodeFrom(invite);
    if (code) router.push(`/join/${code}`);
    else setError(BAD_INVITE);
  }

  return (
    <>
      <Button variant="outline" className={className} aria-expanded={open} aria-controls="join-form" onClick={() => setOpen((o) => !o)}>
        <Link2 aria-hidden />
        Join with a link
      </Button>
      {open && (
        <form
          id="join-form"
          onSubmit={join}
          noValidate
          className="rounded-2xl bg-muted/60 p-4 text-left animate-in duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
        >
          <Field>
            <FieldLabel htmlFor="invite">Invite link or code</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="invite"
                autoFocus
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="https://…/join/…"
                className={cn(bigInput, "bg-background")}
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  setError(undefined);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? "invite-error" : undefined}
              />
              <Button type="submit" className="h-12 rounded-xl px-5 text-base">
                Join
              </Button>
            </div>
            <FieldError id="invite-error">{error}</FieldError>
          </Field>
        </form>
      )}
    </>
  );
}
