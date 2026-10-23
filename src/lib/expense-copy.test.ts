import { describe, expect, it } from "vitest";
import { copyOf } from "./expense-copy";
import type { ExpenseFormValues } from "./validation";

// Asha, Ravi and Rahul are still here; Leela has left.
const active = ["asha", "ravi", "rahul"];
const at = { active, me: "asha", today: "2026-10-23" };
const expense = (patch: Partial<ExpenseFormValues>): ExpenseFormValues => ({
  description: "Dinner",
  amount: "100000",
  category: "food",
  date: "2026-10-01",
  notes: "",
  payers: [{ memberId: "asha", value: "100000" }],
  split: { method: "EQUAL", memberIds: ["asha", "ravi", "leela"], adjustments: [] },
  ...patch,
});

describe("copying an expense", () => {
  it("is dated today and otherwise the same when everyone is still here", () => {
    const source = expense({ split: { method: "EQUAL", memberIds: active, adjustments: [] } });
    expect(copyOf(source, at)).toEqual({ ...source, date: "2026-10-23" });
  });

  it("drops a payer who has left, and the payer who is left stays", () => {
    const source = expense({ payers: [{ memberId: "leela", value: "40000" }, { memberId: "ravi", value: "60000" }] });
    expect(copyOf(source, at).payers).toEqual([{ memberId: "ravi", value: "60000" }]);
  });

  it("has the current user pay it all when every payer has left", () => {
    expect(copyOf(expense({ payers: [{ memberId: "leela", value: "100000" }] }), at).payers).toEqual([{ memberId: "asha", value: "100000" }]);
  });

  it("drops people who left from an equal split, and from its adjustments", () => {
    const split = { method: "EQUAL" as const, memberIds: ["asha", "leela", "ravi"], adjustments: [{ memberId: "leela", value: "-100" }, { memberId: "ravi", value: "100" }] };
    expect(copyOf(expense({ split }), at).split).toEqual({ method: "EQUAL", memberIds: ["asha", "ravi"], adjustments: [{ memberId: "ravi", value: "100" }] });
  });

  it("splits equally between everyone still here when nobody in an equal split is", () => {
    const split = { method: "EQUAL" as const, memberIds: ["leela"], adjustments: [] };
    expect(copyOf(expense({ split }), at).split).toMatchObject({ method: "EQUAL", memberIds: active });
  });

  it.each([
    ["EXACT", { method: "EXACT", amounts: [{ memberId: "leela", value: "30000" }, { memberId: "ravi", value: "70000" }] }, { amounts: [{ memberId: "ravi", value: "70000" }] }],
    ["PERCENT", { method: "PERCENT", basisPoints: [{ memberId: "leela", value: "3000" }, { memberId: "ravi", value: "7000" }] }, { basisPoints: [{ memberId: "ravi", value: "7000" }] }],
    ["SHARES", { method: "SHARES", shares: [{ memberId: "leela", value: "2" }, { memberId: "ravi", value: "3" }] }, { shares: [{ memberId: "ravi", value: "3" }] }],
    [
      "ITEMIZED",
      { method: "ITEMIZED", items: [{ name: "Biryani", amount: "50000", memberIds: ["leela", "asha"] }, { name: "Naan", amount: "20000", memberIds: ["leela"] }] },
      { items: [{ name: "Biryani", amount: "50000", memberIds: ["asha"] }, { name: "Naan", amount: "20000", memberIds: [] }] },
    ],
  ] as const)("drops people who left from a %s split", (method, split, expected) => {
    expect(copyOf(expense({ split: { ...split, adjustments: [] } as never }), at).split).toEqual({ method, ...expected, adjustments: [] });
  });
});
