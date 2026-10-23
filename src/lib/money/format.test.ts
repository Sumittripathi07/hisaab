import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, formatDecimal, formatMoney, formatPercent, minorDigits, parseDecimal } from "./format";

describe("money formatting", () => {
  it.each([
    [12345600n, "INR", "₹1,23,456"], [74000n, "INR", "₹740"], [1250n, "INR", "₹12.50"], [1n, "INR", "₹0.01"],
    [99_999_999_999n, "INR", "₹99,99,99,999.99"], [-85000n, "INR", "-₹850"],
    [1500n, "JPY", "¥1,500"], [4000n, "EUR", "€40"], [123456n, "USD", "$1,234.56"],
  ])("formatMoney(%s, %s) = %s", (minor, currency, out) => expect(formatMoney(minor, currency)).toBe(out));

  it.each([
    ["1200", 2, 120000n], ["12.5", 2, 1250n], ["0.01", 2, 1n], [".5", 2, 50n], ["12.", 2, 1200n],
    ["1,23,456.78", 2, 12345678n], [" 7 ", 2, 700n], ["1500", 0, 1500n],
    ["12.345", 2, null], ["1.5", 0, null], ["", 2, null], [".", 2, null], ["-5", 2, null], ["1e3", 2, null], ["abc", 2, null],
  ])("parseDecimal(%j, %i) = %s", (input, digits, out) => expect(parseDecimal(input, digits)).toBe(out));

  it("knows each currency's minor digits", () => expect(["INR", "JPY", "KWD"].map(minorDigits)).toEqual([2, 0, 3]));
  it("formats decimals plainly", () =>
    expect([formatDecimal(12345n, 2), formatDecimal(5n, 2), formatDecimal(100n, 0), formatDecimal(-5n, 2)]).toEqual(["123.45", "0.05", "100", "-0.05"]));
  it("round-trips every amount", () => {
    for (const v of [0n, 1n, 9n, 10n, 99n, 100n, 12345n, MAX_AMOUNT]) expect(parseDecimal(formatDecimal(v, 2), 2)).toBe(v);
  });
  it("formats percentages", () => expect([1000n, 1250n, 1n, 10000n].map(formatPercent)).toEqual(["10", "12.5", "0.01", "100"]));
});
