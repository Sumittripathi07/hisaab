# Hisaab Phase 2 (Money Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People in a group can add expenses with a keypad (multiple payers; equal, exact, percent, shares or
itemised splits; adjustments), see balances and simplified debts, settle up over UPI or by recording a payment,
dispute a payment they never got, undo deletes, comment, and follow an activity feed. Every number is exact.

**Architecture:** A pure, framework-free money core in `src/lib/money/` (bigint minor units) does all
arithmetic. Services in `src/server/*.ts` take `userId`, pass through `requireMember`/`requireMemberFor`,
write each change and its `Activity` row in one transaction, and compute balances on read with one SQL
statement. Thin `"use server"` actions wrap the services with `defineAction`. The group page gets Expenses,
Balances and Activity tabs, and settle-up and detail pages hang off it.

**Tech Stack:** Next.js 16.4 · React 19 · TypeScript strict · Prisma 7.10 (`BigInt`, `Decimal`, `$queryRaw`)
· PostgreSQL 16 · Zod 4 · Tailwind 4 + shadcn (Base UI) · `qrcode` · `sonner` · Vitest 5 · Playwright 1.64.
No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-hisaab-design.md` (§3 Expenses, §6 Balances & debt
simplification, §7 Settle up, §11 Activity & comments, Data Model, Authorisation rule, Build Phase 2).
The Phase 0–1 plan (`docs/superpowers/plans/2026-10-22-hisaab-phase-0-1.md`) defines everything this one
builds on.

## Global Constraints

- Build on branch `feat/phase-2` cut from `main`, and merge through a PR in Task 15. (CI runs checks on PRs,
  and `main` deploys directly.)
- **Money is `bigint` minor units** in every service and lib function, and Prisma `BigInt` columns in the
  DB. Never use a JS `number`, a float or `Number(...)` for money. Percentages are integer **basis points**
  (`3333n` = 33.33%). Shares are whole numbers from 0 to 999.
- **`bigint` never crosses JSON or the server→client boundary.** Action inputs, `splitInput` JSON, activity
  payloads and client-component props carry amounts as `MinorString`: an integer count of minor units as a
  decimal string (`"33333"`, `"-500"`), or as already-formatted text.
- Display every amount with `formatMoney` (Task 1). The UPI `am=` value uses `formatDecimal(amount, 2)`.
- **Phase 2 is single-currency per group.** Every expense and settlement gets `currency =
  group.baseCurrency`, `fxRate = 1` and `baseAmount = amount`, and payer/share rows get `baseAmount =
  amount`. Balances read `baseAmount` only, so Phase 4's FX doesn't change the balance code.
- A largest-remainder leftover goes to the **earliest-sorted member**. Services sort every member list by
  `GroupMember.createdAt`, then `id`, before splitting, whatever order the client sent.
- Every service starts with `requireMember` or `requireMemberFor`. A member id from the client is never
  trusted to belong to the group: services check every referenced member id against the group.
- A money/comment/member mutation and its `Activity` row are written in **one `db.$transaction`**, through
  `recordActivity` (Task 4). It also bumps `group.updatedAt`.
- Actions follow the existing pattern (`defineAction`, Zod input) and call `revalidateGroup()` (Task 4) after
  a write. New id-based actions take only the entity id: services look up the group from the entity.
- Before writing pages, search params or server actions, read the matching guide in
  `node_modules/next/dist/docs/`, since Next 16 differs from older versions (see `AGENTS.md`).
- Every new actions file gets rows in `test/authz-actions.test.ts` in the same task that creates it.
- User-facing strings are exactly as written in this plan.
- UI: mobile-first; sheets use `ResponsiveSheet`; touch targets ≥ 44px (`h-11`); visible focus rings; live
  validation in an `aria-live="polite"` region; colour is never the only signal (owe/owed always has words);
  `prefers-reduced-motion` respected. Check each new screen at 375px and 1280px, light and dark, in the
  browser pane.
- Every Playwright browser context comes from `newPage` or `signedInPage` in `e2e/helpers.ts`. Each gets its
  own `x-forwarded-for` (the Phase 1 carry-over is already in the helpers).
- Calendar dates (`Expense.date`, `Settlement.date`) are Postgres `date` columns, exchanged as
  `"YYYY-MM-DD"` strings. "Today" is computed on the server in the user's `timezone` (`todayIn`, Task 1),
  so it never causes a hydration mismatch.

**Deliberate deviations from the spec (recorded so reviewers don't flag them):**
- `Expense`, `Settlement`, `Comment` and `Activity` reference the **GroupMember** (`createdByMemberId`,
  `authorMemberId`, `actorMemberId`), not the User. Names then come from the group, survive account
  deletion, and compare directly with payer/share rows.
- No `ExpenseItem`/`ExpenseItemAssignee` tables. Itemised splits keep their items in `splitInput`, and Phase
  4 adds tables if receipts need them. `receiptId`, `recurringId` and `occurrenceDate` arrive with Phases 4
  and 5.
- `Comment` has a `groupId` column (one lookup for authorisation and listing). The service enforces "exactly
  one of `expenseId`/`settlementId`", not a CHECK constraint.
- **The payee may also record a payment they received.** The spec allows only the payer, or a payment between
  two placeholders, but its own "either side can resolve it by re-recording" needs the payee to record too.
- Itemised splits are entered by hand in Phase 2. Whatever the items don't cover (total − item sum) is shown
  as "Tax, tip & service" and shared in proportion to each person's items. Phase 4 prefills the items from a
  receipt.
- Deferred: @mentions and all notifications, including "payer is notified of a dispute" (Phase 3, with the
  notification centre; Phase 2 writes the activity row); receipt photos, the "≈ total in your default
  currency" dashboard line and the has-receipt filter (Phase 4); the Friends tab and per-friend balances (with DIRECT groups,
  Phase 4); confetti (Phase 6; Phase 2 shows "All settled up 🎉").
- The optional DB "one active owner" partial unique index is **skipped**. Prisma 7.10 can't declare partial
  indexes, so a raw-SQL index would be dropped by the next `migrate dev`. The conditional updates in
  `members.ts` already keep one owner.
- Lists grow with a `limit` search param ("Show more") instead of cursors. The Expenses tab lists expenses
  only; payments are listed under Balances ("Recent payments") and in Activity. Settlement edits have no
  `version` column (last write wins).

## Review Focus

1. **A member id from another group, or from someone who left, is put into an expense or settlement
   payload** (a crafted request, or a stale form). This should be refused with the exact message, and nothing
   is written. → tests in Tasks 5 and 8.
2. **Two people edit the same expense at once.** The second save gets "Ravi edited this just now — reload?"
   with a Reload action, and neither edit is silently lost. → test in Task 5, e2e in Task 12.
3. **An expense involving someone who has since left is restored or edited.** Balances still net to zero,
   and the person who left shows up with their balance and can be settled with. → test in Task 7.
4. **Double-tapping Save or Mark as paid on a phone.** Exactly one expense or payment is created. → e2e in
   Tasks 10 and 13.
5. **Odd amounts:** ₹0.01 split three ways, the maximum amount, a JPY group (no decimals), typing a third
   decimal, or pasting "1,23,456.78". Nothing drifts, the keypad refuses digits the currency can't hold, and
   splits sum exactly. → tests in Tasks 1, 2 and 10.

---

## File Map

```
prisma/schema.prisma, prisma/migrations/<ts>_money/            # Task 4
src/lib/money/{format,split,simplify}.ts (+ .test.ts)          # Tasks 1–3, pure
src/lib/{dates,categories,keypad,upi,activity}.ts (+ .test.ts)  # pure helpers
src/lib/validation.ts                                          # + money/expense/settlement/comment schemas
src/server/{authz,errors,action,revalidate,activity}.ts        # Task 4
src/server/{expenses,balances,settlements,comments}.ts         # Tasks 5–9
src/server/{members,groups}.ts                                 # activity, zero-balance guards, currency lock, myNet
src/server/actions/{expenses,settlements,comments}.ts
src/app/(app)/groups/[groupId]/{page.tsx, expenses/[expenseId]/page.tsx, settle/page.tsx,
                               settlements/[settlementId]/page.tsx}
src/app/(app)/{activity/page.tsx, dashboard/page.tsx, layout.tsx}
src/components/{keypad, expense-sheet, split-editor, payers-editor, expense-list, expense-filters,
               expense-actions, group-tabs, add-expense-fab, balance-panel, settle-card, settlement-sheet,
               settlement-actions, comment-thread, activity-feed}.tsx
test/{activity,expenses,expense-reads,balances,settlements,comments}.test.ts (+ authz, action, authz-actions, factories)
e2e/{expenses,settle,trip}.spec.ts, e2e/helpers.ts
```

---

### Task 1: Money and date formatting

**Files:**
- Create: `src/lib/money/format.ts`, `src/lib/money/format.test.ts`, `src/lib/dates.ts`, `src/lib/dates.test.ts`.

**Interfaces:**
- Produces in `format.ts`:
  - `type MinorString = string`
  - `MAX_AMOUNT = 99_999_999_999n` (11 digits of minor units)
  - `minorDigits(currency: string): number`: `maximumFractionDigits` of an `Intl.NumberFormat("en", { style: "currency", currency })`. INR 2, JPY 0, KWD 3.
  - `parseDecimal(input: string, digits: number): bigint | null`: trims, drops `,`, and accepts `^\d+(\.\d*)?$` or `^\.\d+$`. More fraction digits than `digits`, a sign, an exponent or empty → `null`.
  - `formatDecimal(value: bigint, digits: number): string`: no grouping, always `digits` decimals.
  - `parseMoney(input: string, currency: string) = parseDecimal(input, minorDigits(currency))`
  - `formatMoney(minor: bigint, currency: string): string`: locale `"en-IN"` for INR, otherwise `"en"`. No decimals when the amount is whole, else exactly `minorDigits` decimals. Format the exact decimal **string** (`Intl.NumberFormat#format` accepts one), never a `number`.
  - `formatPercent(basisPoints: bigint): string`: trailing zeros dropped (`1000n` → `"10"`, `1250n` → `"12.5"`, `1n` → `"0.01"`).
- Produces in `dates.ts`:
  - `todayIn(timeZone: string): string`: `"YYYY-MM-DD"` (an `en-CA` `Intl.DateTimeFormat` with that `timeZone`).
  - `formatDay(date: string): string`: `"2026-10-23"` → `"23 Oct"` when the year is the current year, else `"23 Oct 2025"`.
  - `monthLabel(date: string): string`: `"October 2026"`.
  - `toDbDate(date: string): Date` (UTC midnight) and `fromDbDate(d: Date): string`.

- [ ] **Step 1: Write the failing tests**

`src/lib/money/format.test.ts`:
```ts
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
```

`src/lib/dates.test.ts`: `todayIn("Asia/Kolkata")` matches `/^\d{4}-\d{2}-\d{2}$/` and equals the
`en-CA` date for that zone at a fixed `vi.setSystemTime(new Date("2026-10-22T20:00:00Z"))` → `"2026-10-23"`
(while `todayIn("UTC")` → `"2026-10-22"`). Also `formatDay` (same year / other year), `monthLabel`, and
`fromDbDate(toDbDate("2026-02-28")) === "2026-02-28"`.

- [ ] **Step 2: Run** `pnpm test src/lib`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** both files to the interfaces above.

- [ ] **Step 4: Run** `pnpm test src/lib`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(money): exact minor-unit parsing and formatting, date helpers"` (include files).

---

### Task 2: Splits (largest remainder)

**Files:**
- Create: `src/lib/money/split.ts`, `src/lib/money/split.test.ts`.

**Interfaces:**
- Consumes: `formatMoney`, `formatPercent` (Task 1).
- Produces:
  ```ts
  export type Part = { memberId: string; value: bigint };
  export type SplitSpec = (
    | { method: "EQUAL"; memberIds: string[] }
    | { method: "EXACT"; amounts: Part[] }
    | { method: "PERCENT"; basisPoints: Part[] }       // must sum to 10000n
    | { method: "SHARES"; shares: Part[] }
    | { method: "ITEMIZED"; items: { name: string; amount: bigint; memberIds: string[] }[] }
  ) & { adjustments?: Part[] };                         // signed, on top of any method
  export type SplitResult = { ok: true; shares: Part[] } | { ok: false; error: string };
  export function allocate(total: bigint, weights: bigint[]): bigint[];
  export function splitExpense(total: bigint, spec: SplitSpec, currency: string): SplitResult;
  export function checkPayers(total: bigint, payers: Part[], currency: string): string | null;
  ```

Rules the signatures don't determine:
- `allocate`: needs `total ≥ 0n`, every weight `≥ 0n` and a weight sum `> 0n`, else it throws `RangeError` (a
  programming error). `part_i = total·w_i / Σw` (floored). The leftover `L = total − Σpart` goes as +1 to the
  `L` entries with the largest remainder `total·w_i mod Σw`. **Ties go to the lower index.**
- `splitExpense`:
  1. `base = total − Σadjustments`. If `base < 0n` → `"Adjustments add up to more than the total"`.
  2. Split `base` by the method:
     - EQUAL: `allocate(base, 1n each)`. No members → `"Choose who's splitting this"`.
     - EXACT: the amounts must sum to `base`. Short → `` `${formatMoney(base − Σ)} left to assign` ``. Over → `` `${formatMoney(Σ − base)} over the total` ``.
     - PERCENT: short → `` `${formatPercent(10000n − Σ)}% left to assign` ``. Over → `` `${formatPercent(Σ − 10000n)}% over 100%` ``. Then `allocate(base, basisPoints)`.
     - SHARES: a share sum of 0 → `"Choose who's splitting this"`. Then `allocate(base, shares)`.
     - ITEMIZED:
       - No items → `"Add at least one item"`.
       - An item with no people → `` `Choose who had “${name}”` ``.
       - `Σitems > base` → `` `Items add up to ${formatMoney(Σitems − base)} more than the total` ``.
       - Otherwise, each item is `allocate`d equally among its people. The extras (`base − Σitems`) are then `allocate`d by each person's item subtotal.
       - People are ordered by their first appearance across the items.
  3. Add each adjustment to its person; an adjustment-only person is appended in adjustment order. Any
     result below zero → `"Adjustments can't take anyone's share below zero"`.
  4. Return the shares in that order and **omit zeros**.
- `checkPayers`:
  - No payers → `"Choose who paid"`.
  - Short → `` `${formatMoney(total − Σ)} of the total isn't paid by anyone` ``.
  - Over → `` `Payers add up to ${formatMoney(Σ − total)} more than the total` ``.
  - Otherwise `null`.

- [ ] **Step 1: Write the failing tests** `src/lib/money/split.test.ts`

```ts
const p = (memberId: string, value: bigint) => ({ memberId, value });
const shares = (r: SplitResult) => (r.ok ? Object.fromEntries(r.shares.map((s) => [s.memberId, s.value])) : r.error);

it.each([
  [100000n, [1n, 1n, 1n], [33334n, 33333n, 33333n]], [5n, [1n, 2n], [2n, 3n]], [2n, [1n, 1n, 1n], [1n, 1n, 0n]],
  [10n, [0n, 1n, 1n], [0n, 5n, 5n]], [99999n, [2000n, 2000n, 2000n, 2000n, 2000n], [20000n, 20000n, 20000n, 20000n, 19999n]],
])("allocate(%s, %j)", (total, weights, out) => expect(allocate(total, weights)).toEqual(out));
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
  // A seeded PRNG (mulberry32, seed 2026) builds a valid spec for a random method (1–12 members, total 1..MAX_AMOUNT,
  // random non-negative adjustments whose sum ≤ total). Assert: ok, Σshares === total, every share > 0n,
  // no repeated memberId, and the same input split twice gives deep-equal output.
});
```

- [ ] **Step 2: Run** `pnpm test src/lib/money/split.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `split.ts` to the rules above.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(money): largest-remainder splits for every method with adjustments"` (include files).

---

### Task 3: Debt simplification and pairwise debts

**Files:**
- Create: `src/lib/money/simplify.ts`, `src/lib/money/simplify.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type Transfer = { from: string; to: string; amount: bigint };   // `from` pays `to`
  export function simplifyDebts(nets: ReadonlyMap<string, bigint>): Transfer[];
  export function pairwiseDebts(events: ReadonlyMap<string, bigint>[]): Transfer[];
  ```
  A net is positive when the member is owed (a creditor).

Rules:
- `simplifyDebts` throws `Error("Balances must sum to zero")` when Σ ≠ 0. Then it is greedy min-cash-flow:
  1. Take the debtor with the largest debt and the creditor with the largest credit. Break ties by the
     smaller id (`<` on strings).
  2. Transfer the smaller of the two amounts and drop whoever reaches zero.
  3. Repeat. The output is in generation order, and has at most (non-zero members − 1) transfers.
- `pairwiseDebts`: each event is one expense's or one settlement's nets, each summing to zero.
  1. Run `simplifyDebts` on each event.
  2. Accumulate the results per unordered pair and net each pair.
  3. Return a debtor→creditor transfer for each non-zero pair, sorted by amount desc, then `from`, then `to`.

- [ ] **Step 1: Write the failing tests** `src/lib/money/simplify.test.ts`

```ts
const nets = (o: Record<string, bigint>) => new Map(Object.entries(o));
const t = (from: string, to: string, amount: bigint) => ({ from, to, amount });

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
it("random nets: ≤ n−1 transfers that clear everything (3,000 cases)", () => {
  // Seeded PRNG: 1–15 members with random nets summing to zero. Assert: length ≤ max(0, nonZero − 1); every amount > 0n;
  // from !== to; applying the transfers (from += amount, to -= amount) zeroes every net.
});
it("random events: pairwise transfers clear the summed nets (1,000 cases)", () => { /* same check against Σ events */ });
```

- [ ] **Step 2: Run** `pnpm test src/lib/money/simplify.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `simplify.ts`. (n is at most a few dozen, so an O(n²) re-scan for the max each round is fine.)

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(money): greedy debt simplification and pairwise debts"` (include files).

---

### Task 4: Schema, `requireMemberFor`, activity recording, conflict errors

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/authz.ts`, `src/server/errors.ts`, `src/server/action.ts`,
  `src/server/members.ts`, `src/server/actions/groups.ts`, `src/server/actions/members.ts`,
  `test/factories.ts`, `test/authz.test.ts`, `test/action.test.ts`.
- Create: migration `money`, `src/server/revalidate.ts`, `src/server/activity.ts`, `src/lib/activity.ts`
  (types only for now; Task 9 adds `describeActivity`), `test/activity.test.ts`.

**Interfaces:**
- Models (`id String @id @default(cuid())` everywhere, `createdAt DateTime @default(now())`):
  - `enum SplitMethod { EQUAL EXACT PERCENT SHARES ITEMIZED }`, `enum SettlementMethod { UPI CASH BANK OTHER }`, `enum SettlementStatus { RECORDED DISPUTED }`
  - `Expense { groupId → Group (cascade), description, category String, notes String?, date DateTime @db.Date, currency, amount BigInt, fxRate Decimal @default(1) @db.Decimal(18, 8), baseAmount BigInt, splitMethod SplitMethod, splitInput Json, createdByMemberId → GroupMember, version Int @default(1), deletedAt DateTime?, updatedAt @updatedAt }`, with `@@index([groupId, date])`
  - `ExpensePayer` and `ExpenseShare`, each `{ expenseId → Expense (cascade), memberId → GroupMember, amount BigInt, baseAmount BigInt }`, with `@@unique([expenseId, memberId])` and `@@index([memberId])`
  - `Settlement { groupId → Group (cascade), fromMemberId → GroupMember ("SettlementFrom"), toMemberId → GroupMember ("SettlementTo"), currency, amount BigInt, fxRate Decimal @default(1) @db.Decimal(18, 8), baseAmount BigInt, method SettlementMethod, status SettlementStatus @default(RECORDED), note String?, date DateTime @db.Date, createdByMemberId → GroupMember ("SettlementCreatedBy"), disputedAt DateTime?, deletedAt DateTime?, updatedAt @updatedAt }`, with `@@index([groupId, date])`
  - `Comment { groupId → Group (cascade), expenseId String? → Expense (cascade), settlementId String? → Settlement (cascade), authorMemberId → GroupMember, body String, deletedAt DateTime? }`, with `@@index([expenseId, createdAt])` and `@@index([settlementId, createdAt])`
  - `Activity { groupId → Group (cascade), actorMemberId → GroupMember, kind String, entityId String, payload Json }`, with `@@index([groupId, createdAt])` and `@@index([entityId, createdAt])`
- Produces in `src/lib/activity.ts` (pure, importable by client code):
  ```ts
  export type ActivityKind =
    | "expense.created" | "expense.updated" | "expense.deleted" | "expense.restored"
    | "settlement.created" | "settlement.updated" | "settlement.deleted" | "settlement.restored" | "settlement.disputed"
    | "comment.created" | "member.joined" | "member.added" | "member.left" | "member.removed";
  export type ExpenseSnapshot = { description: string; amount: MinorString; currency: string; net: Record<string, MinorString> }; // paid − share; zeros omitted
  export type ExpenseChange = { field: "description" | "amount" | "date" | "category" | "notes" | "payers" | "split"; before: string | null; after: string | null };
  export type SettlementSnapshot = { fromMemberId: string; toMemberId: string; amount: MinorString; currency: string; method: "UPI" | "CASH" | "BANK" | "OTHER" };
  export type ActivityPayloads = {
    "expense.created": ExpenseSnapshot; "expense.deleted": ExpenseSnapshot; "expense.restored": ExpenseSnapshot;
    "expense.updated": ExpenseSnapshot & { changes: ExpenseChange[] };
    "settlement.created": SettlementSnapshot; "settlement.updated": SettlementSnapshot; "settlement.deleted": SettlementSnapshot;
    "settlement.restored": SettlementSnapshot; "settlement.disputed": SettlementSnapshot;
    "comment.created": { targetKind: "expense" | "settlement"; targetId: string; targetLabel: string; excerpt: string };
    "member.joined": MemberRef; "member.added": MemberRef; "member.left": MemberRef; "member.removed": MemberRef;
  };
  type MemberRef = { memberId: string; displayName: string };
  ```
- Produces in `src/server/activity.ts`:
  `recordActivity<K extends ActivityKind>(tx: Prisma.TransactionClient, input: { groupId: string; actorMemberId: string; kind: K; entityId: string; payload: ActivityPayloads[K] }): Promise<void>`.
  It inserts the row and sets `group.updatedAt = new Date()`.
- Produces in `authz.ts`:
  `requireMemberFor<E extends "expense" | "settlement" | "comment">(userId: string, entity: E, id: string, opts?: { write?: boolean; role?: "admin" | "owner" }): Promise<{ member: GroupMember; group: Group; row: { expense: Expense; settlement: Settlement; comment: Comment }[E] }>`.
  It finds the row by id, then calls `requireMember(userId, row.groupId, opts)`. An unknown id → `ForbiddenError`
  (the same as an outsider). It also returns soft-deleted rows, and callers decide what to do with them.
- Produces in `errors.ts`: `class ConflictError extends UserError` (`name = "ConflictError"`).
- Changes in `action.ts`: `ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: "conflict" }`.
  `ConflictError` → `{ ok: false, error: message, code: "conflict" }`, checked before `UserError`.
- Produces in `revalidate.ts`: `revalidateGroup(): void`. It revalidates `/dashboard`, `/groups` and
  `/activity`, plus `revalidatePath("/groups/[groupId]", "layout")`, which covers each group page and its
  sub-pages. (Next 16 takes `type` only with a route pattern, never with a literal path.) Replace the
  `refresh` helpers in `actions/groups.ts` and `actions/members.ts` with it, and keep those actions' input
  shapes unchanged.
- Changes in `members.ts`: each of these writes, plus its activity, goes in one transaction:
  - `joinByInviteCode` → `member.joined`, only when it actually (re)joined.
  - `claimPlaceholder` → `member.joined`.
  - `addPlaceholder` → `member.added` (the row and the activity, before the email).
  - `leaveGroup` → `member.left`.
  - `removeMember` → `member.removed`.

  The existing conditional-update semantics stay as they are.
- Produces in `test/factories.ts`:
  - `memberOf(groupId, userId): Promise<GroupMember>`
  - `createExpenseRow(groupId, data: { createdByMemberId: string; payers: [string, bigint][]; shares: [string, bigint][]; description?: string; deletedAt?: Date }): Promise<Expense>`.
    `amount` = Σpayers, method `EXACT`.
  - `createSettlementRow(groupId, data: { fromMemberId; toMemberId; amount: bigint; createdByMemberId; status?: SettlementStatus; deletedAt?: Date }): Promise<Settlement>`
  - `createCommentRow(data: { groupId; authorMemberId; expenseId?: string; settlementId?: string; body?: string }): Promise<Comment>`

- [ ] **Step 1: Write the failing tests**

`test/authz.test.ts` (append):
```ts
describe("requireMemberFor", () => {
  it.each(["expense", "settlement", "comment"] as const)("finds a %s's group for a member", async (entity) => {
    const { member, group, row } = await requireMemberFor(owner.id, entity, ids[entity]);
    expect([member.id, group.id, row.id]).toEqual([ownerMember.id, g.id, ids[entity]]);
  });
  it.each(["expense", "settlement", "comment"] as const)("forbids an outsider from a %s", async (entity) =>
    await expect(requireMemberFor(stranger.id, entity, ids[entity])).rejects.toBeInstanceOf(ForbiddenError));
  it("forbids an id that doesn't exist", async () => await expect(requireMemberFor(owner.id, "expense", "nope")).rejects.toBeInstanceOf(ForbiddenError));
  it("refuses writes in an archived group", async () => { /* archive g → rejects "This group is archived." */ });
  it("still finds a soft-deleted row", async () => { /* expense with deletedAt → resolves, row.deletedAt set */ });
});
```

`test/action.test.ts`: `defineAction(z.object({}), async () => { throw new ConflictError("Ravi edited this just now — reload?"); })({})`
→ `{ ok: false, error: "Ravi edited this just now — reload?", code: "conflict" }`.

`test/activity.test.ts`:
```ts
it("records an activity and moves its group to the top of the dashboard", async () => {
  // asha owns g1 then g2 (g2 listed first); recordActivity(g1, member.added) inside db.$transaction
  // → listGroupsForUser(asha).active[0].id === g1.id; Activity row has kind "member.added" and the payload
});
it("logs joining, adding, leaving and removing members", async () => {
  // joinByInviteCode(ravi) → member.joined, actor = ravi's member row; joining again logs nothing new
  // addPlaceholder("Rahul") → member.added { displayName: "Rahul" }; leaveGroup(ravi) → member.left;
  // removeMember(asha, rahul) → member.removed, actor = asha's member
});
```

- [ ] **Step 2: Run** `pnpm prisma migrate dev --name money && pnpm test`. Expected: the new tests FAIL; the old ones still pass.

- [ ] **Step 3: Implement** everything listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(money): expense, settlement, comment and activity models; requireMemberFor; activity log"` (include files).

---

### Task 5: Expense writes (create, edit, delete, restore)

**Files:**
- Create: `src/lib/categories.ts`, `src/lib/categories.test.ts`, `src/server/expenses.ts`,
  `src/server/actions/expenses.ts`, `test/expenses.test.ts`.
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`, `test/authz-actions.test.ts`.

**Interfaces:**
- Consumes: `splitExpense`, `checkPayers`, `Part` (Task 2), `formatMoney`, `MAX_AMOUNT`, `formatDay`,
  `toDbDate` (Task 1), `requireMember`, `requireMemberFor`, `recordActivity`, `ConflictError`,
  `revalidateGroup` (Task 4).
- Produces in `categories.ts`: `CATEGORIES` (in this order, `{ label, emoji, keywords: string[] }`):
  - `food` "Food & drink" 🍽️
  - `groceries` "Groceries" 🛒
  - `transport` "Transport" 🚕
  - `fuel` "Fuel" ⛽
  - `stay` "Stay" 🏨
  - `travel` "Travel" ✈️
  - `rent` "Rent" 🏠
  - `utilities` "Utilities" 💡
  - `shopping` "Shopping" 🛍️
  - `entertainment` "Entertainment" 🎬
  - `health` "Health" 💊
  - `gifts` "Gifts" 🎁
  - `other` "Other" 🧾 (no keywords)

  Each category except `other` gets about 6–15 single-word, lowercase, India-aware keywords (e.g. food: dinner, lunch,
  zomato, swiggy, chai…).
  Also `type Category`, `CATEGORY_KEYS`, and
  `suggestCategory(description: string, past: { description: string; category: string }[]): Category`. Its rules:
  1. The most recent past entry whose normalised description (trimmed, lowercased, spaces collapsed) is equal
     wins.
  2. Otherwise, the first category whose keyword equals a word of the description.
  3. Otherwise `"other"`.
- Produces in `validation.ts`:
  - `minorSchema`: `/^\d{1,11}$/` → `bigint`.
  - `positiveMinorSchema`: as `minorSchema`, plus "Enter an amount above zero".
  - `adjustmentSchema`: `/^-?\d{1,11}$/` → `bigint`.
  - `isoDateSchema = z.iso.date()`.
  - `splitSpecSchema`: a discriminated union on `method` mirroring `SplitSpec`, with `adjustments` defaulting
    to `[]`. Value rules:
    - EQUAL `memberIds` min 1.
    - EXACT values use `minorSchema`.
    - PERCENT values are `/^\d{1,5}$/` and ≤ 10000.
    - SHARES values are `/^\d{1,3}$/`.
    - ITEMIZED has 1–100 items `{ name: trimmed 1–60, amount: positiveMinorSchema, memberIds }`.

    Any member id repeated within one list (or within one item) → "Each person can only appear once".
  - `expenseInputSchema = z.object({ groupId, description: trimmed 1–100 ("Add a description" / "Description must be 100 characters or fewer"), amount: positiveMinorSchema (≤ MAX_AMOUNT), category: z.enum(CATEGORY_KEYS), date: isoDateSchema, notes: trimmed ≤ 1000, "" → null, payers: z.array({ memberId, value: positiveMinorSchema }).min(1, "Choose who paid"), split: splitSpecSchema })`.
  - Types `ExpenseInput` (output) and `ExpenseFormValues = Omit<z.input<typeof expenseInputSchema>, "groupId">` (strings).
- Produces in `expenses.ts`:
  - `createExpense(userId, input: ExpenseInput): Promise<{ id: string }>`
  - `updateExpense(userId, expenseId: string, version: number, input: Omit<ExpenseInput, "groupId">): Promise<{ version: number }>`
  - `deleteExpense(userId, expenseId): Promise<void>` and `restoreExpense(userId, expenseId): Promise<void>`
- Produces actions:
  - `createExpenseAction(expenseInputSchema)` → `{ id }`
  - `updateExpenseAction(expenseInputSchema.omit({ groupId: true }).extend({ expenseId, version: z.number().int().positive() }))`
  - `deleteExpenseAction({ expenseId })` and `restoreExpenseAction({ expenseId })`

  Each calls `revalidateGroup()`.

Service rules:
- **Members.** Every member id in `payers`, the split lists, the items and the adjustments must be an
  active member of this group. On update, a member already on this expense (payer or share) is also allowed.
  Otherwise → `UserError("Everyone in the expense must be a current member of the group.")`.
- **Order, then split.** Sort every member list in the spec by member `createdAt`, then `id`. Then call
  `checkPayers` and `splitExpense`, and turn either error into a `UserError` with that message.
- **Stored values.**
  - `currency = group.baseCurrency`, `fxRate = 1`, `baseAmount = amount` (the same on payer/share rows).
  - `splitMethod = split.method`.
  - `splitInput` = the sorted split with every bigint written as its decimal string (i.e. exactly
    `z.input<typeof splitSpecSchema>`).
  - `createdByMemberId` = the caller's member id.
- **Activity** in the same transaction, with an `ExpenseSnapshot` (net = paid − share per member).
- **Who may edit, delete or restore.** The creator (`member.id === row.createdByMemberId`) or an admin/owner.
  Anyone else → `UserError("Only the person who added this expense or an admin can change it.")`.
  `write: true` throughout.
- **Update:**
  - A deleted row → `UserError("This expense was deleted.")`.
  - An input with no changes writes nothing and returns the current version.
  - Otherwise, in one transaction:
    1. `updateMany({ where: { id, version, deletedAt: null }, data: { …, version: { increment: 1 } } })`.
    2. If the count is 0, re-read the row. Deleted → the "deleted" error above. Otherwise →
       `ConflictError(\`${name} edited this just now — reload?\`)`, where `name` is the `displayName` of the
       actor of the expense's latest activity.
    3. Replace the payer and share rows.
    4. Record `expense.updated`. Its `changes` hold:
       - description: raw text
       - amount: `formatMoney`
       - date: `formatDay`
       - category: label
       - notes: `null`/`null`
       - payers and split: `null`/`null` (listed only when they differ)
- **Delete / restore:**
  - A conditional `updateMany` on `deletedAt: null` / `not: null`, with `version` incremented.
  - When nothing changed, it's a no-op with no activity (so repeating is harmless).
  - When it did change, record `expense.deleted` / `expense.restored`.

- [ ] **Step 1: Write the failing tests**

`src/lib/categories.test.ts`:
```ts
it.each([["Dinner at Thalassa", "food"], ["Uber to airport", "transport"], ["Petrol", "fuel"], ["Xyz", "other"]])(
  "suggests %s → %s", (d, c) => expect(suggestCategory(d, [])).toBe(c));
it("past entries beat keywords", () => expect(suggestCategory(" dinner ", [{ description: "Dinner", category: "gifts" }])).toBe("gifts"));
```

`src/lib/validation.test.ts` (append): amount `"0"` → "Enter an amount above zero". `"123456789012"` is
refused. `"1.5"` is refused (minor units only). A repeated member in EQUAL → "Each person can only appear
once". `notes: ""` → `null`. PERCENT `"10001"` is refused.

`test/expenses.test.ts` (Asha = owner, Ravi = MEMBER user, Rahul = placeholder, created in that order; `input()`
builds a ₹1,000 expense paid by Asha, split equally among all three):
```ts
it("splits equally with the extra paisa to the earliest member, whatever order was sent", async () => {
  const { id } = await createExpense(asha.id, input({ split: equal([rahulM.id, raviM.id, ashaM.id]) }));
  expect(await sharesOf(id)).toEqual({ [ashaM.id]: 33334n, [raviM.id]: 33333n, [rahulM.id]: 33333n });
});
it("stores the group's currency and base amounts", async () => { /* currency INR, fxRate 1, baseAmount = amount on expense, payers and shares */ });
it("refuses payers that don't add up", async () =>
  await expect(createExpense(asha.id, input({ payers: [{ memberId: ashaM.id, value: 90000n }] }))).rejects.toThrow("₹100 of the total isn't paid by anyone"));
it("refuses someone from another group, or who left", async () => {
  // other group's member in split → "Everyone in the expense must be a current member of the group."; same for a left member;
  // nothing written (expense count 0)
});
it("refuses writes in an archived group", async () => { /* → "This group is archived." */ });
it("lets only the creator or an admin edit and delete", async () => {
  // Ravi (MEMBER) on Asha's expense → "Only the person who added this expense or an admin can change it." for update/delete/restore
});
it("refuses a stale edit with the editor's name", async () => {
  // make Ravi ADMIN; Ravi updates version 1 → ok (version 2); Asha updates version 1 →
  // rejects ConflictError "Ravi edited this just now — reload?"; via updateExpenseAction → { ok:false, code:"conflict", error: same }
});
it("replaces payers and shares and logs what changed", async () => {
  // update amount to 120000n (payer Asha 120000n) → shares sum 120000n; latest activity "expense.updated" with
  // changes containing { field: "amount", before: "₹1,000", after: "₹1,200" }; an identical second update writes nothing (version unchanged)
});
it("keeps a member who has left when editing their old expense", async () => {
  // Rahul is in the split; set his leftAt directly; edit the description → ok, Rahul's share row is kept
});
it("delete then restore brings it back and logs both", async () => {
  // delete twice → one "expense.deleted"; restore → deletedAt null, version 3, "expense.restored"
});
it("refuses editing a deleted expense", async () => { /* → "This expense was deleted." */ });
it("moves the group to the top of the dashboard", async () => { /* listGroupsForUser order flips after createExpense */ });
```

`test/authz-actions.test.ts`:
- Add `expenses.ts` to the directory list and import its actions.
- The target gets an `expenseId`, made with `createExpenseRow` in `beforeEach`.
- Rows: every expense action → `FORBIDDEN`. `createExpenseAction` uses the target group and its member ids.
- `snapshot()` also captures `expense`, `expensePayer`, `expenseShare` and `activity` rows for the target group.

- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the files listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(expenses): create, edit with optimistic concurrency, soft delete and restore"` (include files).

---

### Task 6: Expense reads (list, search, filters, detail, form data)

**Files:**
- Modify: `src/server/expenses.ts`.
- Create: `test/expense-reads.test.ts`.

**Interfaces:**
- Consumes: Task 5 models and `requireMember`/`requireMemberFor`, plus `fromDbDate` and `todayIn`.
- Produces:
  ```ts
  export type ExpenseFilters = { q?: string; memberId?: string; category?: Category; from?: string; to?: string };
  export type ExpenseListItem = { id: string; description: string; category: Category; date: string; amount: bigint; currency: string;
    payerLabel: string; myNet: bigint; commentCount: number };
  export async function listExpenses(userId: string, groupId: string, filters: ExpenseFilters, limit = 50): Promise<{ items: ExpenseListItem[]; hasMore: boolean }>;
  export type ExpenseDetail = {
    expense: { id; groupId; description; category: Category; notes: string | null; date: string; amount: bigint; currency: string;
      splitMethod: SplitMethod; version: number; createdAt: Date; createdBy: string /* displayName */ };
    split: z.input<typeof splitSpecSchema>;                          // splitInput, for prefilling an edit
    payers: { memberId: string; displayName: string; amount: bigint }[];
    shares: { memberId: string; displayName: string; amount: bigint }[];
    canEdit: boolean;
  };
  export async function getExpense(userId: string, expenseId: string): Promise<ExpenseDetail>;
  export type FormMember = { id: string; displayName: string; image: string | null; isPlaceholder: boolean; active: boolean };
  export type ExpenseFormData = { groupId: string; groupName: string; currency: string; today: string; me: string;
    members: FormMember[]; history: { description: string; category: string }[] };
  export async function getExpenseFormData(userId: string, groupId: string, expenseId?: string): Promise<ExpenseFormData>;
  ```

Rules:
- **`listExpenses`:**
  - Excludes deleted expenses. Ordered by `date` desc, `createdAt` desc, `id` desc. Fetches `limit + 1` rows
    and returns `hasMore` when the extra row exists. `limit` is clamped to 1–500.
  - `q` matches the description or the notes case-insensitively and **literally**: escape `\`, `%` and `_`
    with a backslash before passing it to Prisma's `contains` (`mode: "insensitive"`).
  - `memberId` matches a payer or a share. `from`/`to` are inclusive dates.
  - `payerLabel`: `"You paid"`, `` `${displayName} paid` ``, or `` `${n} people paid` ``.
  - `myNet` = the viewer's paid − share on that expense (0n when they're not in it).
- **`getExpense`:** a deleted expense → `NotFoundError("This expense was deleted.")`. `canEdit` follows Task
  5's creator-or-admin rule (it is false in an archived group).
- **`getExpenseFormData`:**
  - `members`: active members in `createdAt`, `id` order. With `expenseId`, also members on that expense
    who have left (`active: false`).
  - `today = todayIn(user.timezone)`.
  - `history`: up to 200 most recent `{ description, category }` in the group, distinct by normalised description.
- All three: an outsider → `ForbiddenError`.

- [ ] **Step 1: Write the failing tests** `test/expense-reads.test.ts`

```ts
it("lists newest first with what the viewer lent or owes", async () => {
  // Asha pays ₹1,000 split among Asha, Ravi, Rahul
  expect((await listExpenses(asha.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "You paid", myNet: 66666n });
  expect((await listExpenses(ravi.id, g.id, {})).items[0]).toMatchObject({ payerLabel: "Asha paid", myNet: -33333n });
});
it("labels several payers", async () => { /* two payers → "2 people paid" */ });
it("searches description and notes literally", async () => {
  // descriptions "500 rupees", "50% off", and notes "under_score" on a third
  expect(descriptions(await listExpenses(asha.id, g.id, { q: "50%" }))).toEqual(["50% off"]);
  expect(descriptions(await listExpenses(asha.id, g.id, { q: "_" }))).toHaveLength(1);
});
it("filters by member, category and date range", async () => { /* three expenses; each filter narrows to the expected one */ });
it("says when there is more", async () => { /* 3 expenses, limit 2 → 2 items, hasMore true */ });
it("leaves out deleted expenses", async () => {});
it("shows payers, shares and who can edit", async () => {
  // getExpense: shares sum to amount; canEdit true for creator and admin, false for another member
});
it("treats a deleted expense as gone", async () => { /* → NotFoundError "This expense was deleted." */ });
it("form data: active members in join order, plus anyone who left but is on the expense", async () => {});
it("forbids outsiders", async () => { /* listExpenses, getExpense, getExpenseFormData → ForbiddenError */ });
```

- [ ] **Step 2: Run** `pnpm test test/expense-reads.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the reads.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(expenses): list with search and filters, detail and form data"` (include files).

---

### Task 7: Balances, zero-balance guards, currency lock

**Files:**
- Create: `src/server/balances.ts`, `test/balances.test.ts`.
- Modify: `src/server/members.ts` (`leaveGroup`, `removeMember`), `src/server/groups.ts` (`updateGroup`,
  `getGroupDetail`, `listGroupsForUser`), `test/members.test.ts`, `test/groups.test.ts`.

**Interfaces:**
- Consumes: `simplifyDebts`, `pairwiseDebts`, `Transfer` (Task 3), `formatMoney`, `requireMember`.
- Produces in `balances.ts`:
  ```ts
  export async function groupNets(groupId: string): Promise<Map<string, bigint>>;   // no authz: callers authorise
  export type MemberBalance = { memberId: string; displayName: string; image: string | null; isPlaceholder: boolean; active: boolean; net: bigint };
  export type GroupBalances = { currency: string; simplified: boolean; members: MemberBalance[]; transfers: Transfer[]; myMemberId: string; myNet: bigint; settled: boolean };
  export async function getGroupBalances(userId: string, groupId: string): Promise<GroupBalances>;
  export async function myBalancesByGroup(userId: string): Promise<Map<string, bigint>>;   // groupId → my net, active memberships
  ```
- `groupNets` is **one SQL statement**, so it reads one snapshot and always nets to zero:
  ```sql
  SELECT "memberId", SUM(delta)::bigint AS net FROM (
    SELECT p."memberId", p."baseAmount" AS delta FROM "ExpensePayer" p JOIN "Expense" e ON e.id = p."expenseId"
      WHERE e."groupId" = $1 AND e."deletedAt" IS NULL
    UNION ALL SELECT s."memberId", -s."baseAmount" FROM "ExpenseShare" s JOIN "Expense" e ON e.id = s."expenseId"
      WHERE e."groupId" = $1 AND e."deletedAt" IS NULL
    UNION ALL SELECT "fromMemberId", "baseAmount" FROM "Settlement"
      WHERE "groupId" = $1 AND "deletedAt" IS NULL AND status = 'RECORDED'
    UNION ALL SELECT "toMemberId", -"baseAmount" FROM "Settlement"
      WHERE "groupId" = $1 AND "deletedAt" IS NULL AND status = 'RECORDED'
  ) t GROUP BY "memberId"
  ```
  `myBalancesByGroup` is the same shape, with `"groupId"` added and filtered to the caller's active member ids.
- `getGroupBalances`:
  - `members`: every active member, plus members who left with `net ≠ 0`, in `createdAt`, `id` order.
  - `transfers`:
    - `simplifyDebts(nets)` when `group.simplifyDebts` is on.
    - Otherwise `pairwiseDebts` over one event per live expense (payers +, shares −) and per RECORDED
      settlement (from +, to −). These are loaded as rows; the ceiling is fine for groups of hundreds of
      expenses (leave a `ponytail:` comment).
  - `settled` = every net is 0.
- Changes in `members.ts`:
  - `leaveGroup` with `net ≠ 0` → `UserError("Settle up before leaving: you owe ₹333.33.")`, or
    `"Settle up before leaving: you're owed ₹333.33."` (formatted with the group currency).
  - `removeMember` with the target's `net ≠ 0` → `"Rahul still owes ₹333.33. Settle up before removing them."`
    or `"Rahul is still owed ₹333.33. Settle up before removing them."`.

  Add a `ponytail:` comment: the check runs before the write, so a concurrent expense can slip in, but the
  member who left still shows in balances and can be settled with.
- Changes in `groups.ts`:
  - `updateGroup` with a new `baseCurrency`, when the group has any `Expense` or `Settlement` row (deleted
    ones included, since they can be restored) → `UserError("The currency can't change once the group has expenses or payments.")`.
  - `getGroupDetail` adds `currencyLocked: boolean`.
  - `GroupListItem` adds `myNet: bigint` (from `myBalancesByGroup`, 0n if absent).

- [ ] **Step 1: Write the failing tests** `test/balances.test.ts` (+ cases in members/groups tests)

```ts
it("a 5-person trip with mixed splits nets to zero and settles in n−1 payments", async () => {
  // Members A (owner), B, C, D, E in that order; expenses through createExpense:
  // 1 Hotel   1000000n paid A,            EQUAL A,B,C,D,E
  // 2 Cab      100000n paid B,            EQUAL A,B,C
  // 3 Dinner   300000n paid A 200000n + C 100000n, SHARES A2 B1 C1 D1 E1
  // 4 Tickets   99999n paid D,            PERCENT 2000 each (A..E)
  // 5 Snacks    55000n paid E,            ITEMIZED "Snacks" 30000n [A], "Drinks" 20000n [A,B]
  // 6 Fuel     100000n paid C,            EQUAL A,B,C,D + adjustment D +10000n
  const b = await getGroupBalances(a.id, g.id);
  expect(netsByName(b)).toEqual({ A: 780166n, B: -236833n, C: -125833n, D: -202501n, E: -214999n });
  expect(b.transfers).toEqual([t(B, A, 236833n), t(E, A, 214999n), t(D, A, 202501n), t(C, A, 125833n)]);
  for (const x of b.transfers) await createSettlementRow(g.id, { fromMemberId: x.from, toMemberId: x.to, amount: x.amount, createdByMemberId: A });
  const after = await getGroupBalances(a.id, g.id);
  expect(after.settled).toBe(true);
  expect(after.transfers).toEqual([]);
});
it("shows pairwise debts when simplify is off", async () => {
  // A pays 100 split A,B; B pays 100 split B,C. Simplified → [C→A 50]; with simplifyDebts false → [B→A 50, C→B 50]
});
it("ignores deleted expenses and disputed or deleted payments", async () => {});
it("a member who left still shows while they have a balance", async () => {
  // Rahul (placeholder) in an expense → delete it → Asha removes Rahul (his net is 0 now) → restore it:
  // Rahul listed with active:false and his net;
  // transfers include him; Σ nets = 0n
});
it("sums my balance per group", async () => { /* two groups → Map with both nets */ });
```

`test/members.test.ts`:
- Leaving with a balance is refused with "Settle up before leaving: you owe ₹333.33.".
- Leaving at zero works.
- Removing Rahul at −₹333.33 → "Rahul still owes ₹333.33. Settle up before removing them.".
- The owed case → "Rahul is still owed ₹333.33. Settle up before removing them.".

`test/groups.test.ts`:
- After one expense, changing the currency → "The currency can't change once the group has expenses or payments.".
- Renaming with the same currency still works.
- Changing the currency before any expense works.
- `currencyLocked` reflects all of this.
- `listGroupsForUser` returns `myNet`.

- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** `balances.ts` and the changes listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(balances): SQL nets, simplified and pairwise debts; zero-balance leave/remove; currency lock"` (include files).

---

### Task 8: Settlements, dispute, UPI link

**Files:**
- Create: `src/lib/upi.ts`, `src/lib/upi.test.ts`, `src/server/settlements.ts`,
  `src/server/actions/settlements.ts`, `test/settlements.test.ts`.
- Modify: `src/lib/validation.ts`, `test/authz-actions.test.ts`.

**Interfaces:**
- Consumes: `formatDecimal`, `formatMoney`, `toDbDate`, `todayIn`, `getGroupBalances`, `requireMember`,
  `requireMemberFor`, `recordActivity`, `revalidateGroup`.
- Produces in `upi.ts`:
  `upiPayLink({ upiId, payeeName, amount, groupName }: { upiId: string; payeeName: string; amount: bigint; groupName: string }): string`.
  It builds `` `upi://pay?pa=${upiId}&pn=${enc(payeeName)}&am=${formatDecimal(amount, 2)}&cu=INR&tn=${enc(note)}` ``, where:
  - `enc` is `encodeURIComponent` (spaces become `%20`, never `+`).
  - `upiId` is not encoded (it's already validated to `[a-z0-9._-]@[a-z0-9]`).
  - `note` = `"Hisaab: " + groupName`, cut to 50 code points.
- Produces in `validation.ts`:
  - `settlementInputSchema = z.object({ groupId, fromMemberId, toMemberId, amount: positiveMinorSchema, method: z.enum(["UPI","CASH","BANK","OTHER"]), date: isoDateSchema, note: trimmed ≤ 200, "" → null })`,
    refined so that from ≠ to → "Choose two different people.".
  - `settlementUpdateSchema = z.object({ settlementId, amount, method, date, note })`.
- Produces in `settlements.ts`:
  ```ts
  export async function recordSettlement(userId: string, input: SettlementInput): Promise<{ id: string }>;
  export async function updateSettlement(userId: string, settlementId: string, input: { amount: bigint; method: SettlementMethod; date: string; note: string | null }): Promise<void>;
  export async function deleteSettlement(userId: string, settlementId: string): Promise<void>;
  export async function restoreSettlement(userId: string, settlementId: string): Promise<void>;
  export async function disputeSettlement(userId: string, settlementId: string): Promise<void>;
  export type SettlementView = { id: string; groupId: string; from: { memberId: string; displayName: string }; to: { memberId: string; displayName: string };
    amount: bigint; currency: string; method: SettlementMethod; status: SettlementStatus; note: string | null; date: string;
    recordedBy: string; disputedAt: Date | null; canEdit: boolean; canDispute: boolean };
  export async function getSettlement(userId: string, settlementId: string): Promise<SettlementView>;   // deleted → NotFoundError("This payment was deleted.")
  export async function listSettlements(userId: string, groupId: string, limit = 20): Promise<SettlementView[]>;  // newest first, not deleted
  export type SettleUpTransfer = Transfer & { fromName: string; toName: string; involvesMe: boolean; canRecord: boolean;
    upi: { link: string; upiId: string } | null };
  export async function getSettleUp(userId: string, groupId: string): Promise<{ groupName: string; currency: string; today: string; myMemberId: string; transfers: SettleUpTransfer[] }>;
  ```
- Produces actions: `recordSettlementAction(settlementInputSchema)`, `updateSettlementAction(settlementUpdateSchema)`,
  `deleteSettlementAction({ settlementId })`, `restoreSettlementAction({ settlementId })` and
  `disputeSettlementAction({ settlementId })`, each calling `revalidateGroup()`.

Rules:
- **Record** (`write`):
  - `from`/`to` must be members of this group (active or left, so leftover balances can be settled).
    Otherwise → `UserError("Choose people in this group.")`.
  - The caller's member must be `from` or `to`, or both must be placeholders. Otherwise →
    `UserError("You can only record payments you made or received.")`.
  - Stored with `currency = group.baseCurrency`, `fxRate = 1`, `baseAmount = amount`, status `RECORDED`.
  - Records `settlement.created`.
- **Update/delete/restore** (`write`):
  - Allowed for the creator or an admin. Anyone else → `UserError("Only the person who recorded this payment or an admin can change it.")`.
  - Update on a deleted row → `UserError("This payment was deleted.")`.
  - Update keeps `status`.
  - Delete/restore are conditional and idempotent, like expenses.
  - Each change records its activity.
- **Dispute** (`write`):
  - Allowed when the caller is the payee (`to.userId === userId`), or the payee is a placeholder and the
    caller is an admin/owner. Otherwise → `UserError("Only the person who was paid can dispute this.")`.
  - Conditional `updateMany({ where: { id, status: "RECORDED", deletedAt: null } })` → `DISPUTED`, with
    `disputedAt = now`. A count of 0 → `UserError("This payment is already disputed.")`.
  - Records `settlement.disputed`.
- **`getSettleUp`:** `transfers` comes from `getGroupBalances`, ordered with mine first.
  - `canRecord`: the same rule as record.
  - `upi` is non-null only when the group currency is `"INR"` and the payee is a user with a `upiId`.
  - `link` = `upiPayLink({ upiId, payeeName: displayName, amount, groupName })`.
- `canDispute`/`canEdit` in views follow the same rules, and are false in an archived group.

- [ ] **Step 1: Write the failing tests**

`src/lib/upi.test.ts`:
```ts
it("builds the UPI link", () =>
  expect(upiPayLink({ upiId: "asha@okicici", payeeName: "Asha", amount: 33333n, groupName: "Goa Trip" }))
    .toBe("upi://pay?pa=asha@okicici&pn=Asha&am=333.33&cu=INR&tn=Hisaab%3A%20Goa%20Trip"));
it("encodes names", () => expect(upiPayLink({ upiId: "a@ok", payeeName: "Asha & Co", amount: 1n, groupName: "x" })).toContain("pn=Asha%20%26%20Co&am=0.01"));
it("keeps the note within 50 characters", () => { /* groupName of 60 emoji → decoded tn has 50 code points */ });
```

`test/settlements.test.ts` (Asha owner with `upiId: "asha@okicici"`, Ravi member, Rahul and Dev placeholders,
group "Goa Trip"; Asha has paid ₹1,000 split among Asha, Ravi and Rahul):
```ts
it("counts a recorded payment immediately", async () => {
  await recordSettlement(ravi.id, pay(raviM, ashaM, 33333n));
  expect((await getGroupBalances(asha.id, g.id)).members.find((m) => m.memberId === raviM.id)?.net).toBe(0n);
});
it("leaves the rest suggested after a partial payment", async () => { /* 10000n → transfer Ravi→Asha 23333n */ });
it("lets the payer, the payee, or anyone for two placeholders record", async () => {
  // Ravi Ravi→Asha ok; Asha Ravi→Asha ok; Asha Rahul→Dev ok;
  // Ravi Rahul→Asha → "You can only record payments you made or received."
});
it("refuses people from another group", async () => { /* → "Choose people in this group."; nothing written */ });
it("only the payee disputes, and a disputed payment stops counting", async () => {
  // Ravi pays Asha; Ravi disputes → "Only the person who was paid can dispute this."
  // Asha disputes → status DISPUTED, Ravi's net back to -33333n, activity "settlement.disputed";
  // again → "This payment is already disputed."
});
it("an admin disputes for a placeholder payee", async () => { /* Ravi→Rahul: Asha (owner) ok; Ravi refused */ });
it("lets the creator or an admin edit, delete and restore", async () => {});
it("offers UPI only to a payee with a UPI ID in an INR group", async () => {
  const [mine] = (await getSettleUp(ravi.id, g.id)).transfers;
  expect(mine).toMatchObject({ from: raviM.id, to: ashaM.id, amount: 33333n, involvesMe: true,
    upi: { upiId: "asha@okicici", link: "upi://pay?pa=asha@okicici&pn=Asha&am=333.33&cu=INR&tn=Hisaab%3A%20Goa%20Trip" } });
  // Rahul→Asha in Ravi's view: involvesMe false, canRecord false; a USD group → upi null; payee without upiId → upi null
});
it("refuses payments and disputes in an archived group", async () => {});
```

`test/authz-actions.test.ts`:
- Add `settlements.ts`.
- The target gets a `settlementId` (from `createSettlementRow`).
- Every settlement action → `FORBIDDEN`.
- `snapshot()` adds `settlement` rows.

- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the files listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(settle): record, edit, delete, dispute payments; UPI pay links"` (include files).

---

### Task 9: Comments, activity feeds, activity text

**Files:**
- Create: `src/server/comments.ts`, `src/server/actions/comments.ts`, `test/comments.test.ts`,
  `src/lib/activity.test.ts`.
- Modify: `src/lib/activity.ts` (+ `describeActivity`), `src/server/activity.ts` (+ reads),
  `src/lib/validation.ts`, `test/activity.test.ts`, `test/authz-actions.test.ts`.

**Interfaces:**
- Produces in `validation.ts`: `commentInputSchema = z.object({ target: z.discriminatedUnion("kind", [{ kind: "expense", id }, { kind: "settlement", id }]), body: trimmed 1–1000 ("Write a comment" / "Comments must be 1,000 characters or fewer") })`.
- Produces in `comments.ts`:
  ```ts
  export type CommentTarget = { kind: "expense" | "settlement"; id: string };
  export type CommentItem = { id: string; body: string; createdAt: Date; author: { memberId: string; displayName: string; image: string | null }; canDelete: boolean };
  export async function addComment(userId: string, target: CommentTarget, body: string): Promise<{ id: string }>;
  export async function deleteComment(userId: string, commentId: string): Promise<void>;
  export async function listComments(userId: string, target: CommentTarget): Promise<CommentItem[]>;   // oldest first, not deleted
  ```
- Produces actions: `addCommentAction(commentInputSchema)` and `deleteCommentAction({ commentId })`, each
  calling `revalidateGroup()`.
- Produces in `src/server/activity.ts`:
  ```ts
  export type ActivityItem = ActivityView & { id: string; createdAt: Date; groupId: string; groupName: string; entityId: string };
  export async function listGroupActivity(userId: string, groupId: string, limit = 50): Promise<{ items: ActivityItem[]; hasMore: boolean }>;
  export async function listMyActivity(userId: string, limit = 50): Promise<{ items: ActivityItem[]; hasMore: boolean }>;  // groups where I'm active
  export async function listEntityHistory(userId: string, entity: "expense" | "settlement", id: string): Promise<ActivityItem[]>;  // newest first
  ```
- Produces in `src/lib/activity.ts`:
  ```ts
  export type ActivityView = { [K in ActivityKind]: { kind: K; payload: ActivityPayloads[K] } }[ActivityKind]
    & { actorMemberId: string; viewerMemberId: string; currency: string; names: Record<string, string> };  // names: every member of the group
  export function describeActivity(a: ActivityView): { title: string; detail: string | null; money: { text: string; tone: "owe" | "owed" } | null };
  ```

Rules:
- **`addComment`** (`requireMemberFor(target.kind, target.id, { write: true })`):
  - The target is deleted → `"This expense was deleted."` / `"This payment was deleted."`.
  - Records `comment.created`, with `excerpt` = the first 80 characters and `targetLabel` = the expense
    description or `` `payment from ${fromName} to ${toName}` ``.
- **`deleteComment`:** the author or an admin, or `UserError("Only the author or an admin can delete this comment.")`.
  Soft delete, no activity.
- **`describeActivity`:**
  - Wording: "You" at the start of a sentence and "you" elsewhere for the viewer; otherwise the name from `names`.
  - Titles:
    - expense.created / deleted / restored / updated: `` `${Actor} added|deleted|restored|edited “${description}”` ``
    - settlement.created: `` `${From} paid ${to} ${amount}` ``
    - settlement.updated / deleted / restored: `` `${Actor} edited|deleted|restored a payment from ${from} to ${to}` ``
    - settlement.disputed: `` `${To} didn't receive ${amount} from ${from}` ``
    - comment.created: `` `${Actor} commented on “${targetLabel}”` ``
    - member.joined: `` `${Actor} joined the group` ``
    - member.added: `` `${Actor} added ${displayName}` ``
    - member.left: `` `${Actor} left the group` ``
    - member.removed: `` `${Actor} removed ${displayName}` ``
  - `detail`:
    - expense.updated: the changes joined by `" · "`. A scalar change reads `` `amount ₹1,000 → ₹1,200` ``;
      a description change reads `` `renamed from “Lunch”` ``; payers and split read `"who paid"` and
      `"the split"`.
    - settlement.created when the actor ≠ from: `` `Recorded by ${actor}` ``.
    - comment.created: the excerpt.
    - Otherwise `null`.
  - `money` (expense.created / updated / restored only): from `payload.net[viewerMemberId]`. Negative →
    `` `you owe ${amount}` `` with tone `owe`. Positive → `` `you get back ${amount}` `` with tone `owed`.
    Absent → `null`.

- [ ] **Step 1: Write the failing tests**

`src/lib/activity.test.ts`:
```ts
const names = { p: "Priya", a: "Asha", r: "Ravi" };
const added = (viewer: string) => describeActivity({ kind: "expense.created", actorMemberId: "p", viewerMemberId: viewer, currency: "INR", names,
  payload: { description: "Dinner at Thalassa", amount: "222000", currency: "INR", net: { p: "148000", a: "-74000", r: "-74000" } } });
it("tells the viewer what they owe", () =>
  expect(added("a")).toEqual({ title: "Priya added “Dinner at Thalassa”", detail: null, money: { text: "you owe ₹740", tone: "owe" } }));
it("speaks to the actor", () => expect(added("p")).toMatchObject({ title: "You added “Dinner at Thalassa”", money: { text: "you get back ₹1,480", tone: "owed" } }));
it("leaves out money for people not in it", () => { /* viewer "x" → money null */ });
it("describes an edit", () => { /* changes [{ field: "amount", before: "₹1,000", after: "₹1,200" }] → detail "amount ₹1,000 → ₹1,200" */ });
it("describes payments", () => {
  // created from r to a by r, viewer a → title "Ravi paid you ₹850", detail null; same recorded by a → detail "Recorded by you"
  // disputed by a, viewer r → "Asha didn't receive ₹850 from you"
});
it("describes comments and members", () => { /* "Ravi commented on “Dinner at Thalassa”" + excerpt; "Asha added Rahul" */ });
```

`test/comments.test.ts`:
- A comment on an expense lists with its author and logs `comment.created`.
- A comment on a payment works.
- A comment on a deleted expense → "This expense was deleted.".
- Delete by the author works. Another member → "Only the author or an admin can delete this comment.". An admin works.
- An outsider → `ForbiddenError`.

`test/activity.test.ts` (append):
- `listGroupActivity` is newest first, with `hasMore`.
- `listMyActivity` spans two groups and leaves out a group the user left.
- `listEntityHistory` for one expense returns only its rows.

`test/authz-actions.test.ts`:
- Add `comments.ts`.
- The target gets a `commentId` (from `createCommentRow`).
- `addCommentAction` on the target's expense → `FORBIDDEN`, and so does `deleteCommentAction`.
- `snapshot()` adds `comment` rows.

- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the files listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(activity): comments, group and personal feeds, readable activity lines"` (include files).

---

### Task 10: Keypad, add-expense sheet, Expenses tab

**Files:**
- Create: `src/lib/keypad.ts`, `src/lib/keypad.test.ts`, `src/components/keypad.tsx`,
  `src/components/expense-sheet.tsx`, `src/components/expense-list.tsx`, `src/components/group-tabs.tsx`,
  `src/components/add-expense-fab.tsx`, `e2e/expenses.spec.ts`.
- Modify: `src/app/(app)/groups/[groupId]/page.tsx`, `src/app/(app)/layout.tsx`, `e2e/helpers.ts`.
- Delete: `src/components/app-shell/fab.tsx` (replaced by `add-expense-fab.tsx`).

**Interfaces:**
- Consumes: `getExpenseFormData`, `listExpenses`, `createExpenseAction`, `suggestCategory`, `CATEGORIES`,
  `parseMoney`, `formatMoney`, `minorDigits`, `formatDay`, `monthLabel`, `listGroupsForUser`,
  `ResponsiveSheet`, `CreateGroupButton`.
- Produces in `keypad.ts`: `type KeypadKey = "0" | … | "9" | "." | "back"` and
  `pressKey(value: string, key: KeypadKey, digits: number): string`. Rules:
  - No leading zeros (`"0"` then `"5"` → `"5"`).
  - At most one `"."`, and `"."` on empty gives `"0."`. `"."` is ignored when `digits` is 0.
  - At most `digits` fraction digits, and at most `11 − digits` integer digits (so the value is ≤ `MAX_AMOUNT`).
  - `"back"` drops the last character.
- Produces `ExpenseSheet({ data, open, onOpenChange, mode, initial }: { data: ExpenseFormData; open: boolean; onOpenChange(open: boolean): void; mode: { kind: "add" } | { kind: "edit"; expenseId: string; version: number }; initial?: ExpenseFormValues })`.
  Task 11 adds the split and payer editors inside it, and Task 12 uses `mode: "edit"` and `initial`.
- Produces `ExpenseList({ items, currency, groupId, hasMore, moreHref })` (server component) and
  `GroupTabs({ groupId, current: "expenses" | "balances" | "activity" })`. The tabs are links to `?tab=`,
  with `aria-current="page"`. They render only the tabs built so far: Task 13 adds Balances and Task 14
  adds Activity.
- Produces `AddExpenseFab({ groups: { id: string; name: string; emoji: string }[] })` (client, phones only):
  - With no groups, it's the existing create-group button (aria-label "Create a group").
  - Otherwise, aria-label "Add expense". It opens a group picker sheet ("Add an expense to…") whose rows
    link to `/groups/<id>?add=1`.
  - It is hidden on `/groups/<id>` itself, where the page renders its own FAB that opens the sheet directly.
- e2e helpers:
  - `addPlaceholderViaUi(page, name)`: uses the invite sheet's "Add someone without an account".
  - `addExpenseViaUi(page, { amount: string; description: string })`: "Add expense" → keypad → Next →
    description → Save.

Behaviour and copy:
- **Sheet:**
  - Title "Add expense" / "Edit expense". Description "Enter the amount, then who paid and how to split it."
- **Step 1 (amount):**
  - The amount is shown huge with `formatMoney`, plus the currency code.
  - A 3×4 keypad: `1–9`, `.` (aria-label "Decimal point"), `0`, and ⌫ (aria-label "Delete"). Buttons are at
    least `h-14`.
  - Physical keys (digits, `.`, Backspace) also work while step 1 is shown.
  - "Next" is disabled at zero.
- **Step 2 (details):**
  - "Description" input (autofocus).
  - A chip row:
    - "Paid by you" / "Paid by Asha"
    - "Split equally" / "Split equally · 3 of 5"
    - "Today" / `formatDay(date)`
    - `${emoji} ${label}` for the category, auto-set from `suggestCategory` until the person picks one
  - "Add a note" (textarea).
  - Each chip opens an inline panel: a payer radio list, equal-split checkboxes headed "Split equally
    between", a native `<input type="date">`, or a category grid.
- **Footer:**
  - "Save", plus "Save & add another" in add mode. Both are disabled while pending (one request per tap) or
    while the form is invalid.
  - On success: toast "Expense added" (edit: "Expense saved") and `navigator.vibrate?.(10)`, then close (or
    reset to step 1 for "Save & add another").
  - The action's error is shown above the footer.
- **Defaults:** paid by me for the whole amount, split equally among every active member, date
  `data.today`. The single payer's amount follows the total.
- **Group page:**
  - Replace the Phase 1 placeholder section with `GroupTabs` and the Expenses panel.
  - Header: "Add expense" button on ≥ 768px (and the page FAB on phones), hidden when archived.
  - `?add=1` opens the sheet on load.
- **Expenses panel:**
  - Rows grouped under `monthLabel` headings. Each row is a link to the expense: category emoji,
    description, `formatDay(date)` · `payerLabel`, `formatMoney(amount)`, and for the viewer
    "you lent ₹600" (emerald) / "you owe ₹400" (rose) / "not involved" (muted).
  - Empty state: 🧾 "No expenses yet" / "Add the first one and Hisaab works out who owes whom." with an
    "Add expense" button.
  - "Show more" (link to `limit` + 50) when `hasMore`.

- [ ] **Step 1: Write the failing tests**

`src/lib/keypad.test.ts`:
```ts
const type = (keys: string, digits = 2) => [...keys].reduce((v, k) => pressKey(v, k === "<" ? "back" : (k as KeypadKey), digits), "");
it.each([
  ["1200", 2, "1200"], ["05", 2, "5"], ["12.5", 2, "12.5"], ["12.345", 2, "12.34"], ["1..2", 2, "1.2"], [".5", 2, "0.5"],
  ["12<", 2, "1"], ["1.5", 0, "15"], ["1234567890", 2, "123456789"], ["123456789012", 0, "12345678901"], ["<", 2, ""],
])("typing %j (digits %i) shows %j", (keys, digits, out) => expect(type(keys, digits)).toBe(out));
```

`e2e/expenses.spec.ts`:
```ts
test("add an expense with the keypad", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.expenses@example.test", "Asha");
  await createGroupViaUi(asha, "Goa Trip");
  await addPlaceholderViaUi(asha, "Ravi");
  await asha.getByRole("button", { name: "Add expense" }).click();
  for (const key of "1200") await asha.getByRole("button", { name: key, exact: true }).click();
  await expect(asha.getByText("₹1,200")).toBeVisible();
  await asha.getByRole("button", { name: "Next" }).click();
  await asha.getByLabel("Description").fill("Dinner at Thalassa");
  await expect(asha.getByRole("button", { name: /Food & drink/ })).toBeVisible();
  await asha.getByRole("button", { name: "Save", exact: true }).dblclick();     // a double tap still makes one expense
  await expect(asha.getByRole("link", { name: /Dinner at Thalassa/ })).toHaveCount(1);
  await expect(asha.getByText("you lent ₹600")).toBeVisible();
});
test("the keypad can't type more decimals than the currency has", async ({ browser }) => {
  // in the sheet: 1 . 2 3 4 → display "₹1.23"; Delete → "₹1.2"
});
```

- [ ] **Step 2: Run** `pnpm test src/lib/keypad.test.ts && pnpm test:e2e e2e/expenses.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the keypad, sheet, tabs, list, FABs and group-page wiring.

- [ ] **Step 4: Run** the same commands. Expected: PASS. Then, in the browser pane, at 375px: the
  add flow runs from the FAB in a few taps, the keypad buttons are thumb-sized, the sheet is not hidden by
  the on-screen keyboard on step 2, and dark mode is legible. At 1280px: the header button and keyboard
  typing work.

- [ ] **Step 5: Commit** — `git commit -m "feat(expenses): keypad add flow, expenses tab and add-expense FAB"` (include files).

---

### Task 11: Split editor, multiple payers, adjustments

**Files:**
- Create: `src/components/split-editor.tsx`, `src/components/payers-editor.tsx`.
- Modify: `src/components/expense-sheet.tsx`, `e2e/expenses.spec.ts`.

**Interfaces:**
- Consumes: `splitExpense`, `checkPayers` (client side, for the live preview), `parseMoney`,
  `parseDecimal(…, 2)` for percentages, `formatMoney`, `FormMember`.
- Produces `SplitEditor({ members, currency, total, value, onChange })` and
  `PayersEditor({ members, me, currency, total, value, onChange })`.
  - `value` is the editor's own state: what people typed, as strings.
  - Each exports a pure `toInput(state, currency)` that returns the `z.input` shape (minor-unit strings) or
    `null` when the input doesn't parse.
  - The sheet's Save is enabled only when `splitExpense` and `checkPayers` both pass on the parsed values.

Behaviour and copy:
- **Methods:** a segmented control with accessible names "Equally", "Exact amounts", "Percentages",
  "Shares" and "Items". The split chip then reads "Split equally", "Exact amounts", "By percentage",
  "By shares" or "By items".
- **Rows by method:**
  - Equal: a checkbox per member.
  - Exact: a money input per member, with `inputMode="decimal"`.
  - Percent: a % input per member.
  - Shares: a − / number / + stepper per member (0–999).
  - Items: a list of items, each with a name, an amount, and member toggle chips ("Who had it?"), plus an
    "Add item" button. When `total − Σitems > 0`, a line reads "Tax, tip & service: ₹50 — shared in
    proportion to what each person had".
- **Adjustments:** a toggle "Adjustments (+/−)" (hidden for Exact amounts) reveals a signed money input per
  member, with the hint "Add or take off an amount for someone before the rest is split."
- **Live footer** in `aria-live="polite"`:
  - When the split is valid, each person's share ("Asha ₹450 · Ravi ₹225 · Rahul ₹325").
  - Otherwise the exact error from `splitExpense`, such as "₹120 left to assign".
- **Payers:** a radio list of members plus "Multiple people". The latter shows a money input per member and
  the live `checkPayers` message. The chip reads "Paid by 2 people".
- A left member (`active: false`) appears only when already on the expense (editing), labelled
  "Rahul (left)".

- [ ] **Step 1: Write the failing e2e** (append to `e2e/expenses.spec.ts`)

```ts
test("split by shares with an adjustment and two payers", async ({ browser }) => {
  // Asha + placeholders Ravi, Rahul; amount 1000 → Next → "Fuel"
  // split chip → "Shares": Asha 2, Ravi 1, Rahul 1 → "Adjustments (+/−)": Rahul 100
  // footer shows "Asha ₹450 · Ravi ₹225 · Rahul ₹325"
  // payer chip → "Multiple people": Asha 600, Ravi 300 → "₹100 of the total isn't paid by anyone" and Save disabled
  // Ravi 400 → Save → the list shows "Fuel" with "2 people paid"
});
test("exact amounts show what is left to assign", async ({ browser }) => {
  // amount 1000, "Exact amounts": Asha 500, Ravi 380 → "₹120 left to assign", Save disabled; Rahul 120 → Save enabled
});
test("itemised split shares tax and tip in proportion", async ({ browser }) => {
  // amount 550, "Items": "Paneer tikka" 300 → Asha; "Biryani" 200 → Asha, Ravi
  // → "Tax, tip & service: ₹50 — shared in proportion to what each person had"; footer "Asha ₹440 · Ravi ₹110"
});
```

- [ ] **Step 2: Run** `pnpm test:e2e e2e/expenses.spec.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the editors and wire them into the sheet.

- [ ] **Step 4: Run** the same command. Expected: PASS. Then, at 375px in the browser pane: every method
  is usable one-handed, inputs don't zoom the page (text ≥ 16px), the footer message is announced
  (check its `aria-live`), and dark mode is legible.

- [ ] **Step 5: Commit** — `git commit -m "feat(expenses): split editor for every method, multiple payers, adjustments"` (include files).

---

### Task 12: Expense detail, edit, delete with undo, duplicate, search and filters, comments

**Files:**
- Create: `src/app/(app)/groups/[groupId]/expenses/[expenseId]/page.tsx`,
  `src/components/expense-actions.tsx`, `src/components/expense-filters.tsx`,
  `src/components/comment-thread.tsx`.
- Modify: `src/app/(app)/groups/[groupId]/page.tsx` (reads filter params), `e2e/expenses.spec.ts`,
  `e2e/helpers.ts`.

**Interfaces:**
- Consumes: `getExpense`, `getExpenseFormData`, `listEntityHistory`, `describeActivity`, `listComments`,
  `addCommentAction`, `deleteCommentAction`, `updateExpenseAction`, `deleteExpenseAction`,
  `restoreExpenseAction`, `ExpenseSheet`, `listExpenses` filters.
- Produces `CommentThread({ groupId, target, comments, canComment })` (client), reused for payments in Task 13.
- e2e helper: `inviteAndJoin(owner: Page, browser: Browser, email: string, name: string): Promise<Page>`.
  It reads the invite link from the invite sheet and returns the new member's page, already joined.

Behaviour and copy:
- **Detail page** (outsider or unknown id → `notFound()`, like the group page; deleted → `notFound()`):
  - Back link to the group.
  - Category emoji tile, description (h1), `formatMoney(amount)`, `formatDay(date)` and "Added by Asha".
  - "Paid by" list, and "Split" list (each person's share, with a method caption such as "Split by shares").
    Itemised expenses also list their items from `split`.
  - Notes.
  - Buttons:
    - "Edit" and "Delete" (only when `canEdit`).
    - "Duplicate" (any member; opens the add sheet prefilled with the same values and today's date).
  - "History": `describeActivity` lines with relative times.
  - "Comments" (`CommentThread`).
- **Edit:**
  - Opens `ExpenseSheet` in edit mode, with `initial` built from the detail (`split` as stored; payers as
    minor-unit strings).
  - A `code: "conflict"` result shows the error as a toast with a "Reload" action (`router.refresh()`), and
    keeps the sheet open.
- **Delete:**
  - No confirm dialog. It deletes, navigates to the group, and shows the toast "Expense deleted" with an
    "Undo" action.
  - Undo → `restoreExpenseAction`, then the toast "Expense restored", then refresh.
- **Comments:**
  - A textarea labelled "Add a comment", with a "Post" button (disabled while empty or pending).
  - Each comment shows the avatar, name, time and body (`whitespace-pre-wrap`).
  - "Delete comment" when `canDelete`.
  - Read-only, with no form, in archived groups.
- **Filters** (Expenses tab, server-driven by search params `q`, `member`, `category`, `from`, `to`):
  - A search input "Search expenses" that updates `q` after 300ms.
  - A "Filters" button that opens a sheet with: Member (select), Category (select), "From" / "To" (native
    date inputs), "Clear filters".
  - Active filters show as removable chips.
  - With filters, the empty state is "No expenses match" with "Clear filters".

- [ ] **Step 1: Write the failing e2e** (append)

```ts
test("edit, delete and undo", async ({ browser }) => {
  // add "Dinner" ₹1,200 → open it → "Edit" → amount 1500 → Save → detail shows ₹1,500 and History "You edited “Dinner”" + "amount ₹1,200 → ₹1,500"
  // "Delete" → on the group page, toast "Expense deleted" → "Undo" → "Expense restored" and the row is back
});
test("search and filter the expense list", async ({ browser }) => {
  // add "Dinner", "Uber to airport", "50% off shoes" → search "50%" → only "50% off shoes"
  // Filters → Category "Transport" → only "Uber to airport" → "Clear filters" → all three
});
test("a stale edit offers a reload", async ({ browser }) => {
  // Ravi (inviteAndJoin) adds an expense, so both he (creator) and Asha (owner) may edit it; both open Edit;
  // Ravi saves first; Asha saves → toast "Ravi edited this just now — reload?" with "Reload"
});
test("comment on an expense", async ({ browser }) => { /* "Add a comment" → "Post" → comment visible with "You"/"Asha" */ });
test("outsiders get a 404 for an expense", async ({ browser }) => { /* another signed-in user opens the expense URL → not-found page */ });
```

- [ ] **Step 2: Run** `pnpm test:e2e e2e/expenses.spec.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the page and components.

- [ ] **Step 4: Run** `pnpm test:e2e && pnpm test`. Expected: PASS. Then check the detail page and the
  filters sheet at 375px and 1280px, light and dark.

- [ ] **Step 5: Commit** — `git commit -m "feat(expenses): detail page, edit and conflict reload, delete with undo, filters, comments"` (include files).

---

### Task 13: Balances tab, settle-up, payments, dashboard balances

**Files:**
- Create: `src/components/balance-panel.tsx`, `src/components/settle-card.tsx`,
  `src/components/settlement-sheet.tsx`, `src/components/settlement-actions.tsx`,
  `src/app/(app)/groups/[groupId]/settle/page.tsx`,
  `src/app/(app)/groups/[groupId]/settlements/[settlementId]/page.tsx`, `e2e/settle.spec.ts`.
- Modify: `src/components/group-tabs.tsx` (+ Balances), `src/app/(app)/groups/[groupId]/page.tsx`,
  `src/app/(app)/dashboard/page.tsx`, `src/components/group-card.tsx`, `src/components/group-form.tsx`
  (a `currencyLocked` prop), `src/components/group-actions.tsx` (`GroupDetailsForm` passes it),
  `src/app/(app)/groups/[groupId]/settings/page.tsx`, `e2e/helpers.ts`.

**Interfaces:**
- Consumes: `getGroupBalances`, `listSettlements`, `getSettleUp`, `getSettlement`, `listEntityHistory`,
  `listComments`, `CommentThread`, the settlement actions, the `qrcode` package (`QRCode.toDataURL` on the
  server, as the invite sheet does), `copyLink` from `invite-sheet.tsx`, and `GroupListItem.myNet`.
- Produces `SettlementSheet({ groupId, members, currency, today, mode, initial })`. Its `mode` is
  `{ kind: "record" } | { kind: "edit"; settlementId: string }`. Fields: From, To, Amount, Method, Date, Note.
- e2e helper: `completeOnboardingUi(page, name, upiId?)` and `signInAndOnboard(page, email, name, { upiId })`.
  They fill "UPI ID (optional)" when one is given.

Behaviour and copy:
- **Balances tab:**
  - Headline: "You owe ₹X" (rose), "You're owed ₹X" (emerald), or "You're all settled up".
  - The whole group at zero → "All settled up 🎉".
  - Member rows: avatar, name (plus " (left)" when inactive), and "gets back ₹X" / "owes ₹X" / "settled up".
  - "Suggested payments": with simplification on, the caption "Simplified to 1 payment" /
    "Simplified to 4 payments"; with it off, "Showing who owes whom directly". Rows read
    "Ravi pays Asha ₹850".
  - A primary "Settle up" button → `/groups/<id>/settle` (hidden when archived).
  - "Recent payments": `listSettlements` rows linking to the payment page, with a "Disputed" badge.
- **Settle page:**
  - h1 "Settle up".
  - My transfers first, as `SettleCard`s: "You pay Asha ₹850" or "Ravi pays you ₹850".
  - For "You pay…" with `upi`:
    - A primary link styled as a button: "Pay ₹850 via UPI" (`href` = `upi.link`).
    - "Copy UPI ID" (toast "UPI ID copied").
    - A QR `<img alt="QR code to pay Asha ₹850 by UPI">`, visible from 768px and behind "Show QR code" on
      phones.
    - After the Pay link is tapped, the card shows "Did it go through?" with "Mark as paid" (records `UPI`
      for the amount) and "Not yet".
    - "Mark as paid" is always visible as a secondary button too (desktop users never tap the link), and is
      disabled while pending.
  - Every card has "Record a payment". It opens `SettlementSheet` prefilled with the transfer, where the
    amount can be lowered for a partial payment.
  - Methods: "Cash", "Bank transfer", "UPI" and "Other".
  - Other people's transfers are listed under "Between others", with "Record a payment" only when `canRecord`.
  - Nothing to settle → "All settled up 🎉".
  - Toast on recording: "Payment recorded".
- **Payment page** (`notFound()` for outsiders and deleted payments):
  - "Ravi paid Asha ₹850", method, date, note, "Recorded by …", and the status badge "Disputed" when disputed.
  - `canDispute` → "I didn't receive this". Its confirm dialog: title "Mark as not received?", body
    "It stops counting toward balances, and Ravi will see it's disputed.", confirm "Not received". Then the
    toast "Marked as not received".
  - `canEdit` → "Edit" (`SettlementSheet` in edit mode) and "Delete" (toast "Payment deleted" with "Undo").
  - Disputed, and I'm the payer or the payee → "Record it again" (the sheet prefilled with the same values
    and today's date).
  - History and Comments, as on the expense page.
- **Dashboard:**
  - Under "Hi, {firstName}": "You owe ₹4,200 + €35" and/or "You're owed ₹1,000" (sums of `myNet` per
    currency across active and archived groups, joined with " + "), or "You're all settled up".
  - Each group card adds "you owe ₹X" / "you're owed ₹X" / "settled up".
- **Settings:** when `currencyLocked`, the currency field is disabled, with the hint "The currency can't
  change once the group has expenses or payments."
- The leave/remove refusals from Task 7 show in place in the existing confirm dialogs. Verify this; no code
  change is expected.

- [ ] **Step 1: Write the failing e2e** `e2e/settle.spec.ts`

```ts
test("pay by UPI, mark as paid, then the payee disputes", async ({ browser }) => {
  const asha = await newPage(browser);
  await signInAndOnboard(asha, "asha.settle@example.test", "Asha", { upiId: "asha@okicici" });
  const groupUrl = await createGroupViaUi(asha, "Goa Trip");
  const ravi = await inviteAndJoin(asha, browser, "ravi.settle@example.test", "Ravi");
  await addExpenseViaUi(asha, { amount: "1700", description: "Hotel" });         // split equally → Ravi owes ₹850

  await ravi.goto(`${groupUrl}/settle`);
  await expect(ravi.getByRole("link", { name: "Pay ₹850 via UPI" }))
    .toHaveAttribute("href", "upi://pay?pa=asha@okicici&pn=Asha&am=850.00&cu=INR&tn=Hisaab%3A%20Goa%20Trip");
  await expect(ravi.getByRole("img", { name: "QR code to pay Asha ₹850 by UPI" })).toBeVisible();
  await ravi.getByRole("button", { name: "Mark as paid" }).dblclick();         // a double tap still records one payment
  await expect(ravi.getByText("All settled up 🎉")).toBeVisible();

  await asha.goto(`${groupUrl}?tab=balances`);
  await expect(asha.getByRole("link", { name: /Ravi paid Asha ₹850/ })).toHaveCount(1);
  await asha.getByRole("link", { name: /Ravi paid Asha ₹850/ }).click();
  await asha.getByRole("button", { name: "I didn't receive this" }).click();
  await asha.getByRole("button", { name: "Not received" }).click();
  await expect(asha.getByText("Disputed")).toBeVisible();
  await ravi.goto(`${groupUrl}?tab=balances`);
  await expect(ravi.getByText("You owe ₹850")).toBeVisible();
});
test("a USD group offers recording, not UPI", async ({ browser }) => { /* no "via UPI" link; "Record a payment" → Cash → "Payment recorded" */ });
test("the dashboard totals what you owe and are owed", async ({ browser }) => { /* "You're owed ₹850" on Asha's dashboard and the card */ });
test("leaving with a balance says what to settle", async ({ browser }) => { /* Ravi → Leave group → "Settle up before leaving: you owe ₹850." */ });
```

- [ ] **Step 2: Run** `pnpm test:e2e e2e/settle.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the panels, pages, sheet and dashboard changes.

- [ ] **Step 4: Run** `pnpm test:e2e && pnpm test`. Expected: PASS. Then, in the browser pane: the settle
  page at 375px (the Pay button is reachable with a thumb, the QR is behind "Show QR code") and at 1280px
  (the QR is visible), plus dark mode for the colour-coded balances (AA contrast).

- [ ] **Step 5: Commit** — `git commit -m "feat(settle): balances tab, UPI settle-up, payments with dispute, dashboard totals"` (include files).

---

### Task 14: Activity feeds

**Files:**
- Create: `src/components/activity-feed.tsx`, `src/app/(app)/activity/page.tsx`.
- Modify: `src/components/group-tabs.tsx` (+ Activity), `src/app/(app)/groups/[groupId]/page.tsx`,
  `src/components/app-shell/nav-items.ts`, `e2e/expenses.spec.ts`.

**Interfaces:**
- Consumes: `listGroupActivity`, `listMyActivity`, `describeActivity`.
- Produces `ActivityFeed({ items, showGroup, hasMore, moreHref })` (server component). Each line has:
  - an icon by kind (receipt, wallet, alert for disputes, message, user)
  - the title, with the detail under it
  - the `money` text, right-aligned and coloured by tone
  - the group name (when `showGroup`) and a relative time
  - a link to the expense or payment when the entity still exists (comments link to their target)

Behaviour and copy:
- `NAV_ITEMS` gains "Activity" (`/activity`, the lucide `Activity` icon) between Groups and Account.
- `/activity`: h1 "Activity", the global feed, empty state "Nothing here yet" / "When people in your groups
  add expenses or settle up, it shows up here."
- The group page's "Activity" tab shows the group feed.

- [ ] **Step 1: Write the failing e2e** (append to `e2e/expenses.spec.ts`)

```ts
test("activity tells each person what they owe", async ({ browser }) => {
  // Asha adds "Dinner at Thalassa" ₹1,480 split with Ravi (inviteAndJoin)
  // Asha: group Activity tab shows "You added “Dinner at Thalassa”" and "you get back ₹740"
  // Ravi: /activity shows "Asha added “Dinner at Thalassa”", "you owe ₹740" and the group name "Goa Trip"
});
```

- [ ] **Step 2: Run** `pnpm test:e2e e2e/expenses.spec.ts`. Expected: the new test FAILS.

- [ ] **Step 3: Implement** the feed, page, tab and nav item.

- [ ] **Step 4: Run** `pnpm test:e2e`. Expected: PASS. Check the bottom nav still fits four items at
  320px and 375px.

- [ ] **Step 5: Commit** — `git commit -m "feat(activity): group and personal activity feeds"` (include files).

---

### Task 15: The 5-person trip end to end, and production rollout

**Files:**
- Create: `e2e/trip.spec.ts`.
- Modify: `README.md` (Phase 2 features).

**Interfaces:**
- Consumes: every e2e helper above.

- [ ] **Step 1: Write the e2e** `e2e/trip.spec.ts`

This is the phase's "done when". Asha and four placeholders (Ravi, Rahul, Dev, Meera, added in that order)
enter the six expenses from Task 7's trip test **through the UI**: equal, multi-payer shares, percent,
itemised, and equal with an adjustment. Then:
- Balances shows "You're owed ₹7,801.66", and Ravi "owes ₹2,368.33", Rahul "owes ₹1,258.33", Dev
  "owes ₹2,025.01" and Meera "owes ₹2,149.99".
- "Suggested payments" says "Simplified to 4 payments".
- Asha records each suggested payment from the settle page ("Record a payment" → Cash → Save), as the payee.
- Balances shows "All settled up 🎉", and the dashboard card shows "settled up".

- [ ] **Step 2: Run** `pnpm test:e2e e2e/trip.spec.ts`. Expected: PASS. (If it fails, the bug is in an earlier
  task: fix it there with a regression test first.)

- [ ] **Step 3: Full verification**

Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`. Expected: all pass. Then
build both Docker targets locally (`docker build --target web .` and `--target migrate`). Expected: both succeed.

- [ ] **Step 4: README**

Add the Phase 2 features (expenses and splits, balances and simplification, UPI settle-up and disputes,
activity and comments) to the feature list.

- [ ] **Step 5: Commit, PR, merge**

```bash
git add e2e/trip.spec.ts README.md && git commit -m "test(e2e): a 5-person trip with mixed splits settles to exactly zero"
git push -u origin feat/phase-2 && gh pr create --fill --base main
```
Expected: the PR checks pass. Merge after Sumit confirms. Expected: the deploy job runs the `money`
migration through `hisaab-migrate` and `/api/health` is ok.

- [ ] **Step 6: Verify on real devices (with Sumit)**

- On a phone: add an expense with the keypad in under 10 seconds.
- Add a second account to the group and give it a balance. From that account, open Settle up and tap
  "Pay ₹… via UPI": GPay or PhonePe opens with the amount and note prefilled. **Don't complete the
  payment.**
- Come back, tap "Mark as paid", then dispute it from the payee's account. The balance reappears.
- Archive or leave the test group afterwards.

**Phase 2 done.**

---

## Next plans (not in this document)

- Phase 3 (real-time & notifications) adds notifications for new expenses, edits, payments, disputes and
  @mentions in comments, on top of this phase's `Activity` rows.
- Phase 4 adds FX (`currency`/`fxRate`/`baseAmount` are already in place), receipts that prefill the
  itemised split, DIRECT groups with the Friends tab, and the "≈ total" dashboard line.
