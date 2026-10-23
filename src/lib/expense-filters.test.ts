import { describe, expect, it } from "vitest";
import { activeFilters, parseFilters, toQuery } from "./expense-filters";

describe("parseFilters", () => {
  it("reads each filter from the address", () => {
    expect(parseFilters({ q: "  50% off ", member: "m1", category: "transport", from: "2026-10-01", to: "2026-10-31" })).toEqual({
      q: "50% off",
      memberId: "m1",
      category: "transport",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("drops what a hand-edited address gets wrong, and takes the first of a repeated one", () => {
    expect(parseFilters({ q: "   ", category: "yachts", from: "2026-02-30", to: "tomorrow", member: ["a", "b"] })).toEqual({ memberId: "a" });
    expect(parseFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(parseFilters({})).toEqual({});
  });
});

describe("toQuery", () => {
  it("writes only the filters that are set, URL-encoded, after any extras", () => {
    expect(toQuery({}, { tab: "expenses" })).toBe("tab=expenses");
    expect(toQuery({ q: "50% off", category: "food", from: "2026-10-01" }, { tab: "expenses", limit: "100" })).toBe(
      "tab=expenses&limit=100&q=50%25+off&category=food&from=2026-10-01",
    );
  });

  it("round-trips through parseFilters", () => {
    const filters = { q: "a&b=c", memberId: "m1", category: "fuel" as const, from: "2026-10-01", to: "2026-10-02" };
    expect(parseFilters(Object.fromEntries(new URLSearchParams(toQuery(filters))))).toEqual(filters);
  });
});

describe("activeFilters", () => {
  it("counts the filters in the sheet, not the search", () => {
    expect(activeFilters({ q: "x" })).toBe(0);
    expect(activeFilters({ q: "x", memberId: "m1", from: "2026-10-01" })).toBe(2);
  });
});
