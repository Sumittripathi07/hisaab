import { describe, expect, it } from "vitest";
import type { FormMember } from "@/server/expenses";
import { initialSplit, previewSplit, splitLabel, toInput, type SplitInput, type SplitState } from "./split-editor";

const person = (id: string, displayName: string, active = true): FormMember => ({ id, displayName, image: null, isPlaceholder: false, active });
// Group order (createdAt, id): Asha first.
const members = [person("asha", "Asha"), person("ravi", "Ravi"), person("rahul", "Rahul")];
const order = members.map((m) => m.id);
const start = initialSplit(members, "INR");
const state = (patch: Partial<SplitState>): SplitState => ({ ...start, ...patch });

describe("split toInput", () => {
  it("lists everyone in group order, whatever order they were ticked or typed in", () => {
    expect(toInput(state({ equal: ["rahul", "asha"] }), "INR", order)).toEqual({ method: "EQUAL", memberIds: ["asha", "rahul"], adjustments: [] });
    expect(toInput(state({ method: "EXACT", exact: { rahul: "120", asha: "500", ravi: "380" } }), "INR", order)).toEqual({
      method: "EXACT",
      amounts: [
        { memberId: "asha", value: "50000" },
        { memberId: "ravi", value: "38000" },
        { memberId: "rahul", value: "12000" },
      ],
      adjustments: [],
    });
    const items = [{ key: 0, name: " Biryani ", amount: "200", memberIds: ["ravi", "asha"] }];
    expect(toInput(state({ method: "ITEMIZED", items, adjust: true, adjustments: { rahul: "1", asha: "-1" } }), "INR", order)).toEqual({
      method: "ITEMIZED",
      items: [{ name: "Biryani", amount: "20000", memberIds: ["asha", "ravi"] }],
      adjustments: [
        { memberId: "asha", value: "-100" },
        { memberId: "rahul", value: "100" },
      ],
    });
  });

  it("reads money, percentages and shares exactly, leaving blanks and zeros out", () => {
    expect(toInput(state({ method: "EXACT", exact: { asha: "1,23,456.78", ravi: "", rahul: "0" } }), "INR", order)).toMatchObject({
      amounts: [{ memberId: "asha", value: "12345678" }],
    });
    expect(toInput(state({ method: "PERCENT", percent: { asha: "33.33", ravi: "66.67" } }), "INR", order)).toMatchObject({
      basisPoints: [
        { memberId: "asha", value: "3333" },
        { memberId: "ravi", value: "6667" },
      ],
    });
    expect(toInput(state({ method: "SHARES", shares: { asha: "2", ravi: "0", rahul: "1" } }), "INR", order)).toMatchObject({
      shares: [
        { memberId: "asha", value: "2" },
        { memberId: "rahul", value: "1" },
      ],
    });
    expect(toInput(state({ method: "EXACT", exact: { asha: "1000" } }), "JPY", order)).toMatchObject({ amounts: [{ memberId: "asha", value: "1000" }] });
  });

  it.each([
    ["a third decimal", { method: "EXACT", exact: { asha: "1.234" } }],
    ["letters", { method: "EXACT", exact: { asha: "12a" } }],
    ["a decimal in a currency without them", { method: "EXACT", exact: { asha: "10.5" } }, "JPY"],
    ["a negative amount", { method: "EXACT", exact: { asha: "-5" } }],
    ["a negative percentage", { method: "PERCENT", percent: { asha: "-5" } }],
    ["a percentage with three decimals", { method: "PERCENT", percent: { asha: "33.333" } }],
    ["a negative share", { method: "SHARES", shares: { asha: "-1" } }],
    ["a fractional share", { method: "SHARES", shares: { asha: "1.5" } }],
    ["an item amount that isn't one", { method: "ITEMIZED", items: [{ key: 0, name: "Tea", amount: "1..2", memberIds: ["asha"] }] }],
    ["an adjustment with two signs", { adjust: true, adjustments: { asha: "--5" } }],
  ] as [string, Partial<SplitState>, string?][])("is null for %s", (_, patch, currency = "INR") => {
    expect(toInput(state(patch), currency, order)).toBeNull();
  });

  it("takes adjustments only while they're switched on, and never with exact amounts", () => {
    const typed = { adjustments: { ravi: "-25.5", rahul: "-" } };
    expect(toInput(state({ ...typed, adjust: false }), "INR", order)).toMatchObject({ adjustments: [] });
    // A lone "-" is someone about to type a number: nothing yet.
    expect(toInput(state({ ...typed, adjust: true }), "INR", order)).toMatchObject({ adjustments: [{ memberId: "ravi", value: "-2550" }] });
    expect(toInput(state({ ...typed, adjust: true, method: "EXACT", exact: { asha: "1" } }), "INR", order)).toMatchObject({ adjustments: [] });
  });

  it("keeps an item of zero, for splitExpense to ask about", () => {
    const items = [{ key: 0, name: "Tea", amount: "", memberIds: ["asha"] }];
    expect(toInput(state({ method: "ITEMIZED", items }), "INR", order)).toMatchObject({ items: [{ name: "Tea", amount: "0" }] });
  });

  it("starts an edit from what was saved, for every method", () => {
    const saved: SplitInput[] = [
      { method: "EQUAL", memberIds: ["asha", "ravi"], adjustments: [{ memberId: "rahul", value: "-1050" }] },
      { method: "EXACT", amounts: [{ memberId: "asha", value: "50000" }, { memberId: "rahul", value: "50050" }], adjustments: [] },
      { method: "PERCENT", basisPoints: [{ memberId: "asha", value: "3333" }, { memberId: "ravi", value: "6667" }], adjustments: [] },
      { method: "SHARES", shares: [{ memberId: "ravi", value: "2" }, { memberId: "rahul", value: "1" }], adjustments: [] },
      { method: "ITEMIZED", items: [{ name: "Tea", amount: "4000", memberIds: ["asha", "rahul"] }], adjustments: [{ memberId: "ravi", value: "500" }] },
    ];
    for (const input of saved) expect(toInput(initialSplit(members, "INR", input), "INR", order)).toEqual(input);
  });

  it("splits a new expense equally between everyone still in the group", () => {
    const withLeft = [...members, person("old", "Old", false)];
    expect(toInput(initialSplit(withLeft, "INR"), "INR", withLeft.map((m) => m.id))).toEqual({ method: "EQUAL", memberIds: order, adjustments: [] });
  });
});

describe("split preview", () => {
  const preview = (patch: Partial<SplitState>, total: bigint) => previewSplit(state(patch), "INR", total, order);

  it("shows the brief's examples to the paisa", () => {
    expect(preview({ method: "SHARES", shares: { asha: "2", ravi: "1", rahul: "1" }, adjust: true, adjustments: { rahul: "100" } }, 100000n)).toEqual({
      ok: true,
      shares: [
        { memberId: "asha", value: 45000n },
        { memberId: "ravi", value: 22500n },
        { memberId: "rahul", value: 32500n },
      ],
    });
    expect(preview({ method: "EXACT", exact: { asha: "500", ravi: "380" } }, 100000n)).toEqual({ ok: false, error: "₹120 left to assign" });
    const items = [
      { key: 0, name: "Paneer tikka", amount: "300", memberIds: ["asha"] },
      { key: 1, name: "Biryani", amount: "200", memberIds: ["asha", "ravi"] },
    ];
    expect(preview({ method: "ITEMIZED", items }, 55000n)).toEqual({
      ok: true,
      shares: [
        { memberId: "asha", value: 44000n },
        { memberId: "ravi", value: 11000n },
      ],
    });
  });

  it("gives a leftover paisa to the earliest member, as the server does", () => {
    // Ticked last-first: the extra paisa still goes to Asha.
    expect(preview({ equal: ["rahul", "ravi", "asha"] }, 100n)).toMatchObject({ shares: [{ memberId: "asha", value: 34n }, {}, {}] });
    // Rahul's item comes first, but Asha is earlier in the group: she gets the odd paisa of the extras.
    const items = [
      { key: 0, name: "Tea", amount: "0.01", memberIds: ["rahul"] },
      { key: 1, name: "Coffee", amount: "0.01", memberIds: ["asha"] },
    ];
    expect(preview({ method: "ITEMIZED", items }, 3n)).toEqual({
      ok: true,
      shares: [
        { memberId: "asha", value: 2n },
        { memberId: "rahul", value: 1n },
      ],
    });
  });

  it("says what's wrong instead of throwing on half-typed input", () => {
    expect(preview({ method: "PERCENT", percent: { asha: "-5" } }, 100n)).toEqual({ ok: false, error: "Enter a percentage up to 100" });
    expect(preview({ method: "SHARES", shares: { asha: "-1" } }, 100n)).toEqual({ ok: false, error: "Enter a valid amount" });
    expect(preview({ method: "PERCENT", percent: { asha: "50" } }, 100n)).toEqual({ ok: false, error: "50% left to assign" });
    expect(preview({ method: "ITEMIZED", items: [{ key: 0, name: "", amount: "", memberIds: [] }] }, 100n)).toEqual({ ok: false, error: "Name each item" });
    expect(preview({ method: "ITEMIZED", items: [{ key: 0, name: "Tea", amount: "0", memberIds: ["asha"] }] }, 100n)).toEqual({
      ok: false,
      error: "Enter an amount for “Tea”",
    });
  });
});

describe("split chip", () => {
  it("counts only people still in the group", () => {
    const withLeft = [...members, person("old", "Old", false)];
    // Old is on this expense but gone: "2 of 3", not "3 of 4".
    expect(splitLabel(state({ equal: ["asha", "ravi", "old"] }), withLeft)).toBe("Split equally · 2 of 3");
    expect(splitLabel(state({ equal: order }), withLeft)).toBe("Split equally");
    expect(splitLabel(state({ method: "SHARES" }), withLeft)).toBe("By shares");
  });
});
