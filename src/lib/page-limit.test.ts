import { describe, expect, it } from "vitest";
import { PAGE_SIZE, parseLimit } from "./page-limit";

describe("parseLimit", () => {
  it("keeps a hand-edited limit within what a list allows", () => {
    expect(parseLimit(undefined)).toBe(PAGE_SIZE);
    expect(parseLimit("abc")).toBe(PAGE_SIZE);
    expect(parseLimit("-5")).toBe(PAGE_SIZE);
    expect(parseLimit("100")).toBe(100);
    expect(parseLimit(["150", "9"])).toBe(150);
    expect(parseLimit("99999")).toBe(500);
  });
});
