import type { GROUP_COLORS, GroupInput } from "@/lib/validation";

export type GroupType = GroupInput["type"];
export type GroupColor = (typeof GROUP_COLORS)[number];

/** In the order the type picker shows them. A type's emoji is the default emoji for a new group of that type. */
export const GROUP_TYPES: Record<GroupType, { label: string; emoji: string; example: string }> = {
  TRIP: { label: "Trip", emoji: "✈️", example: "Goa Trip" },
  HOME: { label: "Home", emoji: "🏠", example: "Flat 302" },
  COUPLE: { label: "Couple", emoji: "💑", example: "Us two" },
  EVENT: { label: "Event", emoji: "🎉", example: "Riya's birthday" },
  OTHER: { label: "Other", emoji: "👥", example: "Office lunches" },
};

/** Includes every type's emoji, so the grid always shows what a type picked. */
export const GROUP_EMOJIS = [
  "✈️", "🏖️", "🏔️", "🚆", "🚗", "🏕️", "🏠", "🛋️",
  "🍕", "🍻", "☕", "🛒", "💑", "❤️", "🎉", "🎂",
  "🪔", "🎬", "⚽", "🎮", "💼", "🎓", "🐶", "👥",
];

// Tailwind only generates classes it finds spelled out in the source, so each colour lists its own.
export const GROUP_TINTS: Record<GroupColor, { tile: string; swatch: string }> = {
  emerald: { tile: "bg-emerald-100 dark:bg-emerald-400/15", swatch: "bg-emerald-500" },
  sky: { tile: "bg-sky-100 dark:bg-sky-400/15", swatch: "bg-sky-500" },
  violet: { tile: "bg-violet-100 dark:bg-violet-400/15", swatch: "bg-violet-500" },
  rose: { tile: "bg-rose-100 dark:bg-rose-400/15", swatch: "bg-rose-500" },
  amber: { tile: "bg-amber-100 dark:bg-amber-400/15", swatch: "bg-amber-500" },
  teal: { tile: "bg-teal-100 dark:bg-teal-400/15", swatch: "bg-teal-500" },
  indigo: { tile: "bg-indigo-100 dark:bg-indigo-400/15", swatch: "bg-indigo-500" },
  orange: { tile: "bg-orange-100 dark:bg-orange-400/15", swatch: "bg-orange-500" },
};

/** The stored colour is a plain string column; anything unexpected falls back to emerald. */
export const groupTint = (color: string) => GROUP_TINTS[color as GroupColor] ?? GROUP_TINTS.emerald;
