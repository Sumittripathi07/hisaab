import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import type { CurrencyOptions } from "@/lib/currency";
import type { ActionResult } from "@/server/action";

// Shared by onboarding, the account page and the group form.

export const NETWORK_ERROR = "Couldn't reach Hisaab. Check your connection and try again.";

/** Runs a server action; if the call itself fails (no connection), that becomes the same `{ ok: false }` an action returns. */
export function settle<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T> | { ok: false; error: string }> {
  return action().catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
}

/** The first message from a zod safeParse result, or undefined when it passed. */
export const firstError = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0].message;

/** Big touch targets, and 16px text so iOS doesn't zoom in on focus. */
export const bigInput = "h-12 rounded-xl px-3.5 text-base md:text-base";

type FieldProps<T> = { value: T; onChange: (value: T) => void; error?: string; ref?: React.Ref<HTMLInputElement> };

/** Wires the input to whichever of its hint or error is showing, so screen readers read it on focus. */
const describedBy = (id: string, error?: string, hint?: boolean) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function NameField({ value, onChange, error, ref, autoFocus }: FieldProps<string> & { autoFocus?: boolean }) {
  return (
    <Field>
      <FieldLabel htmlFor="name">Your name</FieldLabel>
      <Input
        ref={ref}
        id="name"
        name="name"
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="next"
        autoFocus={autoFocus}
        placeholder="e.g. Neha Sharma"
        className={bigInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy("name", error)}
      />
      <FieldError id="name-error">{error}</FieldError>
    </Field>
  );
}

/** The person's default currency unless told otherwise; the group form reuses it for a group's currency. */
export function CurrencyField({
  value,
  onChange,
  options,
  id = "defaultCurrency",
  label = "Default currency",
  hint = "New groups start in this currency.",
  disabled,
}: Omit<FieldProps<string>, "error" | "ref"> & { options: CurrencyOptions; id?: string; label?: string; hint?: string; disabled?: boolean }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        name={id}
        className="w-full [&>select]:h-12 [&>select]:rounded-xl [&>select]:pl-3.5 [&>select]:text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      >
        <NativeSelectOptGroup label="Popular">
          {options.common.map((o) => (
            <NativeSelectOption key={o.code} value={o.code}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
        <NativeSelectOptGroup label="All currencies">
          {options.rest.map((o) => (
            <NativeSelectOption key={o.code} value={o.code}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      </NativeSelect>
      <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
    </Field>
  );
}

export function UpiIdField({ value, onChange, error, ref }: FieldProps<string>) {
  return (
    <Field>
      <FieldLabel htmlFor="upiId">
        UPI ID <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      <Input
        ref={ref}
        id="upiId"
        name="upiId"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="yourname@okhdfc"
        className={bigInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy("upiId", error, true)}
      />
      {error ? (
        <FieldError id="upiId-error">{error}</FieldError>
      ) : (
        <FieldDescription id="upiId-hint">So friends can pay you in one tap</FieldDescription>
      )}
    </Field>
  );
}
