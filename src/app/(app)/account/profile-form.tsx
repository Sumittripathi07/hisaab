"use client";

import { LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CurrencyField, firstError, NameField, NETWORK_ERROR, UpiIdField } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { CurrencyOptions } from "@/lib/currency";
import { displayNameSchema, upiIdSchema } from "@/lib/validation";
import { updateProfileAction } from "@/server/actions/profile";
import type { SessionUser } from "@/server/session";

export function ProfileForm({ user, currencies }: {
  user: Pick<SessionUser, "name" | "email" | "image" | "defaultCurrency" | "upiId" | "timezone">;
  currencies: CurrencyOptions;
}) {
  const [name, setName] = useState(user.name);
  const [currency, setCurrency] = useState(user.defaultCurrency);
  const [upiId, setUpiId] = useState(user.upiId ?? "");
  const [errors, setErrors] = useState<{ name?: string; upiId?: string }>({});
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const upiRef = useRef<HTMLInputElement>(null);
  const dirty = name !== user.name || currency !== user.defaultCurrency || upiId !== (user.upiId ?? "");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const next = { name: firstError(displayNameSchema.safeParse(name)), upiId: firstError(upiIdSchema.safeParse(upiId)) };
    setErrors(next);
    if (next.name) return nameRef.current?.focus();
    if (next.upiId) return upiRef.current?.focus();

    setPending(true);
    // The timezone isn't editable here; keep what onboarding detected.
    const result = await updateProfileAction({ name, defaultCurrency: currency, upiId, timezone: user.timezone }).catch(() => ({
      ok: false as const,
      error: NETWORK_ERROR,
    }));
    setPending(false);
    if (!result.ok) return void toast.error(result.error);
    // Match what the server stored, so the form reads as saved.
    setName(name.trim());
    setUpiId(upiId.trim().toLowerCase());
    toast.success("Saved"); // the action revalidates, so the page and header pick up the change
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <UserAvatar name={name} image={user.image} size="lg" className="size-16 text-xl" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{name.trim() || "Your name"}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <NameField
        ref={nameRef}
        value={name}
        onChange={(v) => {
          setName(v);
          if (errors.name) setErrors((e) => ({ ...e, name: firstError(displayNameSchema.safeParse(v)) }));
        }}
        error={errors.name}
      />
      <CurrencyField value={currency} onChange={setCurrency} options={currencies} />
      <UpiIdField
        ref={upiRef}
        value={upiId}
        onChange={(v) => {
          setUpiId(v);
          if (errors.upiId) setErrors((e) => ({ ...e, upiId: firstError(upiIdSchema.safeParse(v)) }));
        }}
        error={errors.upiId}
      />
      <div className="flex justify-end">
        <Button type="submit" className="h-11 w-full rounded-xl px-6 text-base sm:w-auto" disabled={pending || !dirty}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden />}
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
