// Pure split arithmetic in bigint minor units. Runs on the server and in the browser (live preview).
import { formatMoney, formatPercent } from "./format";

export type Part = { memberId: string; value: bigint };
export type SplitSpec = (
  | { method: "EQUAL"; memberIds: string[] }
  | { method: "EXACT"; amounts: Part[] }
  | { method: "PERCENT"; basisPoints: Part[] } // must sum to 10000n
  | { method: "SHARES"; shares: Part[] }
  | { method: "ITEMIZED"; items: { name: string; amount: bigint; memberIds: string[] }[] }
) & { adjustments?: Part[] }; // signed, on top of any method
export type SplitResult = { ok: true; shares: Part[] } | { ok: false; error: string };

const sum = (values: bigint[]) => values.reduce((s, v) => s + v, 0n);
const sumParts = (parts: Part[]) => sum(parts.map((p) => p.value));
const equally = (memberIds: string[]) => memberIds.map((memberId) => ({ memberId, value: 1n }));
const fail = (error: string): SplitResult => ({ ok: false, error });

/** Largest remainder: floors `total·w/Σw`, then +1 to the largest remainders, ties to the lower index. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const weightSum = sum(weights);
  if (total < 0n || weightSum <= 0n || weights.some((w) => w < 0n)) {
    throw new RangeError("allocate needs total ≥ 0 and non-negative weights with a positive sum");
  }
  const parts = weights.map((w) => (total * w) / weightSum);
  const remainders = weights.map((w) => (total * w) % weightSum);
  const order = weights.map((_, i) => i).sort((i, j) => (remainders[i] > remainders[j] ? -1 : remainders[i] < remainders[j] ? 1 : i - j));
  for (let left = total - sum(parts), k = 0; left > 0n; left--, k++) parts[order[k]] += 1n;
  return parts;
}

export function splitExpense(total: bigint, spec: SplitSpec, currency: string): SplitResult {
  const adjustments = spec.adjustments ?? [];
  const base = total - sumParts(adjustments);
  if (base < 0n) return fail("Adjustments add up to more than the total");

  // Insertion order is the result order: method order first, then adjustment-only people.
  const shares = new Map<string, bigint>();
  const add = (memberId: string, value: bigint) => shares.set(memberId, (shares.get(memberId) ?? 0n) + value);
  const spread = (amount: bigint, weights: Part[]) =>
    allocate(amount, weights.map((w) => w.value)).forEach((value, i) => add(weights[i].memberId, value));

  switch (spec.method) {
    case "EQUAL":
      if (!spec.memberIds.length) return fail("Choose who's splitting this");
      spread(base, equally(spec.memberIds));
      break;
    case "EXACT": {
      const left = base - sumParts(spec.amounts);
      if (left > 0n) return fail(`${formatMoney(left, currency)} left to assign`);
      if (left < 0n) return fail(`${formatMoney(-left, currency)} over the total`);
      for (const part of spec.amounts) add(part.memberId, part.value);
      break;
    }
    case "PERCENT": {
      const left = 10000n - sumParts(spec.basisPoints);
      if (left > 0n) return fail(`${formatPercent(left)}% left to assign`);
      if (left < 0n) return fail(`${formatPercent(-left)}% over 100%`);
      spread(base, spec.basisPoints);
      break;
    }
    case "SHARES":
      if (sumParts(spec.shares) === 0n) return fail("Choose who's splitting this");
      spread(base, spec.shares);
      break;
    case "ITEMIZED": {
      if (!spec.items.length) return fail("Add at least one item");
      for (const item of spec.items) {
        if (!item.memberIds.length) return fail(`Choose who had “${item.name}”`);
        if (item.amount <= 0n) return fail(`Enter an amount for “${item.name}”`);
      }
      const extras = base - sum(spec.items.map((item) => item.amount));
      if (extras < 0n) return fail(`Items add up to ${formatMoney(-extras, currency)} more than the total`);
      for (const item of spec.items) spread(item.amount, equally(item.memberIds));
      // Tax, tip & service follow each person's item subtotal (never all zero: every item costs something).
      spread(extras, [...shares].map(([memberId, value]) => ({ memberId, value })));
      break;
    }
  }

  for (const adjustment of adjustments) add(adjustment.memberId, adjustment.value);
  if ([...shares.values()].some((v) => v < 0n)) return fail("Adjustments can't take anyone's share below zero");
  return {
    ok: true,
    shares: [...shares].filter(([, value]) => value !== 0n).map(([memberId, value]) => ({ memberId, value })),
  };
}

export function checkPayers(total: bigint, payers: Part[], currency: string): string | null {
  if (!payers.length) return "Choose who paid";
  const left = total - sumParts(payers);
  if (left > 0n) return `${formatMoney(left, currency)} of the total isn't paid by anyone`;
  if (left < 0n) return `Payers add up to ${formatMoney(-left, currency)} more than the total`;
  return null;
}
