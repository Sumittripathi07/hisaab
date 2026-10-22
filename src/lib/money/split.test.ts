import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "./format";
import { allocate, checkPayers, splitExpense, type SplitResult, type SplitSpec } from "./split";

const p = (memberId: string, value: bigint) => ({ memberId, value });
const shares = (r: SplitResult) => (r.ok ? Object.fromEntries(r.shares.map((s) => [s.memberId, s.value])) : r.error);

/** mulberry32, returning the raw uint32 so no float ever touches an amount. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe("splits", () => {
  it.each([
    [100000n, [1n, 1n, 1n], [33334n, 33333n, 33333n]], [5n, [1n, 2n], [2n, 3n]], [2n, [1n, 1n, 1n], [1n, 1n, 0n]],
    [10n, [0n, 1n, 1n], [0n, 5n, 5n]], [99999n, [2000n, 2000n, 2000n, 2000n, 2000n], [20000n, 20000n, 20000n, 20000n, 19999n]],
  ])("allocate(%s, %s)", (total, weights, out) => expect(allocate(total, weights)).toEqual(out));
  it("refuses zero weights", () => expect(() => allocate(5n, [0n, 0n])).toThrow(RangeError));

  it("equal: the extra paisa goes to the first", () =>
    expect(shares(splitExpense(100000n, { method: "EQUAL", memberIds: ["a", "b", "c"] }, "INR"))).toEqual({ a: 33334n, b: 33333n, c: 33333n }));
  it("equal: ₹0.01 three ways leaves out zeros", () =>
    expect(shares(splitExpense(1n, { method: "EQUAL", memberIds: ["a", "b", "c"] }, "INR"))).toEqual({ a: 1n }));
  it("exact: says what's left or over", () => {
    expect(shares(splitExpense(100000n, { method: "EXACT", amounts: [p("a", 50000n), p("b", 38000n)] }, "INR"))).toBe("₹120 left to assign");
    expect(shares(splitExpense(100000n, { method: "EXACT", amounts: [p("a", 70000n), p("b", 40000n)] }, "INR"))).toBe("₹100 over the total");
  });
  it("percent", () => {
    expect(shares(splitExpense(100000n, { method: "PERCENT", basisPoints: [p("a", 3333n), p("b", 3333n), p("c", 3334n)] }, "INR")))
      .toEqual({ a: 33330n, b: 33330n, c: 33340n });
    expect(shares(splitExpense(100n, { method: "PERCENT", basisPoints: [p("a", 3333n), p("b", 3333n), p("c", 3333n)] }, "INR"))).toBe("0.01% left to assign");
    expect(shares(splitExpense(100n, { method: "PERCENT", basisPoints: [p("a", 5000n), p("b", 6000n)] }, "INR"))).toBe("10% over 100%");
  });
  it("shares 2:1:1", () =>
    expect(shares(splitExpense(100000n, { method: "SHARES", shares: [p("a", 2n), p("b", 1n), p("c", 1n)] }, "INR"))).toEqual({ a: 50000n, b: 25000n, c: 25000n }));
  it("itemised: extras follow each person's items", () => {
    const items = [{ name: "Paneer tikka", amount: 30000n, memberIds: ["a"] }, { name: "Biryani", amount: 20000n, memberIds: ["a", "b"] }];
    expect(shares(splitExpense(55000n, { method: "ITEMIZED", items }, "INR"))).toEqual({ a: 44000n, b: 11000n });
    expect(shares(splitExpense(40000n, { method: "ITEMIZED", items }, "INR"))).toBe("Items add up to ₹100 more than the total");
    expect(shares(splitExpense(55000n, { method: "ITEMIZED", items: [{ ...items[1], memberIds: [] }] }, "INR"))).toBe("Choose who had “Biryani”");
  });
  it("adjustments come off the top", () => {
    expect(shares(splitExpense(100000n, { method: "EQUAL", memberIds: ["a", "b", "c"], adjustments: [p("b", 10000n)] }, "INR")))
      .toEqual({ a: 30000n, b: 40000n, c: 30000n });
    expect(shares(splitExpense(100000n, { method: "EQUAL", memberIds: ["a", "b"], adjustments: [p("c", 10000n)] }, "INR")))
      .toEqual({ a: 45000n, b: 45000n, c: 10000n });
    expect(shares(splitExpense(30000n, { method: "EQUAL", memberIds: ["a", "b", "c"], adjustments: [p("a", -20000n)] }, "INR")))
      .toBe("Adjustments can't take anyone's share below zero");
    expect(shares(splitExpense(10000n, { method: "EQUAL", memberIds: ["a"], adjustments: [p("a", 20000n)] }, "INR")))
      .toBe("Adjustments add up to more than the total");
  });
  it("JPY has no paise to spread", () =>
    expect(shares(splitExpense(1000n, { method: "EQUAL", memberIds: ["a", "b", "c"] }, "JPY"))).toEqual({ a: 334n, b: 333n, c: 333n }));
  it("checks payers", () => {
    expect(checkPayers(100000n, [p("a", 60000n), p("b", 30000n)], "INR")).toBe("₹100 of the total isn't paid by anyone");
    expect(checkPayers(100000n, [p("a", 60000n), p("b", 50000n)], "INR")).toBe("Payers add up to ₹100 more than the total");
    expect(checkPayers(100000n, [], "INR")).toBe("Choose who paid");
    expect(checkPayers(100000n, [p("a", 100000n)], "INR")).toBeNull();
  });

  it("every valid split sums to the total, for 3,000 random cases", () => {
    const next = mulberry32(2026);
    const int = (n: number) => next() % n; // [0, n)
    const below = (n: bigint) => ((BigInt(next()) << 32n) | BigInt(next())) % n; // [0, n), n ≤ 2^64
    // `n` non-negative parts that sum to `amount`
    const cut = (amount: bigint, n: number) => {
      const parts: bigint[] = [];
      for (let k = 1; k < n; k++) {
        const v = below(amount + 1n);
        parts.push(v);
        amount -= v;
      }
      return [...parts, amount];
    };
    const methods = ["EQUAL", "EXACT", "PERCENT", "SHARES", "ITEMIZED"] as const;

    for (let i = 0; i < 3000; i++) {
      const ids = Array.from({ length: 1 + int(12) }, (_, k) => `m${k}`);
      const cap = 10n ** BigInt(1 + int(11)); // vary the magnitude: 1 digit up to MAX_AMOUNT
      const total = 1n + below(cap < MAX_AMOUNT ? cap : MAX_AMOUNT);
      // m12 and m13 (and any id past this case's members) are adjustment-only people
      const nAdjustments = int(4);
      const adjustments = nAdjustments ? cut(below(total + 1n), nAdjustments).map((v) => p(`m${int(14)}`, v)) : [];
      const base = total - adjustments.reduce((s, a) => s + a.value, 0n);
      const parts = (values: bigint[]) => values.map((v, k) => p(ids[k], v));
      const somePeople = () => {
        const some = ids.filter(() => int(2));
        return some.length ? some : [ids[int(ids.length)]];
      };

      const method = methods[int(methods.length)];
      const spec: SplitSpec =
        method === "EQUAL" ? { method, memberIds: ids, adjustments }
        : method === "EXACT" ? { method, amounts: parts(cut(base, ids.length)), adjustments }
        : method === "PERCENT" ? { method, basisPoints: parts(cut(10000n, ids.length)), adjustments }
        : method === "SHARES" ? { method, shares: parts(ids.map((_, k) => BigInt(k === 0 ? 1 + int(999) : int(1000)))), adjustments }
        : {
            method,
            // items cover 1..base (all of it, or less and the rest is tax & tip); nothing when base is 0
            items: cut(base && 1n + below(base), 1 + int(4)).map((amount, k) => ({ name: `Item ${k}`, amount, memberIds: somePeople() })),
            adjustments,
          };

      const r = splitExpense(total, spec, "INR");
      if (!r.ok) throw new Error(`case ${i}: ${r.error}`);
      expect(r.shares.reduce((s, x) => s + x.value, 0n), `case ${i}`).toBe(total);
      expect(r.shares.every((s) => s.value > 0n), `case ${i}`).toBe(true);
      expect(new Set(r.shares.map((s) => s.memberId)).size, `case ${i}`).toBe(r.shares.length);
      expect(splitExpense(total, spec, "INR"), `case ${i}`).toEqual(r);
    }
  });
});
