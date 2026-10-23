"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { bigInput } from "@/components/profile-fields";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CATEGORIES, CATEGORY_KEYS } from "@/lib/categories";
import { formatDay } from "@/lib/dates";
import { activeFilters, toQuery } from "@/lib/expense-filters";
import type { ExpenseFilters } from "@/server/expenses";

type Props = {
  groupId: string;
  members: { id: string; displayName: string }[];
  /** What the page is showing now, as it read them from the address. */
  filters: ExpenseFilters;
};

const SEARCH_DELAY = 300;

/** The Expenses tab with `filters` on. `limit` isn't carried over: a different list starts from its first page again. */
const address = (groupId: string, filters: ExpenseFilters) => `/groups/${groupId}?${toQuery(filters, { tab: "expenses" })}`;

const selectClass = "w-full [&>select]:h-12 [&>select]:rounded-xl [&>select]:pl-3.5 [&>select]:text-base";

/** The search box, the Filters sheet and the chips for what is on. Everything lives in the address, so the server does the filtering. */
export function ExpenseFilterBar({ groupId, members, filters }: Props) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const q = filters.q ?? "";
  const [text, setText] = useState(q);
  // The last search we put in the address: tells our own update coming back from someone else's.
  const pushed = useRef(q);

  const go = (next: ExpenseFilters) => router.replace(address(groupId, next), { scroll: false });

  // Typing waits for a pause before asking the server.
  useEffect(() => {
    const next = text.trim();
    if (next === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = next;
      router.replace(address(groupId, { ...filters, q: next || undefined }), { scroll: false });
    }, SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [text, filters, groupId, router]);

  // "Clear filters" (here or in the empty list) changes the search from outside: show it.
  useEffect(() => {
    if (q === pushed.current) return;
    pushed.current = q;
    setText(q);
  }, [q]);

  const count = activeFilters(filters);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? "Someone";
  const chips: { key: "memberId" | "category" | "from" | "to"; label: string }[] = [];
  if (filters.memberId) chips.push({ key: "memberId", label: nameOf(filters.memberId) });
  if (filters.category) chips.push({ key: "category", label: `${CATEGORIES[filters.category].emoji} ${CATEGORIES[filters.category].label}` });
  if (filters.from) chips.push({ key: "from", label: `From ${formatDay(filters.from)}` });
  if (filters.to) chips.push({ key: "to", label: `To ${formatDay(filters.to)}` });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search expenses"
            placeholder="Search expenses"
            autoComplete="off"
            enterKeyHint="search"
            className={`${bigInput} pl-10`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button variant="outline" className="h-12 rounded-xl px-4 text-base" onClick={() => setSheet(true)}>
          <SlidersHorizontal aria-hidden />
          Filters
          {count > 0 && (
            <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {count}
            </span>
          )}
        </Button>
      </div>

      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-2">
          {chips.map(({ key, label }) => (
            <li key={key}>
              <button
                type="button"
                aria-label={`Remove filter: ${label}`}
                onClick={() => go({ ...filters, [key]: undefined })}
                // 36px tall with a 44px tap area.
                className="relative inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border bg-background pr-2.5 pl-3.5 text-sm font-medium outline-none transition-colors before:absolute before:inset-x-0 before:-inset-y-1 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-input/30"
              >
                <span className="truncate">{label}</span>
                <X aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ResponsiveSheet open={sheet} onOpenChange={setSheet} title="Filters" description="Show only the expenses that match.">
        <FilterFields members={members} filters={filters} onChange={go} />
      </ResponsiveSheet>
    </div>
  );
}

/** The sheet's fields. Each change applies at once; the sheet stays open for the next. Mounted only while the sheet is. */
function FilterFields({ members, filters, onChange }: {
  members: Props["members"];
  filters: ExpenseFilters;
  onChange: (filters: ExpenseFilters) => void;
}) {
  const id = useId();
  // Kept here as well as in the address, which takes a moment to come back: a select would snap back to the old value meanwhile.
  const [value, setValue] = useState(filters);
  const set = (patch: ExpenseFilters) => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Field>
        <FieldLabel htmlFor={`${id}-member`}>Member</FieldLabel>
        <NativeSelect id={`${id}-member`} className={selectClass} value={value.memberId ?? ""} onChange={(e) => set({ memberId: e.target.value || undefined })}>
          <NativeSelectOption value="">Everyone</NativeSelectOption>
          {members.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {m.displayName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-category`}>Category</FieldLabel>
        <NativeSelect
          id={`${id}-category`}
          className={selectClass}
          value={value.category ?? ""}
          onChange={(e) => set({ category: (e.target.value || undefined) as ExpenseFilters["category"] })}
        >
          <NativeSelectOption value="">All categories</NativeSelectOption>
          {CATEGORY_KEYS.map((key) => (
            <NativeSelectOption key={key} value={key}>
              {CATEGORIES[key].emoji} {CATEGORIES[key].label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
          <Input id={`${id}-from`} type="date" className={bigInput} value={value.from ?? ""} max={value.to} onChange={(e) => set({ from: e.target.value || undefined })} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-to`}>To</FieldLabel>
          <Input id={`${id}-to`} type="date" className={bigInput} value={value.to ?? ""} min={value.from} onChange={(e) => set({ to: e.target.value || undefined })} />
        </Field>
      </div>
      {/* Takes the search with it, as the empty list's "Clear filters" does. */}
      <Button
        variant="outline"
        className="h-12 rounded-xl text-base"
        onClick={() => {
          setValue({});
          onChange({});
        }}
      >
        Clear filters
      </Button>
    </div>
  );
}
