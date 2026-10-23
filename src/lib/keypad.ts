import { formatMoney, minorDigits } from "@/lib/money/format";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

/** MAX_AMOUNT (99,999,999,999 minor units) has 11 digits, however they split between whole and fraction. */
const MAX_DIGITS = 11;

/**
 * The amount as typed after one more key: no leading zeros, one ".", no more fraction digits than the currency has,
 * and never more digits than MAX_AMOUNT. A key that would break a rule changes nothing.
 */
export function pressKey(value: string, key: KeypadKey, digits: number): string {
  if (key === "back") return value.slice(0, -1);
  const [whole, fraction] = value.split(".");
  if (key === ".") return digits === 0 || fraction !== undefined ? value : `${whole || "0"}.`;
  if (fraction !== undefined) return fraction.length < digits ? value + key : value;
  if (whole === "0") return key === "0" ? value : key;
  return whole.length < MAX_DIGITS - digits ? value + key : value;
}

/** What was typed, as an amount: grouped like any other ("₹12,34,567"), the fraction exactly as far as it goes ("₹1.2"). */
export function formatTyped(value: string, currency: string): string {
  const [whole, fraction] = value.split(".");
  const shown = formatMoney(BigInt(whole || "0") * 10n ** BigInt(minorDigits(currency)), currency);
  return fraction === undefined ? shown : `${shown}.${fraction}`;
}
