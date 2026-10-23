"use client";

import { Copy, LoaderCircle, MailWarning, Share2, UserPlus } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { bigInput, firstError, NETWORK_ERROR } from "@/components/profile-fields";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { displayNameSchema } from "@/lib/validation";
import { addPlaceholderAction } from "@/server/actions/members";

/** Copies text (a link, by default) to the clipboard and says so. False when the browser refused (no permission, or not https). */
export async function copyLink(text: string, noun = "link"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} copied`);
    return true;
  } catch {
    toast.error(`Couldn't copy the ${noun}, so here it is to copy yourself`, { description: text });
    return false;
  }
}

const subscribeNever = () => () => {};
const emailSchema = z.string().trim().min(1, "Enter their email").pipe(z.email("Enter an email like name@example.com"));

type Props = {
  groupId: string;
  groupName: string;
  inviteUrl: string;
  /** The invite link as a QR code image (a data: URL), made on the server. */
  qrCode: string;
  /** For the "Invite people" button. */
  className?: string;
};

/** "Invite people", and the sheet it opens: the group's link (copy, share, QR), an email invite, or just a name. */
export function InviteSheet({ groupId, groupName, inviteUrl, qrCode, className }: Props) {
  const [open, setOpen] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  // Only the browser knows; false on the server and during hydration, so the two render the same.
  const canShare = useSyncExternalStore(subscribeNever, () => typeof navigator.share === "function", () => false);

  function share() {
    const text = `Join ${groupName} on Hisaab`;
    // Rejects when the person closes the share sheet, which needs no message.
    navigator.share({ title: text, text, url: inviteUrl }).catch(() => {});
  }

  return (
    <>
      <Button className={cn("h-11 rounded-xl px-4 text-base shadow-sm shadow-primary/20", className)} onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />
        Invite people
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Invite people"
        description={`Share the link to ${groupName}, or add people by name or email.`}
        initialFocus={copyRef}
      >
        <div className="flex flex-col gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <section className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor={linkId}>Invite link</FieldLabel>
              <Input
                ref={linkRef}
                id={linkId}
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className={cn(bigInput, "text-muted-foreground")}
                aria-describedby={`${linkId}-hint`}
              />
              <FieldDescription id={`${linkId}-hint`}>Anyone with this link can join the group.</FieldDescription>
            </Field>
            <div className={canShare ? "grid grid-cols-2 gap-2" : "grid"}>
              <Button ref={copyRef} className="h-11 rounded-xl text-base" onClick={async () => (await copyLink(inviteUrl)) || linkRef.current?.focus()}>
                <Copy aria-hidden />
                Copy link
              </Button>
              {canShare && (
                <Button variant="outline" className="h-11 rounded-xl text-base" onClick={share}>
                  <Share2 aria-hidden />
                  Share
                </Button>
              )}
            </div>
            <div className="flex items-center gap-4 rounded-2xl border p-3">
              {/* A data: URL made on the server; next/image has nothing to optimise. White in both themes, so it scans. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="QR code for the invite link" width={112} height={112} className="size-28 shrink-0 rounded-xl bg-white p-1.5" />
              <p className="text-sm text-muted-foreground">
                <span className="block font-medium text-foreground">Sitting together?</span>
                They can scan this with their phone&apos;s camera to join.
              </p>
            </div>
          </section>
          <Separator />
          <PlaceholderForm groupId={groupId} withEmail />
          <Separator />
          <PlaceholderForm groupId={groupId} />
        </div>
      </ResponsiveSheet>
    </>
  );
}

/** Adds someone by name, and with `withEmail` also emails them a link to claim their place. */
function PlaceholderForm({ groupId, withEmail = false }: { groupId: string; withEmail?: boolean }) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  // The person was added but an email limit stopped the invite: say so where they'll see it, not just in a toast.
  const [unsent, setUnsent] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const issues = {
      name: firstError(displayNameSchema.safeParse(name)),
      email: withEmail ? firstError(emailSchema.safeParse(email)) : undefined,
    };
    setErrors(issues);
    setUnsent(false);
    if (issues.name) return nameRef.current?.focus();
    if (issues.email) return emailRef.current?.focus();

    setPending(true);
    const result = await addPlaceholderAction({ groupId, displayName: name, email: withEmail ? email : undefined }).catch(() => ({
      ok: false as const,
      error: NETWORK_ERROR,
    }));
    setPending(false);
    if (!result.ok) return setErrors({ form: result.error });
    const { member, emailSent } = result.data;
    toast.success(`${member.displayName} was added`, emailSent ? { description: `Invite sent to ${member.email}` } : undefined);
    setUnsent(emailSent === false);
    setName("");
    setEmail("");
    nameRef.current?.focus(); // ready for the next person
  }

  const field = (key: "name" | "email") => ({
    id: `${id}-${key}`,
    className: bigInput,
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} aria-describedby={`${id}-about`} className="flex flex-col gap-3">
      <div>
        <h3 id={`${id}-title`} className="font-semibold">
          {withEmail ? "Invite by email" : "Add someone without an account"}
        </h3>
        <p id={`${id}-about`} className="text-sm text-muted-foreground">
          {withEmail
            ? "We'll email them a link that puts them straight into the group."
            : "Split with them now; they can claim their spot whenever they sign up."}
        </p>
      </div>
      <div className={withEmail ? "grid gap-3 sm:grid-cols-2" : "grid"}>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            {...field("name")}
            ref={nameRef}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint={withEmail ? "next" : "done"}
            maxLength={40}
            placeholder="e.g. Rahul"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((errs) => ({ ...errs, name: undefined, form: undefined }));
              setUnsent(false);
            }}
          />
          <FieldError id={`${id}-name-error`}>{errors.name}</FieldError>
        </Field>
        {withEmail && (
          <Field>
            <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
            <Input
              {...field("email")}
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="rahul@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((errs) => ({ ...errs, email: undefined, form: undefined }));
                setUnsent(false);
              }}
            />
            <FieldError id={`${id}-email-error`}>{errors.email}</FieldError>
          </Field>
        )}
      </div>
      <FieldError>{errors.form}</FieldError>
      {/* Always in the page, so screen readers announce the notice when it appears. */}
      <div role="status">
        {unsent && (
          <p className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-sm dark:bg-amber-400/10">
            <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            We couldn&apos;t send the email right now — copy their invite link from the list and share it yourself.
          </p>
        )}
      </div>
      <Button type="submit" variant="secondary" className="h-11 rounded-xl text-base" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden />}
        {withEmail ? "Send invite" : "Add"}
      </Button>
    </form>
  );
}
