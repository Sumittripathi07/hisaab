// Who pays whom, in bigint minor units. Pure: runs on the server and in the browser.
// A net is positive when the member is owed (a creditor), negative when they owe.

export type Transfer = { from: string; to: string; amount: bigint }; // `from` pays `to`

/** The id with the largest `sign · net` (> 0), ties to the smaller id. */
function largest(nets: Map<string, bigint>, sign: bigint): string {
  let best = "";
  let bestValue = 0n;
  for (const [id, net] of nets) {
    const value = sign * net;
    if (value > bestValue || (value === bestValue && value > 0n && id < best)) [best, bestValue] = [id, value];
  }
  return best;
}

/**
 * Greedy min-cash-flow: the largest debtor pays the largest creditor the smaller of the two amounts, until
 * everyone is at zero. Each round clears at least one member, so at most (non-zero members − 1) transfers.
 */
export function simplifyDebts(nets: ReadonlyMap<string, bigint>): Transfer[] {
  if ([...nets.values()].reduce((s, v) => s + v, 0n) !== 0n) throw new Error("Balances must sum to zero");
  const left = new Map([...nets].filter(([, v]) => v !== 0n));
  const transfers: Transfer[] = [];
  // ponytail: O(n²) re-scan for the max each round; fine for a group's few dozen members, use heaps if that grows
  while (left.size) {
    const from = largest(left, -1n);
    const to = largest(left, 1n);
    const debt = -left.get(from)!;
    const credit = left.get(to)!;
    const amount = debt < credit ? debt : credit;
    transfers.push({ from, to, amount });
    if (debt === amount) left.delete(from);
    else left.set(from, amount - debt);
    if (credit === amount) left.delete(to);
    else left.set(to, credit - amount);
  }
  return transfers;
}

/**
 * Who owes whom directly: simplifies each event (one expense's or settlement's nets) on its own, then nets
 * the transfers per pair. Sorted by amount desc, then `from`, then `to`.
 */
export function pairwiseDebts(events: ReadonlyMap<string, bigint>[]): Transfer[] {
  const pairs = new Map<string, Transfer>(); // keyed by the sorted pair, `from` < `to`; amount may go negative
  for (const event of events) {
    for (const { from, to, amount } of simplifyDebts(event)) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const key = JSON.stringify([lo, hi]);
      const pair = pairs.get(key) ?? { from: lo, to: hi, amount: 0n };
      pair.amount += from === lo ? amount : -amount;
      pairs.set(key, pair);
    }
  }
  return [...pairs.values()]
    .filter((p) => p.amount !== 0n)
    .map((p) => (p.amount > 0n ? p : { from: p.to, to: p.from, amount: -p.amount }))
    .sort((a, b) =>
      a.amount !== b.amount ? (a.amount > b.amount ? -1 : 1)
      : a.from !== b.from ? (a.from < b.from ? -1 : 1)
      : a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
    );
}
