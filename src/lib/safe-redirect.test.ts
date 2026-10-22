import { describe, expect, it } from "vitest";
import { safeCallback } from "@/lib/safe-redirect";

describe("safeCallback", () => {
  it.each([
    ["/join/abc?x=1", "/join/abc?x=1"],
    ["/", "/"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["dashboard", "/dashboard"],
    // Browsers drop tabs and newlines inside URLs, so these would become "//evil.com".
    ["/\t/evil.com", "/dashboard"],
    ["/\n/evil.com", "/dashboard"],
    ["", "/dashboard"],
    [null, "/dashboard"],
    [undefined, "/dashboard"],
  ])("safeCallback(%j) -> %s", (input, out) => expect(safeCallback(input)).toBe(out));

  it("uses the fallback it is given", () => {
    expect(safeCallback("//evil.com", "/sign-in")).toBe("/sign-in");
  });
});
