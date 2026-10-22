import { describe, expect, it } from "vitest";
import { currencySchema, displayNameSchema, profileSchema, timezoneSchema, upiIdSchema } from "@/lib/validation";

describe("validation", () => {
  it("trims and lowercases UPI IDs", () => expect(upiIdSchema.parse("  Sumit.T@OkAxis ")).toBe("sumit.t@okaxis"));
  it("treats an empty UPI ID as none", () => expect(upiIdSchema.parse("")).toBeNull());
  it("treats a whitespace-only UPI ID as none", () => expect(upiIdSchema.parse("   ")).toBeNull());
  it("rejects a UPI ID without a handle", () => expect(() => upiIdSchema.parse("sumit")).toThrow());
  it("explains a bad UPI ID", () =>
    expect(upiIdSchema.safeParse("sumit").error?.issues[0].message).toBe("Enter a valid UPI ID like name@bank"));
  it("uppercases known currencies", () => expect(currencySchema.parse("inr")).toBe("INR"));
  it("rejects unknown currencies", () => expect(() => currencySchema.parse("QQQ")).toThrow());
  it("rejects whitespace-only names", () => expect(() => displayNameSchema.parse("   ")).toThrow());
  it("rejects names over 40 characters", () => expect(() => displayNameSchema.parse("a".repeat(41))).toThrow());
  it("accepts emoji names", () => expect(displayNameSchema.parse(" Priya 🌸 ")).toBe("Priya 🌸"));
  it("accepts real timezones and UTC", () => {
    expect(timezoneSchema.parse("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(timezoneSchema.parse("UTC")).toBe("UTC");
  });
  it("accepts the legacy and modern names for India", () => {
    expect(timezoneSchema.parse("Asia/Calcutta")).toBe("Asia/Calcutta");
    expect(timezoneSchema.parse("Asia/Kolkata")).toBe("Asia/Kolkata");
  });
  it("rejects unknown timezones and fixed offsets", () => {
    expect(() => timezoneSchema.parse("Mars/Olympus")).toThrow();
    expect(() => timezoneSchema.parse("+05:30")).toThrow();
    expect(() => timezoneSchema.parse("")).toThrow();
  });
  it("parses a whole profile", () =>
    expect(profileSchema.parse({ name: " Asha ", defaultCurrency: "inr", upiId: "", timezone: "Asia/Kolkata" })).toEqual({
      name: "Asha",
      defaultCurrency: "INR",
      upiId: null,
      timezone: "Asia/Kolkata",
    }));
});
