import { describe, expect, it } from "vitest";
import { cardLine, headline, memberLine, overallLines } from "./balance-text";

describe("headline", () => {
  it("says what the viewer owes, is owed, or that they're square", () => {
    expect(headline(-85000n, "INR")).toEqual({ text: "You owe ₹850", tone: "owe" });
    expect(headline(100000n, "INR")).toEqual({ text: "You're owed ₹1,000", tone: "owed" });
    expect(headline(0n, "INR")).toEqual({ text: "You're all settled up", tone: "even" });
  });
});

describe("memberLine and cardLine", () => {
  it("word owe and owed in both directions", () => {
    expect(memberLine(-1250n, "INR")).toEqual({ text: "owes ₹12.50", tone: "owe" });
    expect(memberLine(1250n, "INR")).toEqual({ text: "gets back ₹12.50", tone: "owed" });
    expect(memberLine(0n, "INR")).toEqual({ text: "settled up", tone: "even" });
    expect(cardLine(-3500n, "EUR")).toEqual({ text: "you owe €35", tone: "owe" });
    expect(cardLine(3500n, "EUR")).toEqual({ text: "you're owed €35", tone: "owed" });
    expect(cardLine(0n, "EUR")).toEqual({ text: "settled up", tone: "even" });
  });
});

describe("overallLines", () => {
  it("sums per currency across groups and joins the currencies with +", () => {
    const groups = [
      { currency: "INR", net: -300000n },
      { currency: "EUR", net: -3500n },
      { currency: "INR", net: -120000n },
      { currency: "INR", net: 100000n },
      { currency: "USD", net: 0n },
    ];
    // INR nets to -₹3,200: what's owed in a currency is set against what's owed to you in it, and USD nets to nothing.
    expect(overallLines(groups)).toEqual([{ text: "You owe ₹3,200 + €35", tone: "owe" }]);
  });

  it("gives both lines when the signs differ by currency", () => {
    expect(
      overallLines([
        { currency: "INR", net: -420000n },
        { currency: "EUR", net: -3500n },
        { currency: "USD", net: 100000n },
      ]),
    ).toEqual([
      { text: "You owe ₹4,200 + €35", tone: "owe" },
      { text: "You're owed $1,000", tone: "owed" },
    ]);
  });

  it("is settled when every currency nets to zero, or there is nothing", () => {
    const settled = [{ text: "You're all settled up", tone: "even" }];
    expect(overallLines([{ currency: "INR", net: 500n }, { currency: "INR", net: -500n }])).toEqual(settled);
    expect(overallLines([])).toEqual(settled);
  });
});
