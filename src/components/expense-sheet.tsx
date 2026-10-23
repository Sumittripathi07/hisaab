"use client";

import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Keypad } from "@/components/keypad";
import { bigInput, firstError, NETWORK_ERROR } from "@/components/profile-fields";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { CATEGORIES, CATEGORY_KEYS, suggestCategory, type Category } from "@/lib/categories";
import { formatDay } from "@/lib/dates";
import { formatTyped, pressKey, type KeypadKey } from "@/lib/keypad";
import { formatDecimal, minorDigits, parseMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { expenseInputSchema, type ExpenseFormValues } from "@/lib/validation";
import type { ActionResult } from "@/server/action";
import { createExpenseAction, updateExpenseAction } from "@/server/actions/expenses";
import type { ExpenseFormData, FormMember } from "@/server/expenses";

type Mode = { kind: "add" } | { kind: "edit"; expenseId: string; version: number };
type Panel = "payer" | "split" | "date" | "category";

const ADD: Mode = { kind: "add" };
const DESCRIPTION = "Enter the amount, then who paid and how to split it.";

type Props = {
  data: ExpenseFormData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  /** What an edit starts from. */
  initial?: ExpenseFormValues;
};

/** Step 1 is the amount on a keypad; step 2 is everything else. Opens from "Add expense", or edits an existing expense. */
export function ExpenseSheet({ data, open, onOpenChange, mode, initial }: Props) {
  const focusRef = useRef<HTMLElement | null>(null);
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode.kind === "edit" ? "Edit expense" : "Add expense"}
      description={DESCRIPTION}
      initialFocus={focusRef}
    >
      {/* Mounted only while the sheet is, so every opening starts from a clean form. */}
      <ExpenseFlow data={data} mode={mode} initial={initial} close={() => onOpenChange(false)} focusRef={focusRef} />
    </ResponsiveSheet>
  );
}

const AddExpenseContext = createContext<(() => void) | null>(null);

/** Opens the add-expense sheet held by the nearest AddExpenseProvider. */
export const useOpenAddExpense = () => use(AddExpenseContext);

/**
 * Holds a group page's one add-expense sheet. Anything inside opens it with <AddExpenseButton> or the page's + button;
 * `openOnLoad` (from /groups/<id>?add=1) opens it on arrival, once.
 */
export function AddExpenseProvider({ data, openOnLoad, children }: { data: ExpenseFormData; openOnLoad: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Stable, so OpenOnLoad's effect runs once rather than on every render.
  const openSheet = useCallback(() => setOpen(true), []);
  return (
    <AddExpenseContext value={openSheet}>
      {openOnLoad && <OpenOnLoad />}
      {children}
      <ExpenseSheet data={data} open={open} onOpenChange={setOpen} mode={ADD} />
    </AddExpenseContext>
  );
}

/** Opens the sheet as a tap would, then drops `?add=1` so neither Back nor a refresh reopens it (see OpenCreateGroupOnLoad). */
function OpenOnLoad() {
  const openSheet = useOpenAddExpense();
  const router = useRouter();
  useEffect(() => {
    openSheet?.();
    const url = new URL(location.href);
    url.searchParams.delete("add");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [openSheet, router]);
  return null;
}

/** A button that opens the group page's add-expense sheet. Takes every Button prop. */
export function AddExpenseButton(props: React.ComponentProps<typeof Button>) {
  const openSheet = useOpenAddExpense();
  return <Button {...props} onClick={() => openSheet?.()} />;
}

/** Minor units as the keypad would have typed them: "1200.00" → "1200", "12.50" → "12.5". */
function typedAmount(minor: string, digits: number): string {
  const text = formatDecimal(BigInt(minor), digits);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** The amount shrinks as it grows, so the longest one still fits a phone. */
const amountSize = (length: number) => (length <= 7 ? "text-6xl" : length <= 10 ? "text-5xl" : length <= 13 ? "text-4xl" : "text-3xl");

// ponytail: one payer and an equal split between the people ticked; the editors for several payers and the other methods
// replace `payerId` and `splitIds` here.
function ExpenseFlow({ data, mode, initial, close, focusRef }: {
  data: ExpenseFormData;
  mode: Mode;
  initial?: ExpenseFormValues;
  close: () => void;
  focusRef: React.RefObject<HTMLElement | null>;
}) {
  const { currency, members, me, today, history, groupId } = data;
  const digits = minorDigits(currency);
  const router = useRouter();
  const id = useId();
  const busy = useRef(false);
  const chips = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});

  const [step, setStep] = useState<1 | 2>(mode.kind === "edit" ? 2 : 1);
  const [value, setValue] = useState(initial ? typedAmount(initial.amount, digits) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Null until someone picks one: the category then follows what the description suggests.
  const [picked, setPicked] = useState<Category | null>(initial?.category ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [payerId, setPayerId] = useState(initial?.payers[0]?.memberId ?? me);
  const [splitIds, setSplitIds] = useState<string[]>(() =>
    initial?.split.method === "EQUAL" ? initial.split.memberIds : members.filter((m) => m.active).map((m) => m.id),
  );
  const [panel, setPanel] = useState<Panel | null>(null);
  const [saving, setSaving] = useState<"save" | "another" | null>(null);
  const [error, setError] = useState<string>();

  const amount = parseMoney(value, currency) ?? 0n;
  const category = picked ?? suggestCategory(description, history);
  const splitMembers = members.filter((m) => splitIds.includes(m.id));
  const fields: ExpenseFormValues = {
    description,
    amount: amount.toString(),
    category,
    date,
    notes,
    payers: [{ memberId: payerId, value: amount.toString() }],
    split: { method: "EQUAL", memberIds: splitMembers.map((m) => m.id), adjustments: [] },
  };
  const parsed = expenseInputSchema.safeParse({ ...fields, groupId });
  const problem = parsed.success ? undefined : firstError(parsed);
  // An empty description needs no telling: the field is in front of them, empty. An emptied date needs saying in plain words.
  const hint = problem === "Add a description" ? undefined : !date ? "Pick a date" : problem;
  const shownAmount = formatTyped(value, currency);

  const onKey = (key: KeypadKey) => setValue((v) => pressKey(v, key, digits));
  const next = () => {
    if (amount > 0n) setStep(2);
  };

  // Back on the amount (the next one, or "Change"), the keyboard types into it again.
  useEffect(() => {
    if (step === 1) focusRef.current?.focus();
  }, [step, focusRef]);

  const nameOf = (memberId: string) => members.find((m) => m.id === memberId)?.displayName ?? "someone";
  const toggle = (name: Panel, button: HTMLButtonElement) => {
    setPanel((p) => (p === name ? null : name));
    // Moving focus off the description puts the phone's keyboard away, so the panel isn't under it.
    button.focus();
  };
  const closePanel = (name: Panel) => {
    setPanel(null);
    chips.current[name]?.focus();
  };
  /** After a tap or click on a choice, not after an arrow key, which is still looking. */
  const afterPointer = (name: Panel) => (e: React.MouseEvent) => {
    if (e.detail > 0) closePanel(name);
  };

  async function save(another: boolean) {
    if (busy.current || !parsed.success) return;
    busy.current = true; // a ref, so a second tap in the same moment sees it before any re-render
    setSaving(another ? "another" : "save");
    setError(undefined);
    let result: ActionResult<unknown>;
    try {
      result = await (mode.kind === "edit"
        ? updateExpenseAction({ ...fields, expenseId: mode.expenseId, version: mode.version })
        : createExpenseAction({ ...fields, groupId }));
    } catch {
      result = { ok: false, error: NETWORK_ERROR };
    }
    if (!result.ok) {
      setError(result.error);
      busy.current = false;
      setSaving(null);
      return;
    }
    toast.success(mode.kind === "edit" ? "Expense saved" : "Expense added");
    navigator.vibrate?.(10);
    router.refresh();
    // Closing leaves it busy for good: a late second tap while the sheet slides away can't make a twin.
    if (!another) return close();
    // Same day, payer and split for the next one; the rest starts over.
    busy.current = false;
    setSaving(null);
    setValue("");
    setDescription("");
    setPicked(null);
    setNotes("");
    setPanel(null);
    setStep(1);
  }

  const footer = (children: React.ReactNode) => (
    // Stays in reach while the fields scroll underneath, as in the group form.
    <div className="sticky bottom-0 bg-popover pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-popover">
      {children}
    </div>
  );

  if (step === 1) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-1 py-3 text-center">
          <div
            ref={(el) => {
              focusRef.current = el;
            }}
            tabIndex={-1}
            role="status"
            aria-label="Amount"
            className={cn(
              "max-w-full font-semibold tracking-tight tabular-nums outline-none",
              amountSize(shownAmount.length),
              amount === 0n && !value.includes(".") && "text-muted-foreground/60",
            )}
          >
            {shownAmount}
          </div>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground">{currency}</p>
        </div>
        <Keypad onKey={onKey} onEnter={next} decimal={digits > 0} />
        {footer(
          <Button type="button" className="h-12 w-full rounded-xl text-base" disabled={amount === 0n} onClick={next}>
            Next
            <ArrowRight aria-hidden />
          </Button>,
        )}
      </div>
    );
  }

  const chip = (name: Panel, label: React.ReactNode) => (
    <button
      ref={(el) => {
        chips.current[name] = el;
      }}
      type="button"
      aria-expanded={panel === name}
      aria-controls={panel === name ? `${id}-panel` : undefined}
      onClick={(e) => toggle(name, e.currentTarget)}
      className={cn(
        "inline-flex h-11 max-w-full items-center rounded-full border bg-background px-4 text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-input/30",
        panel === name && "border-primary bg-primary/10 text-primary hover:bg-primary/10 dark:bg-primary/10",
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 py-1.5 pr-1.5 pl-4">
        <p className="min-w-0 truncate text-2xl font-semibold tracking-tight tabular-nums">
          {shownAmount} <span className="text-xs font-semibold tracking-wider text-muted-foreground">{currency}</span>
        </p>
        <Button type="button" variant="ghost" aria-label="Change amount" className="h-11 rounded-xl px-4 text-sm" onClick={() => setStep(1)}>
          Change
        </Button>
      </div>

      <Field>
        <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
        <Input
          ref={(el) => {
            focusRef.current = el;
          }}
          id={`${id}-description`}
          name="description"
          autoFocus
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          maxLength={100}
          aria-required
          placeholder="What was it for?"
          className={bigInput}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        {chip("payer", payerId === me ? "Paid by you" : `Paid by ${nameOf(payerId)}`)}
        {chip("split", splitMembers.length === members.length ? "Split equally" : `Split equally · ${splitMembers.length} of ${members.length}`)}
        {chip("date", !date ? "Pick a date" : date === today ? "Today" : formatDay(date))}
        {chip("category", `${CATEGORIES[category].emoji} ${CATEGORIES[category].label}`)}
      </div>

      {panel && (
        <div id={`${id}-panel`} className="rounded-2xl border bg-muted/30 p-3">
          {panel === "payer" && (
            <fieldset>
              <legend className="mb-1 px-2 text-sm font-medium">Paid by</legend>
              {members.map((m) => (
                <PersonRow key={m.id} member={m} me={me} checked={payerId === m.id} kind="radio">
                  <input
                    type="radio"
                    name={`${id}-payer`}
                    checked={payerId === m.id}
                    onChange={() => setPayerId(m.id)}
                    onClick={afterPointer("payer")}
                    className={rowInput}
                  />
                </PersonRow>
              ))}
            </fieldset>
          )}
          {panel === "split" && (
            <fieldset>
              <legend className="mb-1 px-2 text-sm font-medium">Split equally between</legend>
              {members.map((m) => (
                <PersonRow key={m.id} member={m} me={me} checked={splitIds.includes(m.id)} kind="checkbox">
                  <input
                    type="checkbox"
                    checked={splitIds.includes(m.id)}
                    onChange={(e) => setSplitIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))}
                    className={rowInput}
                  />
                </PersonRow>
              ))}
            </fieldset>
          )}
          {panel === "date" && (
            <Field>
              <FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
              <Input id={`${id}-date`} type="date" required className={bigInput} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          {panel === "category" && (
            <fieldset>
              <legend className="mb-2 px-1 text-sm font-medium">Category</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {CATEGORY_KEYS.map((key) => (
                  <label
                    key={key}
                    className="relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border bg-background px-1 py-2 text-center text-xs leading-tight font-medium text-muted-foreground transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-input/30 dark:has-checked:bg-primary/10"
                  >
                    {/* A real radio stretched over the tile, as in the group form. */}
                    <input
                      type="radio"
                      name={`${id}-category`}
                      checked={category === key}
                      onChange={() => setPicked(key)}
                      onClick={afterPointer("category")}
                      className="absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none"
                    />
                    <span aria-hidden className="text-xl leading-none">
                      {CATEGORIES[key].emoji}
                    </span>
                    {CATEGORIES[key].label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <textarea
        aria-label="Add a note"
        placeholder="Add a note"
        rows={2}
        maxLength={1000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="field-sizing-content min-h-20 w-full resize-none rounded-xl border border-input bg-transparent px-3.5 py-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />

      {footer(
        <>
          {/* Always in the page, so screen readers announce what appears in it. */}
          <div role="status" aria-live="polite">
            {(error ?? hint) && <p className={cn("pb-2 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</p>}
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="h-12 flex-1 rounded-xl text-base" disabled={saving !== null || !!problem}>
              {saving === "save" && <LoaderCircle className="animate-spin" aria-hidden />}
              Save
            </Button>
            {mode.kind === "add" && (
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl px-4 text-base"
                disabled={saving !== null || !!problem}
                onClick={() => void save(true)}
              >
                {saving === "another" && <LoaderCircle className="animate-spin" aria-hidden />}
                Save & add another
              </Button>
            )}
          </div>
        </>,
      )}
    </form>
  );
}

/** A real input stretched over its row: arrow keys, screen readers and taps all just work. */
const rowInput = "absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none";

/** One person in a panel, with their input (a radio or a checkbox) stretched over the whole row. */
function PersonRow({ member, me, checked, kind, children }: {
  member: FormMember;
  me: string;
  checked: boolean;
  kind: "radio" | "checkbox";
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 transition-colors select-none hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none">
      {children}
      <UserAvatar name={member.displayName} image={member.image} size="sm" />
      <span className="min-w-0 flex-1 truncate">
        {member.displayName}
        {member.id === me && <span className="text-muted-foreground"> (you)</span>}
        {!member.active && <span className="text-muted-foreground"> (left)</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center border transition-colors motion-reduce:transition-none",
          kind === "radio" ? "rounded-full" : "rounded-md",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
    </label>
  );
}
