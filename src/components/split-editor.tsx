"use client";

import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { typedAmount } from "@/lib/keypad";
import { formatMoney, minorDigits, parseDecimal, parseMoney } from "@/lib/money/format";
import { splitExpense, type Part, type SplitResult, type SplitSpec } from "@/lib/money/split";
import { cn } from "@/lib/utils";
import type { splitSpecSchema } from "@/lib/validation";
import type { FormMember } from "@/server/expenses";

export type SplitInput = z.input<typeof splitSpecSchema>;
type SplitMethod = SplitSpec["method"];
/** Member id → what was typed for them. */
type Typed = Record<string, string>;
export type SplitItem = { key: number; name: string; amount: string; memberIds: string[] };

/** What people typed, as strings, for every method at once: switching methods and back loses nothing. */
export type SplitState = {
  method: SplitMethod;
  equal: string[];
  exact: Typed;
  percent: Typed;
  shares: Typed;
  items: SplitItem[];
  adjust: boolean;
  adjustments: Typed;
};

type Parse = (text: string) => bigint | null;

/** Each returns null for text that isn't a number of its kind. Only adjustments may be negative. */
function parsers(currency: string): Record<"money" | "percent" | "shares" | "signed", Parse> {
  const money: Parse = (text) => parseMoney(text, currency);
  return {
    money,
    percent: (text) => parseDecimal(text, 2), // basis points
    shares: (text) => (/^\d{1,3}$/.test(text) ? BigInt(text) : null),
    // A lone "-" is someone about to type a number: nothing yet.
    signed: (text) => {
      if (!text.startsWith("-")) return money(text);
      const value = text === "-" ? 0n : money(text.slice(1));
      return value === null ? null : -value;
    },
  };
}

/** Blank is zero. */
const read = (text: string | undefined, parse: Parse) => (text?.trim() ? parse(text.trim()) : 0n);

/** Everyone's typed numbers in `order`, zeros left out; null if any doesn't parse. */
export function readParts(typed: Typed, order: readonly string[], parse: Parse): Part[] | null {
  const parts: Part[] = [];
  for (const memberId of order) {
    const value = read(typed[memberId], parse);
    if (value === null) return null;
    if (value !== 0n) parts.push({ memberId, value });
  }
  return parts;
}

/** Every list comes out in `order` (group order), as the server sorts it: a leftover paisa then lands where it will be stored. */
function parseSplit(state: SplitState, currency: string, order: readonly string[]): SplitSpec | null {
  const parse = parsers(currency);
  // Only while switched on, and never with exact amounts, which already say what each person pays.
  const adjustments = state.adjust && state.method !== "EXACT" ? readParts(state.adjustments, order, parse.signed) : [];
  if (!adjustments) return null;
  const inOrder = (ids: string[]) => order.filter((id) => ids.includes(id));
  switch (state.method) {
    case "EQUAL":
      return { method: "EQUAL", memberIds: inOrder(state.equal), adjustments };
    case "EXACT": {
      const amounts = readParts(state.exact, order, parse.money);
      return amounts && { method: "EXACT", amounts, adjustments };
    }
    case "PERCENT": {
      const basisPoints = readParts(state.percent, order, parse.percent);
      return basisPoints && { method: "PERCENT", basisPoints, adjustments };
    }
    case "SHARES": {
      const shares = readParts(state.shares, order, parse.shares);
      return shares && { method: "SHARES", shares, adjustments };
    }
    case "ITEMIZED": {
      const items = [];
      for (const item of state.items) {
        const amount = read(item.amount, parse.money); // zero is fine: splitExpense asks for an amount
        if (amount === null) return null;
        items.push({ name: item.name.trim(), amount, memberIds: inOrder(item.memberIds) });
      }
      return { method: "ITEMIZED", items, adjustments };
    }
  }
}

/** The split as the form sends it (minor units as strings), or null while anything typed doesn't parse. `order`: group order. */
export function toInput(state: SplitState, currency: string, order: readonly string[]): SplitInput | null {
  const spec = parseSplit(state, currency, order);
  return spec && JSON.parse(JSON.stringify(spec, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

/** Everyone's share exactly as the server will store it, or the first thing wrong ("₹120 left to assign"). */
export function previewSplit(state: SplitState, currency: string, total: bigint, order: readonly string[]): SplitResult {
  const spec = parseSplit(state, currency, order);
  if (!spec) {
    const badPercent = state.method === "PERCENT" && !readParts(state.percent, order, parsers(currency).percent);
    return { ok: false, error: badPercent ? "Enter a percentage up to 100" : "Enter a valid amount" };
  }
  // splitExpense would ask who had “”.
  if (spec.method === "ITEMIZED" && spec.items.some((item) => !item.name)) return { ok: false, error: "Name each item" };
  return splitExpense(total, spec, currency, order);
}

const blankItem = (key: number): SplitItem => ({ key, name: "", amount: "", memberIds: [] });

/** A new expense: split equally between everyone still in the group. An edit: what was saved. */
export function initialSplit(members: FormMember[], currency: string, saved?: SplitInput): SplitState {
  const digits = minorDigits(currency);
  const active = members.filter((m) => m.active).map((m) => m.id);
  const typed = (parts: { memberId: string; value: string }[], places: number): Typed =>
    Object.fromEntries(parts.map((p) => [p.memberId, typedAmount(p.value, places)]));
  const state: SplitState = {
    method: saved?.method ?? "EQUAL",
    equal: active,
    exact: {},
    percent: {},
    shares: Object.fromEntries(active.map((id) => [id, "1"])),
    items: [blankItem(0)],
    adjust: !!saved?.adjustments?.length,
    adjustments: typed(saved?.adjustments ?? [], digits),
  };
  switch (saved?.method) {
    case "EQUAL":
      return { ...state, equal: saved.memberIds };
    case "EXACT":
      return { ...state, exact: typed(saved.amounts, digits) };
    case "PERCENT":
      return { ...state, percent: typed(saved.basisPoints, 2) };
    case "SHARES":
      return { ...state, shares: typed(saved.shares, 0) };
    case "ITEMIZED":
      return { ...state, items: saved.items.map((item, key) => ({ ...item, key, amount: typedAmount(item.amount, digits) })) };
    default:
      return state;
  }
}

// `short` fits five across a phone; the accessible name is the full one.
const METHODS: { method: SplitMethod; short: string; name: string; chip: string }[] = [
  { method: "EQUAL", short: "Equally", name: "Equally", chip: "Split equally" },
  { method: "EXACT", short: "Exact", name: "Exact amounts", chip: "Exact amounts" },
  { method: "PERCENT", short: "Percent", name: "Percentages", chip: "By percentage" },
  { method: "SHARES", short: "Shares", name: "Shares", chip: "By shares" },
  { method: "ITEMIZED", short: "Items", name: "Items", chip: "By items" },
];

/** The split chip: "Split equally", "Split equally · 3 of 5", "By shares"… */
export function splitLabel(state: SplitState, members: FormMember[]): string {
  if (state.method !== "EQUAL") return METHODS.find((m) => m.method === state.method)!.chip;
  const count = members.filter((m) => state.equal.includes(m.id)).length;
  return count === members.length ? "Split equally" : `Split equally · ${count} of ${members.length}`;
}

type Props = {
  /** In group order. */
  members: FormMember[];
  me: string;
  currency: string;
  total: bigint;
  value: SplitState;
  onChange: (value: SplitState) => void;
};

/** How to split: a method, its rows, optional adjustments, and a live line with everyone's share or what's wrong. */
export function SplitEditor({ members, me, currency, total, value, onChange }: Props) {
  const id = useId();
  const order = members.map((m) => m.id);
  const parse = parsers(currency);
  const result = previewSplit(value, currency, total, order);
  const set = (patch: Partial<SplitState>) => onChange({ ...value, ...patch });
  const type = (field: "exact" | "percent" | "shares", memberId: string, text: string) =>
    set({ [field]: { ...value[field], [memberId]: text } });
  const bad = (text: string | undefined, kind: Parse) => read(text, kind) === null;

  const spec = value.method === "ITEMIZED" ? parseSplit(value, currency, order) : null;
  const sum = (list: bigint[]) => list.reduce((a, b) => a + b, 0n);
  // What the items don't cover (after adjustments), which splitExpense shares in proportion to each person's items.
  const extras =
    spec?.method === "ITEMIZED" ? total - sum((spec.adjustments ?? []).map((a) => a.value)) - sum(spec.items.map((i) => i.amount)) : 0n;
  const shareOf = new Map(result.ok ? result.shares.map((s) => [s.memberId, s.value]) : []);

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="How to split" className="grid grid-cols-5 gap-1 rounded-xl bg-muted p-1">
        {METHODS.map((m) => (
          <label
            key={m.method}
            className="relative flex h-11 cursor-pointer items-center justify-center rounded-lg px-0.5 text-sm font-medium text-muted-foreground transition-colors select-none hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none dark:has-checked:bg-input/60"
          >
            <input
              type="radio"
              name={`${id}-method`}
              aria-label={m.name}
              checked={value.method === m.method}
              onChange={() => set({ method: m.method })}
              className={rowInput}
            />
            {m.short}
          </label>
        ))}
      </div>

      {value.method === "EQUAL" && (
        <fieldset>
          <legend className={legend}>Split equally between</legend>
          {members.map((m) => (
            <ChoiceRow
              key={m.id}
              kind="checkbox"
              checked={value.equal.includes(m.id)}
              input={
                <input
                  type="checkbox"
                  checked={value.equal.includes(m.id)}
                  onChange={(e) => set({ equal: e.target.checked ? [...value.equal, m.id] : value.equal.filter((x) => x !== m.id) })}
                  className={rowInput}
                />
              }
            >
              <Person member={m} me={me} />
            </ChoiceRow>
          ))}
        </fieldset>
      )}

      {(value.method === "EXACT" || value.method === "PERCENT") && (
        <div>
          {members.map((m) => {
            const field = value.method === "EXACT" ? "exact" : "percent";
            return (
              <PersonLine key={m.id} member={m} me={me}>
                <NumberInput
                  label={`${value.method === "EXACT" ? "Amount" : "Percentage"} for ${m.displayName}`}
                  value={value[field][m.id] ?? ""}
                  invalid={bad(value[field][m.id], value.method === "EXACT" ? parse.money : parse.percent)}
                  suffix={value.method === "PERCENT" ? "%" : undefined}
                  onChange={(text) => type(field, m.id, text)}
                />
              </PersonLine>
            );
          })}
        </div>
      )}

      {value.method === "SHARES" && (
        <div>
          {members.map((m) => {
            const count = read(value.shares[m.id], parse.shares) ?? 0n;
            const step = (by: bigint) => {
              if (count + by >= 0n && count + by <= 999n) type("shares", m.id, String(count + by));
            };
            return (
              <PersonLine key={m.id} member={m} me={me}>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" className="size-11 rounded-xl" aria-label={`Fewer shares for ${m.displayName}`} onClick={() => step(-1n)}>
                    <Minus aria-hidden />
                  </Button>
                  <NumberInput
                    label={`Shares for ${m.displayName}`}
                    inputMode="numeric"
                    className="w-14 text-center"
                    value={value.shares[m.id] ?? ""}
                    // Whole shares up to 999 only, so what's typed always reads.
                    onChange={(text) => type("shares", m.id, text.replace(/\D/g, "").slice(0, 3))}
                  />
                  <Button type="button" variant="outline" size="icon" className="size-11 rounded-xl" aria-label={`More shares for ${m.displayName}`} onClick={() => step(1n)}>
                    <Plus aria-hidden />
                  </Button>
                </div>
              </PersonLine>
            );
          })}
        </div>
      )}

      {value.method === "ITEMIZED" && (
        <Items members={members} currency={currency} items={value.items} extras={extras} onChange={(items) => set({ items })} />
      )}

      {value.method !== "EXACT" && <Adjustments members={members} me={me} currency={currency} value={value} set={set} />}

      {/* Always in the page, so screen readers announce each change. */}
      <div role="status" aria-live="polite" className="rounded-xl bg-background px-3 py-2.5 text-sm dark:bg-input/30">
        {result.ok ? (
          <p className="font-medium tabular-nums">
            {members
              .filter((m) => shareOf.has(m.id))
              .map((m) => `${m.displayName} ${formatMoney(shareOf.get(m.id)!, currency)}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="text-muted-foreground">{result.error}</p>
        )}
      </div>
    </div>
  );
}

/** Each item with who had it. Whatever the items don't cover (`extras`) is shared in proportion to what each person had. */
function Items({ members, currency, items, extras, onChange }: {
  members: FormMember[];
  currency: string;
  items: SplitItem[];
  extras: bigint;
  onChange: (items: SplitItem[]) => void;
}) {
  const id = useId();
  const money = parsers(currency).money;
  const setItem = (key: number, patch: Partial<SplitItem>) => onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <fieldset key={item.key} className="rounded-xl border bg-background p-2.5 dark:bg-input/30">
          <legend className="sr-only">Item {i + 1}</legend>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Item name"
              placeholder="Item"
              autoComplete="off"
              maxLength={60}
              value={item.name}
              onChange={(e) => setItem(item.key, { name: e.target.value })}
              className="h-11 min-w-0 flex-1 rounded-xl text-base md:text-base"
            />
            <NumberInput
              label="Amount"
              className="w-24"
              value={item.amount}
              invalid={read(item.amount, money) === null}
              onChange={(amount) => setItem(item.key, { amount })}
            />
            {items.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 rounded-xl text-muted-foreground"
                aria-label="Remove item"
                onClick={() => onChange(items.filter((x) => x.key !== item.key))}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
          <p id={`${id}-had-${item.key}`} className="mt-2 px-1 text-xs font-medium text-muted-foreground">
            Who had it?
          </p>
          <div role="group" aria-labelledby={`${id}-had-${item.key}`} className="mt-1 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <label
                key={m.id}
                className="relative inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border bg-background px-3.5 text-sm font-medium transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-input/30 dark:has-checked:bg-primary/15"
              >
                <input
                  type="checkbox"
                  checked={item.memberIds.includes(m.id)}
                  onChange={(e) =>
                    setItem(item.key, { memberIds: e.target.checked ? [...item.memberIds, m.id] : item.memberIds.filter((x) => x !== m.id) })
                  }
                  className="peer absolute inset-0 cursor-pointer appearance-none rounded-full outline-none"
                />
                <Check aria-hidden className="hidden size-4 peer-checked:block" strokeWidth={3} />
                {m.displayName}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11 rounded-xl text-sm"
        onClick={() => onChange([...items, blankItem(Math.max(-1, ...items.map((x) => x.key)) + 1)])}
      >
        <Plus aria-hidden />
        Add item
      </Button>
      {extras > 0n && (
        <p className="px-1 text-sm text-muted-foreground">
          Tax, tip & service: {formatMoney(extras, currency)} — shared in proportion to what each person had
        </p>
      )}
    </div>
  );
}

/** The switch, then a signed amount per person while it's on. */
function Adjustments({ members, me, currency, value, set }: {
  members: FormMember[];
  me: string;
  currency: string;
  value: SplitState;
  set: (patch: Partial<SplitState>) => void;
}) {
  const id = useId();
  const signed = parsers(currency).signed;
  const type = (memberId: string, text: string) => set({ adjustments: { ...value.adjustments, [memberId]: text } });
  return (
    <div className="border-t pt-3">
      <label className="flex cursor-pointer items-center justify-between gap-4 px-2">
        <span className="min-w-0">
          <span id={`${id}-adjust`} className="block text-sm font-medium">
            Adjustments (+/−)
          </span>
          <span id={`${id}-adjust-hint`} className="block text-sm text-muted-foreground">
            Add or take off an amount for someone before the rest is split.
          </span>
        </span>
        <Switch
          checked={value.adjust}
          onCheckedChange={(adjust) => set({ adjust })}
          aria-labelledby={`${id}-adjust`}
          aria-describedby={`${id}-adjust-hint`}
          // Unchecked, shadcn's track is near-white on white; this keeps it at 3:1 against the sheet in both themes.
          className="data-unchecked:bg-muted-foreground/75 dark:data-unchecked:bg-muted-foreground/75"
        />
      </label>
      {value.adjust &&
        members.map((m) => {
          const text = value.adjustments[m.id] ?? "";
          const negative = text.trim().startsWith("-");
          return (
            <PersonLine key={m.id} member={m} me={me}>
              <div className="flex items-center gap-1">
                {/* Phones' decimal keypads have no minus key. */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 rounded-xl text-base"
                  aria-label={`Minus for ${m.displayName}`}
                  aria-pressed={negative}
                  onClick={() => type(m.id, negative ? text.trim().slice(1) : `-${text.trim()}`)}
                >
                  {negative ? "−" : "+"}
                </Button>
                <NumberInput
                  label={`Adjustment for ${m.displayName}`}
                  value={text}
                  invalid={read(text, signed) === null}
                  onChange={(next) => type(m.id, next)}
                />
              </div>
            </PersonLine>
          );
        })}
    </div>
  );
}

const legend = "mb-1 px-2 text-sm font-medium";

/** A real input stretched over its row: arrow keys, screen readers and taps all just work. */
export const rowInput = "absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none";

/** Avatar and name, saying "(you)" and "(left)". */
export function Person({ member, me }: { member: FormMember; me: string }) {
  return (
    <>
      <UserAvatar name={member.displayName} image={member.image} size="sm" />
      <span className="min-w-0 flex-1 truncate">
        {member.displayName}
        {member.id === me && <span className="text-muted-foreground"> (you)</span>}
        {!member.active && <span className="text-muted-foreground"> (left)</span>}
      </span>
    </>
  );
}

/** A choice filling its row: `input` (a radio or checkbox with `rowInput`) is stretched over it, with a tick at the end. */
export function ChoiceRow({ kind, checked, input, children }: {
  kind: "radio" | "checkbox";
  checked: boolean;
  input: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 transition-colors select-none hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:transition-none">
      {input}
      {children}
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

/** One person with something to type at the end of the row. */
export function PersonLine({ member, me, children }: { member: FormMember; me: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-13 items-center gap-3 px-2 py-1">
      <Person member={member} me={me} />
      {children}
    </div>
  );
}

/** A number field: 16px text so iOS doesn't zoom, the decimal keypad on phones, and marked when it doesn't read. */
export function NumberInput({ label, value, onChange, invalid, suffix, inputMode = "decimal", className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  suffix?: string;
  inputMode?: "decimal" | "numeric";
  className?: string;
}) {
  return (
    <span className="relative shrink-0">
      <Input
        aria-label={label}
        inputMode={inputMode}
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-11 w-28 rounded-xl text-right text-base tabular-nums md:text-base", suffix && "pr-7", className)}
      />
      {suffix && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
          {suffix}
        </span>
      )}
    </span>
  );
}
