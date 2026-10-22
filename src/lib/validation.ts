import { z } from "zod";
import { CATEGORY_KEYS } from "@/lib/categories";

const currencies = new Set(Intl.supportedValuesOf("currency"));
// The canonical list lacks "UTC" and uses legacy names ("Asia/Calcutta", not "Asia/Kolkata"), which is what Safari and Firefox
// report for India. So check the name an alias resolves to against the list rather than the raw input.
const timezones = new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);
function isTimezone(tz: string): boolean {
  try {
    return timezones.has(new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone);
  } catch {
    return false; // Intl throws a RangeError for names it doesn't know
  }
}

const UPI_ID = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/;

// Control characters (newlines included: names go into email subjects) and the bidi marks, embeddings, overrides and
// isolates that can make a name read as something else. Zero-width joiners stay: emoji sequences need them.
const INVISIBLE = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/gu;

// ponytail: `.max` counts UTF-16 units, so an emoji uses 2 of the 40. Switch to Intl.Segmenter if that ever bites.
export const displayNameSchema = z
  .string()
  .overwrite((name) => name.replace(INVISIBLE, ""))
  .trim()
  .min(1, "Enter a name")
  .max(40, "Name must be 40 characters or fewer");

/** A name from sign-up (Google's profile, or the magic-link body) through the same rules; one they refuse is left blank for onboarding to ask. */
export const signUpName = (name: string): string => displayNameSchema.catch("").parse(name);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => currencies.has(code), "Choose a valid currency");

/** Trims and lowercases; an empty value means "no UPI ID" and becomes null. */
export const upiIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((id) => id === "" || UPI_ID.test(id), "Enter a valid UPI ID like name@bank")
  .transform((id) => id || null);

export const timezoneSchema = z.string().refine(isTimezone, "Choose a valid timezone");

export const profileSchema = z.object({
  name: displayNameSchema,
  defaultCurrency: currencySchema,
  upiId: upiIdSchema,
  timezone: timezoneSchema,
});

export type ProfileInput = z.output<typeof profileSchema>;

export const GROUP_COLORS = ["emerald", "sky", "violet", "rose", "amber", "teal", "indigo", "orange"] as const;

// Users pick one of these; DIRECT (the two-person group Phase 4 makes for friends) is created by code, never by a form.
export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name").max(60, "Group name must be 60 characters or fewer"),
  emoji: z.string().trim().min(1, "Pick an emoji").max(16, "Pick a single emoji").default("👥"),
  color: z.enum(GROUP_COLORS).default("emerald"),
  type: z.enum(["TRIP", "HOME", "COUPLE", "EVENT", "OTHER"]),
  baseCurrency: currencySchema,
  simplifyDebts: z.boolean().default(true),
});

export type GroupInput = z.output<typeof groupInputSchema>;

/** Someone added by name, optionally with the email to invite. A blank email field means "no email". */
export const placeholderSchema = z.object({
  displayName: displayNameSchema,
  email: z
    .email()
    .transform((email) => email.toLowerCase())
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type PlaceholderInput = z.output<typeof placeholderSchema>;

// Money arrives as minor units in a decimal string (bigint can't cross JSON). Digits only: no sign, no decimal point, so a
// negative share or percent (which the split arithmetic refuses by throwing) can't be expressed at all.
const digits = (max: number, message: string) =>
  z
    .string()
    .regex(new RegExp(`^\\d{1,${max}}$`), message)
    .transform((text) => BigInt(text));

/** 0 to MAX_AMOUNT (99,999,999,999: 11 digits) minor units. */
export const minorSchema = digits(11, "Enter a valid amount");
export const positiveMinorSchema = minorSchema.refine((value) => value > 0n, "Enter an amount above zero");
/** Signed: an adjustment can take something off someone's share. */
export const adjustmentSchema = z
  .string()
  .regex(/^-?\d{1,11}$/, "Enter a valid amount")
  .transform((text) => BigInt(text));
/** "YYYY-MM-DD", a real calendar date ("2026-02-30" is refused). */
export const isoDateSchema = z.iso.date();

const ONCE = "Each person can only appear once";
const id = z.string().min(1);
const memberIds = z.array(id).refine((ids) => new Set(ids).size === ids.length, ONCE);
const parts = <T extends z.ZodType<bigint, string>>(value: T) =>
  z.array(z.object({ memberId: id, value })).refine((list) => new Set(list.map((p) => p.memberId)).size === list.length, ONCE);
const adjustments = parts(adjustmentSchema).default([]);

/** A SplitSpec (src/lib/money/split.ts) as the form sends it. Stored as `Expense.splitInput` in this input shape. */
export const splitSpecSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("EQUAL"), memberIds: memberIds.min(1, "Choose who's splitting this"), adjustments }),
  z.object({ method: z.literal("EXACT"), amounts: parts(minorSchema), adjustments }),
  z.object({
    method: z.literal("PERCENT"),
    basisPoints: parts(digits(5, "Enter a percentage up to 100").refine((bp) => bp <= 10000n, "Enter a percentage up to 100")),
    adjustments,
  }),
  z.object({ method: z.literal("SHARES"), shares: parts(digits(3, "Enter a whole number of shares up to 999")), adjustments }),
  z.object({
    method: z.literal("ITEMIZED"),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Name each item").max(60, "Item names must be 60 characters or fewer"),
          amount: positiveMinorSchema,
          memberIds,
        }),
      )
      .min(1, "Add at least one item")
      .max(100, "Up to 100 items"),
    adjustments,
  }),
]);

export const expenseInputSchema = z.object({
  groupId: id,
  description: z.string().trim().min(1, "Add a description").max(100, "Description must be 100 characters or fewer"),
  amount: positiveMinorSchema,
  category: z.enum(CATEGORY_KEYS),
  date: isoDateSchema,
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1,000 characters or fewer")
    .transform((notes) => notes || null),
  payers: parts(positiveMinorSchema).min(1, "Choose who paid"),
  split: splitSpecSchema,
});

export type ExpenseInput = z.output<typeof expenseInputSchema>;
/** What the expense form holds: every amount still a string. */
export type ExpenseFormValues = Omit<z.input<typeof expenseInputSchema>, "groupId">;
