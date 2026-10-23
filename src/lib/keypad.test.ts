import { describe, expect, it } from "vitest";
import { formatTyped, fromKeyboard, pressKey, type KeypadKey } from "./keypad";

const type = (keys: string, digits = 2) => [...keys].reduce((v, k) => pressKey(v, k === "<" ? "back" : (k as KeypadKey), digits), "");

describe("the amount keypad", () => {
  it.each([
    ["1200", 2, "1200"], ["05", 2, "5"], ["12.5", 2, "12.5"], ["12.345", 2, "12.34"], ["1..2", 2, "1.2"], [".5", 2, "0.5"],
    ["12<", 2, "1"], ["1.5", 0, "15"], ["1234567890", 2, "123456789"], ["123456789012", 0, "12345678901"], ["<", 2, ""],
    // more: zeros, three-decimal currencies, taking back a point
    ["000", 2, "0"], ["0.05", 2, "0.05"], ["12.<<", 2, "1"], ["0.<", 2, "0"], ["1.2345", 3, "1.234"], ["12345678", 3, "12345678"],
    ["123456789", 3, "12345678"], ["99999999999", 0, "99999999999"], ["999999999.99", 2, "999999999.99"],
  ])("typing %j (digits %i) shows %j", (keys, digits, out) => expect(type(keys, digits)).toBe(out));

  it("never types a value above the largest amount", () => {
    for (const [digits, max] of [[0, "99999999999"], [2, "999999999.99"], [3, "99999999.999"]] as const) {
      expect(type("9".repeat(20) + "." + "9".repeat(20), digits)).toBe(max);
    }
  });
});

describe("a physical keyboard", () => {
  const press = (text: string) => [...text].reduce((v, ch) => {
    const key = fromKeyboard({ key: ch, code: ch === "," ? "Comma" : "" });
    return key ? pressKey(v, key, 2) : v;
  }, "");

  it("ignores a typed thousands separator instead of reading it as the point", () => {
    expect(press("12,500")).toBe("12500");
    expect(press("1,23,456.78")).toBe("123456.78");
  });

  it.each([
    [{ key: ",", code: "NumpadDecimal" }, "."], [{ key: ".", code: "Period" }, "."], [{ key: ".", code: "NumpadDecimal" }, "."],
    [{ key: ",", code: "Comma" }, null], [{ key: "7", code: "Digit7" }, "7"], [{ key: "Backspace", code: "Backspace" }, "back"], [{ key: "a", code: "KeyA" }, null],
  ])("maps %j to %j", (event, out) => expect(fromKeyboard(event)).toBe(out));
});

describe("the typed amount, as shown", () => {
  it.each([
    ["", "INR", "₹0"], ["1200", "INR", "₹1,200"], ["1234567", "INR", "₹12,34,567"], ["1.", "INR", "₹1."], ["1.2", "INR", "₹1.2"],
    ["1.23", "INR", "₹1.23"], ["0.05", "INR", "₹0.05"], ["0.", "INR", "₹0."], ["1500", "JPY", "¥1,500"], ["1234.5", "USD", "$1,234.5"],
  ])("showing %j in %s gives %s", (value, currency, out) => expect(formatTyped(value, currency)).toBe(out));
});
