"use client";

import { UsersRound } from "lucide-react";
import { useId } from "react";
import { ChoiceRow, NumberInput, Person, PersonLine, readParts, rowInput } from "@/components/split-editor";
import { typedAmount } from "@/lib/keypad";
import { minorDigits, parseMoney } from "@/lib/money/format";
import { checkPayers, type Part } from "@/lib/money/split";
import type { FormMember } from "@/server/expenses";

type PayerInput = { memberId: string; value: string };

/** One payer (`single`) pays the whole amount; with `multiple`, each person's typed amount. */
export type PayersState = { multiple: boolean; single: string; amounts: Record<string, string> };

/** Paid by me, or by whoever was saved. */
export function initialPayers(me: string, currency: string, saved?: PayerInput[]): PayersState {
  if (!saved || saved.length < 2) return { multiple: false, single: saved?.[0]?.memberId ?? me, amounts: {} };
  const amounts = Object.fromEntries(saved.map((p) => [p.memberId, typedAmount(p.value, minorDigits(currency))]));
  return { multiple: true, single: me, amounts };
}

function parsePayers(state: PayersState, currency: string, total: bigint): Part[] | null {
  if (!state.multiple) return [{ memberId: state.single, value: total }];
  return readParts(state.amounts, Object.keys(state.amounts), (text) => parseMoney(text, currency));
}

/** Who paid what as the form sends it (minor units as strings), or null while an amount typed doesn't parse. */
export function toInput(state: PayersState, currency: string, total: bigint): PayerInput[] | null {
  return parsePayers(state, currency, total)?.map(({ memberId, value }) => ({ memberId, value: value.toString() })) ?? null;
}

/** Null when the payers cover the total exactly; otherwise what's wrong ("₹100 of the total isn't paid by anyone"). */
export function payersProblem(state: PayersState, currency: string, total: bigint): string | null {
  const payers = parsePayers(state, currency, total);
  return payers ? checkPayers(total, payers, currency) : "Enter a valid amount";
}

/** The payer chip: "Paid by you", "Paid by Ravi", "Paid by 2 people". */
export function payersLabel(state: PayersState, members: FormMember[], me: string, currency: string, total: bigint): string {
  const payers = state.multiple ? (parsePayers(state, currency, total) ?? []) : [{ memberId: state.single }];
  if (payers.length > 1) return `Paid by ${payers.length} people`;
  if (!payers.length) return "Choose who paid";
  const payer = payers[0].memberId;
  return payer === me ? "Paid by you" : `Paid by ${members.find((m) => m.id === payer)?.displayName ?? "someone"}`;
}

type Props = {
  members: FormMember[];
  me: string;
  currency: string;
  total: bigint;
  value: PayersState;
  onChange: (value: PayersState) => void;
  /** A tap on one person: they paid it all, so the panel can close. */
  onPicked?: () => void;
};

/** Who paid: one person, or "Multiple people" with an amount each and a live check that they add up. */
export function PayersEditor({ members, me, currency, total, value, onChange, onPicked }: Props) {
  const id = useId();
  const problem = value.multiple ? payersProblem(value, currency, total) : null;
  const radio = (checked: boolean, pick: () => void, onClick?: (e: React.MouseEvent) => void) => (
    <input type="radio" name={`${id}-payer`} checked={checked} onChange={pick} onClick={onClick} className={rowInput} />
  );

  return (
    <fieldset>
      <legend className="mb-1 px-2 text-sm font-medium">Paid by</legend>
      {members.map((m) => {
        const checked = !value.multiple && value.single === m.id;
        // After a tap or click, not after an arrow key, which is still looking.
        const input = radio(checked, () => onChange({ ...value, multiple: false, single: m.id }), (e) => {
          if (e.detail > 0) onPicked?.();
        });
        return (
          <ChoiceRow key={m.id} kind="radio" checked={checked} input={input}>
            <Person member={m} me={me} />
          </ChoiceRow>
        );
      })}
      <ChoiceRow kind="radio" checked={value.multiple} input={radio(value.multiple, () => onChange({ ...value, multiple: true }))}>
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <UsersRound className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">Multiple people</span>
      </ChoiceRow>
      {value.multiple && (
        <div className="mt-1 border-t pt-1">
          {members.map((m) => (
            <PersonLine key={m.id} member={m} me={me}>
              <NumberInput
                label={`Amount ${m.displayName} paid`}
                value={value.amounts[m.id] ?? ""}
                invalid={!!value.amounts[m.id]?.trim() && parseMoney(value.amounts[m.id], currency) === null}
                onChange={(text) => onChange({ ...value, amounts: { ...value.amounts, [m.id]: text } })}
              />
            </PersonLine>
          ))}
        </div>
      )}
      {/* Always in the page, so screen readers announce what appears in it. */}
      <div role="status" aria-live="polite">
        {problem && <p className="px-2 pt-2 text-sm text-muted-foreground">{problem}</p>}
      </div>
    </fieldset>
  );
}
