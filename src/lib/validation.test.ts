import { describe, expect, it } from "vitest";
import {
  currencySchema,
  displayNameSchema,
  GROUP_COLORS,
  groupInputSchema,
  profileSchema,
  timezoneSchema,
  upiIdSchema,
} from "@/lib/validation";

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

describe("groupInputSchema", () => {
  const valid = { name: "Goa Trip", type: "TRIP", baseCurrency: "INR" };

  it("fills in the emoji, colour and simplify defaults", () =>
    expect(groupInputSchema.parse(valid)).toEqual({
      name: "Goa Trip",
      emoji: "👥",
      color: "emerald",
      type: "TRIP",
      baseCurrency: "INR",
      simplifyDebts: true,
    }));
  it("keeps what the person chose", () =>
    expect(groupInputSchema.parse({ ...valid, emoji: "🏖️", color: "rose", simplifyDebts: false })).toMatchObject({
      emoji: "🏖️",
      color: "rose",
      simplifyDebts: false,
    }));
  it("trims the name and uppercases the currency", () =>
    expect(groupInputSchema.parse({ ...valid, name: "  Goa Trip ", baseCurrency: "inr" })).toMatchObject({
      name: "Goa Trip",
      baseCurrency: "INR",
    }));
  it("rejects the DIRECT type from user input", () => expect(() => groupInputSchema.parse({ ...valid, type: "DIRECT" })).toThrow());
  it("rejects an unknown type", () => expect(() => groupInputSchema.parse({ ...valid, type: "PARTY" })).toThrow());
  it("rejects whitespace-only and empty names", () => {
    expect(() => groupInputSchema.parse({ ...valid, name: "   " })).toThrow();
    expect(() => groupInputSchema.parse({ ...valid, name: "" })).toThrow();
  });
  it("rejects names over 60 characters", () => {
    expect(() => groupInputSchema.parse({ ...valid, name: "a".repeat(61) })).toThrow();
    expect(groupInputSchema.parse({ ...valid, name: "a".repeat(60) }).name).toHaveLength(60);
  });
  it("rejects unknown colours and accepts every listed one", () => {
    expect(() => groupInputSchema.parse({ ...valid, color: "chartreuse" })).toThrow();
    for (const color of GROUP_COLORS) expect(groupInputSchema.parse({ ...valid, color }).color).toBe(color);
  });
  it("rejects a blank or over-long emoji", () => {
    expect(() => groupInputSchema.parse({ ...valid, emoji: "" })).toThrow();
    expect(() => groupInputSchema.parse({ ...valid, emoji: "   " })).toThrow();
    expect(() => groupInputSchema.parse({ ...valid, emoji: "x".repeat(17) })).toThrow();
  });
  it("rejects an unknown currency", () => expect(() => groupInputSchema.parse({ ...valid, baseCurrency: "QQQ" })).toThrow());
  it("explains an empty name", () =>
    expect(groupInputSchema.safeParse({ ...valid, name: " " }).error?.issues[0].message).toBe("Enter a group name"));
});
