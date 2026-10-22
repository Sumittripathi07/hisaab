"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { bigInput, CurrencyField, NETWORK_ERROR } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { CurrencyOptions } from "@/lib/currency";
import { GROUP_EMOJIS, GROUP_TINTS, GROUP_TYPES, type GroupType } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import { GROUP_COLORS, groupInputSchema, type GroupInput } from "@/lib/validation";
import type { ActionResult } from "@/server/action";

type Props = {
  defaultValues?: Partial<GroupInput>;
  /** Built on the server with currencyOptions(), the currency to offer first leading. */
  currencies: CurrencyOptions;
  submitLabel: string;
  /** Gets every field, always: updating a group resets anything left out to its default. */
  onSubmit: (values: GroupInput) => Promise<ActionResult<unknown>>;
  /** The name input, for a sheet to focus when it opens. */
  nameInputRef?: React.RefObject<HTMLInputElement | null>;
  /**
   * "sheet" (default) keeps the submit button stuck to the bottom of the scrolling sheet. "inline" leaves it at the end of
   * the form, for a page, where a stuck bar would sit under the phone's bottom nav.
   */
  variant?: "sheet" | "inline";
};

/** A group's name, look and settings. Create and settings share it; the caller decides what success means. */
export function GroupForm({ defaultValues, currencies, submitLabel, onSubmit, nameInputRef, variant = "sheet" }: Props) {
  const [values, setValues] = useState<GroupInput>(() => {
    const type = defaultValues?.type ?? "OTHER";
    return {
      name: "",
      emoji: GROUP_TYPES[type].emoji,
      color: "emerald",
      baseCurrency: currencies.common[0].code,
      simplifyDebts: true,
      ...defaultValues,
      type,
    };
  });
  // The emoji follows the type until someone picks one themselves.
  const [emojiFollowsType, setEmojiFollowsType] = useState(() => values.emoji === GROUP_TYPES[values.type].emoji);
  const [nameError, setNameError] = useState<string>();
  const [pending, setPending] = useState(false);
  // The values last saved. Until something changes, submitting again would only repeat it (or, creating, make a twin).
  const [saved, setSaved] = useState<GroupInput>();
  const ownNameRef = useRef<HTMLInputElement>(null);
  const nameRef = nameInputRef ?? ownNameRef;
  // Unique per form: settings renders one inline while the create sheet can be open over it.
  const id = useId();
  const set = <K extends keyof GroupInput>(key: K, value: GroupInput[K]) => setValues((v) => ({ ...v, [key]: value }));
  const nameIssue = (name: string) => groupInputSchema.shape.name.safeParse(name).error?.issues[0].message;

  function pickType(type: GroupType) {
    setValues((v) => ({ ...v, type, emoji: emojiFollowsType ? GROUP_TYPES[type].emoji : v.emoji }));
  }

  function pickEmoji(emoji: string) {
    setEmojiFollowsType(false);
    set("emoji", emoji);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const parsed = groupInputSchema.safeParse(values);
    if (!parsed.success) {
      // Only the name can be wrong from this form; anything else means a bad defaultValue, so say it rather than hide it.
      const issue = parsed.error.issues[0];
      if (issue.path[0] !== "name") return void toast.error(issue.message);
      setNameError(issue.message);
      return nameRef.current?.focus();
    }

    setPending(true);
    const result = await onSubmit(parsed.data).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setPending(false);
    if (result.ok) setSaved(values);
    else toast.error(result.error);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Group name</FieldLabel>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl transition-colors",
              GROUP_TINTS[values.color].tile,
            )}
          >
            {values.emoji}
          </span>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
            maxLength={60}
            placeholder={`e.g. ${GROUP_TYPES[values.type].example}`}
            className={bigInput}
            value={values.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (nameError) setNameError(nameIssue(e.target.value));
            }}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
        </div>
        <FieldError id={`${id}-name-error`}>{nameError}</FieldError>
      </Field>

      <FieldSet className="gap-0">
        <FieldLegend variant="label" className="mb-2">Type</FieldLegend>
        <div className="grid grid-cols-5 gap-2">
          {(Object.entries(GROUP_TYPES) as [GroupType, (typeof GROUP_TYPES)[GroupType]][]).map(([type, { label, emoji }]) => (
            <label
              key={type}
              className="relative flex cursor-pointer flex-col items-center gap-1 rounded-xl border bg-background py-2.5 text-xs font-medium text-muted-foreground transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30 dark:has-checked:bg-primary/10"
            >
              {/* A real radio stretched over the chip: arrow keys, screen readers and clicks all just work. */}
              <input
                type="radio"
                name="type"
                value={type}
                checked={values.type === type}
                onChange={() => pickType(type)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none"
              />
              <span aria-hidden className="text-xl leading-none">
                {emoji}
              </span>
              {label}
            </label>
          ))}
        </div>
      </FieldSet>

      <FieldSet className="gap-0">
        <FieldLegend variant="label" className="mb-2">Emoji</FieldLegend>
        <div className="grid grid-cols-8 gap-1.5">
          {GROUP_EMOJIS.map((emoji) => (
            <label
              key={emoji}
              className="relative flex aspect-square cursor-pointer items-center justify-center rounded-xl text-2xl transition-colors select-none hover:bg-muted has-checked:bg-muted has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="emoji"
                value={emoji}
                checked={values.emoji === emoji}
                onChange={() => pickEmoji(emoji)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-xl outline-none"
              />
              {emoji}
            </label>
          ))}
        </div>
      </FieldSet>

      <FieldSet className="gap-0">
        <FieldLegend variant="label" className="mb-2">Colour</FieldLegend>
        {/* The same eight columns as the emoji grid, so the swatches line up under it. */}
        <div className="grid grid-cols-8 justify-items-center gap-1.5">
          {GROUP_COLORS.map((color) => (
            <label
              key={color}
              className={cn(
                "relative flex size-8 cursor-pointer sm:size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-popover transition-shadow has-checked:ring-2 has-checked:ring-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring",
                GROUP_TINTS[color].swatch,
              )}
            >
              <input
                type="radio"
                name="color"
                value={color}
                aria-label={color[0].toUpperCase() + color.slice(1)}
                checked={values.color === color}
                onChange={() => set("color", color)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-full outline-none"
              />
              {values.color === color && <Check className="size-4 text-white drop-shadow-sm" strokeWidth={3} aria-hidden />}
            </label>
          ))}
        </div>
      </FieldSet>

      <CurrencyField
        id={`${id}-currency`}
        label="Currency"
        hint="Balances and totals are shown in this currency."
        value={values.baseCurrency}
        onChange={(code) => set("baseCurrency", code)}
        options={currencies}
      />

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-3.5">
        <span className="min-w-0">
          <span id={`${id}-simplify`} className="block text-sm font-medium">
            Simplify debts
          </span>
          <span id={`${id}-simplify-hint`} className="block text-sm text-muted-foreground">
            Combines who owes whom, so everyone settles up in fewer payments.
          </span>
        </span>
        <Switch
          checked={values.simplifyDebts}
          onCheckedChange={(checked) => set("simplifyDebts", checked)}
          aria-labelledby={`${id}-simplify`}
          aria-describedby={`${id}-simplify-hint`}
          // Unchecked, shadcn's track is near-white on white; this keeps it at 3:1 against the sheet in both themes.
          className="data-unchecked:bg-muted-foreground/75 dark:data-unchecked:bg-muted-foreground/75"
        />
      </label>

      {/* In a sheet, stays in reach while the fields scroll underneath. */}
      <div
        className={
          variant === "sheet"
            ? "sticky bottom-0 bg-popover pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-popover"
            : "pt-2"
        }
      >
        <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={pending || saved === values}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
