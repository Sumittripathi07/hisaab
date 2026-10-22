import { describe, expect, it } from "vitest";
import { pairwiseDebts, simplifyDebts, type Transfer } from "./simplify";

const nets = (o: Record<string, bigint>) => new Map(Object.entries(o));
const t = (from: string, to: string, amount: bigint) => ({ from, to, amount });

/** mulberry32, returning the raw uint32 so no float ever touches an amount. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Applies `transfers` to `nets` and asserts every net ends at zero, with sane transfers. */
function expectClears(start: ReadonlyMap<string, bigint>, transfers: Transfer[]) {
  const left = new Map(start);
  for (const { from, to, amount } of transfers) {
    expect(amount > 0n).toBe(true);
    expect(from).not.toBe(to);
    left.set(from, (left.get(from) ?? 0n) + amount);
    left.set(to, (left.get(to) ?? 0n) - amount);
  }
  for (const net of left.values()) expect(net).toBe(0n);
}

describe("simplifyDebts", () => {
  it("one payer, two debtors", () => expect(simplifyDebts(nets({ a: 200n, b: -100n, c: -100n }))).toEqual([t("b", "a", 100n), t("c", "a", 100n)]));
  it("collapses a chain", () => expect(simplifyDebts(nets({ a: -10n, b: 0n, c: 10n }))).toEqual([t("a", "c", 10n)]));
  it("largest first", () =>
    expect(simplifyDebts(nets({ a: 500n, b: 300n, c: -600n, d: -200n }))).toEqual([t("c", "a", 500n), t("d", "b", 200n), t("c", "b", 100n)]));
  it("nothing to do", () => expect(simplifyDebts(nets({ a: 0n }))).toEqual([]));
  it("refuses unbalanced input", () => expect(() => simplifyDebts(nets({ a: 1n }))).toThrow("Balances must sum to zero"));
  it("pairwise keeps who owes whom", () => {
    const owed = [nets({ a: 50n, b: -50n }), nets({ b: 50n, c: -50n })];
    expect(pairwiseDebts(owed)).toEqual([t("b", "a", 50n), t("c", "b", 50n)]);
    expect(pairwiseDebts([...owed, nets({ b: 50n, a: -50n })])).toEqual([t("c", "b", 50n)]); // b paid a back
  });

  const next = mulberry32(2026);
  const int = (n: number) => next() % n; // [0, n)
  const below = (n: bigint) => ((BigInt(next()) << 32n) | BigInt(next())) % n; // [0, n), n ≤ 2^64
  /** 1–15 members (ids from a pool of 20) with random nets, some zero, summing to zero. */
  const randomNets = () => {
    const cap = 10n ** BigInt(1 + int(11));
    const ids = [...new Set(Array.from({ length: 1 + int(15) }, () => `m${int(20)}`))];
    const out = new Map<string, bigint>();
    let sum = 0n;
    ids.forEach((id, k) => {
      const v = k === ids.length - 1 ? -sum : int(4) ? below(2n * cap + 1n) - cap : 0n;
      out.set(id, v);
      sum += v;
    });
    return out;
  };

  it("random nets: ≤ n−1 transfers that clear everything (3,000 cases)", () => {
    for (let i = 0; i < 3000; i++) {
      const start = randomNets();
      const transfers = simplifyDebts(start);
      const nonZero = [...start.values()].filter((v) => v !== 0n).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      expectClears(start, transfers);
    }
  });

  it("random events: pairwise transfers clear the summed nets (1,000 cases)", () => {
    for (let i = 0; i < 1000; i++) {
      const events = Array.from({ length: 1 + int(8) }, randomNets);
      const summed = new Map<string, bigint>();
      for (const e of events) for (const [id, v] of e) summed.set(id, (summed.get(id) ?? 0n) + v);
      const transfers = pairwiseDebts(events);
      expectClears(summed, transfers);
      // one transfer per pair, sorted by amount desc, then from, then to
      const pairs = transfers.map(({ from, to }) => [from, to].sort().join(" "));
      expect(new Set(pairs).size).toBe(pairs.length);
      for (let k = 1; k < transfers.length; k++) {
        const [a, b] = [transfers[k - 1], transfers[k]];
        expect(a.amount > b.amount || (a.amount === b.amount && (a.from < b.from || (a.from === b.from && a.to < b.to)))).toBe(true);
      }
    }
  });
});
