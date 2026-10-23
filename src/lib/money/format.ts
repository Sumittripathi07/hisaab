// Money is bigint minor units end to end. These helpers never go through a JS number.

/** An integer count of minor units as a decimal string ("33333", "-500"): how amounts cross JSON and the client boundary. */
export type MinorString = string;

/** The largest amount we accept: 11 digits of minor units. */
export const MAX_AMOUNT = 99_999_999_999n;

/** Minor-unit digits of a currency: INR 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** "1,23,456.78" → minor units. null for a sign, an exponent, nothing, or more decimals than `digits`. */
export function parseDecimal(input: string, digits: number): bigint | null {
  const text = input.trim().replaceAll(",", "");
  if (!/^\d+(\.\d*)?$/.test(text) && !/^\.\d+$/.test(text)) return null;
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > digits) return null;
  return BigInt(whole || "0") * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
}

/** Minor units → plain decimal text with exactly `digits` decimals and no grouping ("123.45"). */
export function formatDecimal(value: bigint, digits: number): string {
  const sign = value < 0n ? "-" : "";
  const text = (value < 0n ? -value : value).toString().padStart(digits + 1, "0");
  return digits === 0 ? sign + text : `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

export function parseMoney(input: string, currency: string): bigint | null {
  return parseDecimal(input, minorDigits(currency));
}

/** "₹1,23,456" / "₹12.50": lakh grouping for INR, no decimals when the amount is whole. */
export function formatMoney(minor: bigint, currency: string): string {
  const digits = minorDigits(currency);
  const fractionDigits = minor % 10n ** BigInt(digits) === 0n ? 0 : digits;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(formatDecimal(minor, digits) as `${number}`); // a string keeps the exact digits; a number would round
}

/** Basis points → percent, trailing zeros dropped (1250n → "12.5"). */
export function formatPercent(basisPoints: bigint): string {
  return formatDecimal(basisPoints, 2).replace(/\.?0+$/, "");
}
