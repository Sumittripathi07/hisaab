import { describe, expect, it } from "vitest";
import { initialPayers, payersProblem, toInput } from "./payers-editor";

describe("payers toInput", () => {
  it("has one payer paying the whole amount", () => {
    expect(toInput(initialPayers("asha", "INR"), "INR", 100000n)).toEqual([{ memberId: "asha", value: "100000" }]);
  });

  it("reads each amount when several people paid, leaving blanks out", () => {
    const state = { multiple: true, single: "asha", amounts: { asha: "600", ravi: "300.5", rahul: "" } };
    expect(toInput(state, "INR", 100000n)).toEqual([
      { memberId: "asha", value: "60000" },
      { memberId: "ravi", value: "30050" },
    ]);
    expect(payersProblem(state, "INR", 100000n)).toBe("₹99.50 of the total isn't paid by anyone");
    expect(payersProblem({ ...state, amounts: { asha: "600", ravi: "400" } }, "INR", 100000n)).toBeNull();
  });

  it.each(["1.234", "-5", "abc"])("is null for %j", (typed) => {
    const state = { multiple: true, single: "asha", amounts: { asha: typed } };
    expect(toInput(state, "INR", 100n)).toBeNull();
    expect(payersProblem(state, "INR", 100n)).toBe("Enter a valid amount");
  });

  it("starts an edit from what was saved", () => {
    const saved = [
      { memberId: "asha", value: "60000" },
      { memberId: "ravi", value: "40050" },
    ];
    expect(toInput(initialPayers("asha", "INR", saved), "INR", 100050n)).toEqual(saved);
    expect(toInput(initialPayers("asha", "INR", [{ memberId: "ravi", value: "500" }]), "INR", 500n)).toEqual([{ memberId: "ravi", value: "500" }]);
  });
});
