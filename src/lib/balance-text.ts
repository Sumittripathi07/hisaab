import { formatMoney } from "@/lib/money/format";

// A net is positive when the person is owed, negative when they owe. Every line says so in words; the tone only adds colour.

export type Tone = "owe" | "owed" | "even";
export type Line = { text: string; tone: Tone };

export const TONE_CLASS: Record<Tone, string> = {
  owe: "text-negative",
  owed: "text-positive",
  even: "text-muted-foreground",
};

const toneOf = (net: bigint): Tone => (net < 0n ? "owe" : net > 0n ? "owed" : "even");
const money = (net: bigint, currency: string) => formatMoney(net < 0n ? -net : net, currency);

/** The Balances tab's headline: how the viewer stands in the group. */
export function headline(net: bigint, currency: string): Line {
  const tone = toneOf(net);
  const text = { owe: `You owe ${money(net, currency)}`, owed: `You're owed ${money(net, currency)}`, even: "You're all settled up" }[tone];
  return { text, tone };
}

/** One member's row on the Balances tab. */
export function memberLine(net: bigint, currency: string): Line {
  const tone = toneOf(net);
  return { tone, text: { owe: `owes ${money(net, currency)}`, owed: `gets back ${money(net, currency)}`, even: "settled up" }[tone] };
}

/** The viewer's balance on a group card. */
export function cardLine(net: bigint, currency: string): Line {
  const tone = toneOf(net);
  return { tone, text: { owe: `you owe ${money(net, currency)}`, owed: `you're owed ${money(net, currency)}`, even: "settled up" }[tone] };
}

/**
 * What the viewer owes and is owed over all their groups. Currencies don't mix: each is summed on its own and a currency's
 * lines join with " + " ("You owe ₹4,200 + €35"), in the order the groups first mention them.
 */
export function overallLines(groups: { currency: string; net: bigint }[]): Line[] {
  const sums = new Map<string, bigint>();
  for (const { currency, net } of groups) sums.set(currency, (sums.get(currency) ?? 0n) + net);
  const join = (tone: "owe" | "owed") =>
    [...sums].filter(([, net]) => toneOf(net) === tone).map(([currency, net]) => money(net, currency)).join(" + ");
  const lines: Line[] = [];
  const owe = join("owe");
  const owed = join("owed");
  if (owe) lines.push({ text: `You owe ${owe}`, tone: "owe" });
  if (owed) lines.push({ text: `You're owed ${owed}`, tone: "owed" });
  return lines.length ? lines : [{ text: "You're all settled up", tone: "even" }];
}
