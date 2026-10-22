import { z } from "zod";

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
