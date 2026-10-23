"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { bigInput, settle } from "@/components/profile-fields";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { typedAmount } from "@/lib/keypad";
import { minorDigits, parseMoney, type MinorString } from "@/lib/money/format";
import { SETTLEMENT_METHODS, type SettlementMethodKey } from "@/lib/settlement-methods";
import { cn } from "@/lib/utils";
import { settlementInputSchema, settlementUpdateSchema } from "@/lib/validation";
import { recordSettlementAction, updateSettlementAction } from "@/server/actions/settlements";

/** Someone a payment can be between: `active` is false for a person who left but is still owed or owing. */
export type SheetMember = { id: string; displayName: string; active: boolean };

/** A payment as the form holds it: the amount still a string of minor units. */
export type SettlementValues = {
  fromMemberId: string;
  toMemberId: string;
  amount: MinorString;
  method: SettlementMethodKey;
  date: string;
  note: string;
};

type Mode = { kind: "record" } | { kind: "edit"; settlementId: string };

type Props = {
  groupId: string;
  members: SheetMember[];
  currency: string;
  /** The day a new payment starts on, in the person's timezone (worked out on the server). */
  today: string;
  mode: Mode;
  /** What the form starts from: the suggested transfer, or the payment being edited. */
  initial?: SettlementValues;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Record a payment, or edit one (who paid whom is then fixed). Opens from a settle-up card or a payment's page. */
export function SettlementSheet({ open, onOpenChange, mode, ...rest }: Props) {
  const amountRef = useRef<HTMLInputElement>(null);
  const editing = mode.kind === "edit";
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit payment" : "Record a payment"}
      description={editing ? "Change the amount, how it was paid, the day or the note." : "Who paid whom, how much and how."}
      initialFocus={amountRef}
    >
      {/* Mounted only while the sheet is, so every opening starts from a clean form. */}
      <PaymentForm mode={mode} close={() => onOpenChange(false)} amountRef={amountRef} {...rest} />
    </ResponsiveSheet>
  );
}

function PaymentForm({ groupId, members, currency, today, mode, initial, close, amountRef }: Omit<Props, "open" | "onOpenChange"> & {
  close: () => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
}) {
  const router = useRouter();
  const id = useId();
  const busy = useRef(false);
  const digits = minorDigits(currency);
  const editing = mode.kind === "edit";

  const [from, setFrom] = useState(initial?.fromMemberId ?? members[0]?.id ?? "");
  const [to, setTo] = useState(initial?.toMemberId ?? members.find((m) => m.id !== (initial?.fromMemberId ?? members[0]?.id))?.id ?? "");
  const [amountText, setAmountText] = useState(initial ? typedAmount(initial.amount, digits) : "");
  const [method, setMethod] = useState<SettlementMethodKey>(initial?.method ?? "CASH");
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  // The last save's error with the input it was about: once anything changes it's stale, and the live hint shows again.
  const [error, setError] = useState<{ message: string; input: string }>();

  // "x" for an amount that doesn't parse, so the schema words it ("Enter a valid amount") like any other bad amount.
  const amount = parseMoney(amountText, currency)?.toString() ?? "x";
  const fields = { amount, method, date, note };
  const input = JSON.stringify({ from, to, ...fields });
  const parsed =
    mode.kind === "edit"
      ? settlementUpdateSchema.safeParse({ settlementId: mode.settlementId, ...fields })
      : settlementInputSchema.safeParse({ groupId, fromMemberId: from, toMemberId: to, ...fields });
  // An empty amount needs no telling: the field is in front of them, empty.
  const issue = parsed.error?.issues.find((i) => !(i.path[0] === "amount" && !amountText.trim()));
  const hint = (!date && "Pick a date") || issue?.message;
  const canSave = parsed.success && !!date && !!amountText.trim();
  const shownError = error?.input === input ? error.message : undefined;

  async function save() {
    if (busy.current || !canSave) return;
    busy.current = true; // a ref, so a second tap in the same moment sees it before any re-render
    setSaving(true);
    setError(undefined);
    const result =
      mode.kind === "edit"
        ? await settle(() => updateSettlementAction({ settlementId: mode.settlementId, ...fields }))
        : await settle(() => recordSettlementAction({ groupId, fromMemberId: from, toMemberId: to, ...fields }));
    if (!result.ok) {
      setError({ message: result.error, input });
      busy.current = false;
      setSaving(false);
      return;
    }
    toast.success(editing ? "Payment updated" : "Payment recorded");
    navigator.vibrate?.(10);
    router.refresh();
    // Closing leaves it busy for good: a late second tap while the sheet slides away can't make a twin.
    close();
  }

  const person = (label: string, value: string, onChange: (id: string) => void) => (
    <Field>
      <FieldLabel htmlFor={`${id}-${label}`}>{label}</FieldLabel>
      <NativeSelect
        id={`${id}-${label}`}
        className="w-full [&>select]:h-12 [&>select]:rounded-xl [&>select]:pl-3.5 [&>select]:text-base"
        value={value}
        // Who paid whom is fixed once recorded; a payment between the wrong people is deleted and recorded again.
        disabled={editing}
        aria-describedby={editing ? `${id}-fixed` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {members.map((m) => (
          <NativeSelectOption key={m.id} value={m.id}>
            {m.active ? m.displayName : `${m.displayName} (left)`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {person("From", from, setFrom)}
        {person("To", to, setTo)}
      </div>
      {editing && <FieldDescription id={`${id}-fixed`}>Who paid whom can&apos;t change. To fix that, delete the payment and record it again.</FieldDescription>}

      <Field>
        <FieldLabel htmlFor={`${id}-amount`}>Amount</FieldLabel>
        <div className="relative">
          <Input
            ref={amountRef}
            id={`${id}-amount`}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0"
            className={cn(bigInput, "pr-14 tabular-nums")}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-semibold tracking-wider text-muted-foreground">
            {currency}
          </span>
        </div>
      </Field>

      <FieldSet className="gap-0">
        <FieldLegend variant="label" className="mb-2">Method</FieldLegend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SETTLEMENT_METHODS.map(({ value, label }) => (
            <label
              key={value}
              className="relative flex min-h-11 cursor-pointer items-center justify-center rounded-xl border bg-background px-2 text-center text-sm font-medium text-muted-foreground transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-input/30 dark:has-checked:bg-primary/10"
            >
              {/* A real radio stretched over the chip: arrow keys, screen readers and clicks all just work. */}
              <input
                type="radio"
                name={`${id}-method`}
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none"
              />
              {label}
            </label>
          ))}
        </div>
      </FieldSet>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
          <Input id={`${id}-date`} type="date" required className={bigInput} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id={`${id}-note`}
            name="note"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={200}
            className={bigInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      {/* Stays in reach while the fields scroll underneath, as in the expense sheet. */}
      <div className="sticky bottom-0 bg-popover pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-popover">
        {/* Always in the page, so screen readers announce what appears in it. */}
        <div role="status" aria-live="polite">
          {(shownError ?? hint) && <p className={cn("pb-2 text-sm", shownError ? "text-destructive" : "text-muted-foreground")}>{shownError ?? hint}</p>}
        </div>
        <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={saving || !canSave}>
          {saving && <LoaderCircle className="animate-spin" aria-hidden />}
          {editing ? "Save changes" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
