import { describe, expect, it } from "vitest";
import {
  currencySchema,
  displayNameSchema,
  expenseInputSchema,
  GROUP_COLORS,
  groupInputSchema,
  isoDateSchema,
  placeholderSchema,
  profileSchema,
  signUpName,
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
  it("keeps the joiners inside emoji sequences", () => expect(displayNameSchema.parse("Asha 👨‍👩‍👧")).toBe("Asha 👨‍👩‍👧"));
  it("strips control and bidi characters before trimming and counting", () => {
    expect(displayNameSchema.parse("‮Asha\r\nBcc: x⁦\u0000 ")).toBe("AshaBcc: x");
    expect(() => displayNameSchema.parse("‏\n ")).toThrow();
    expect(displayNameSchema.parse(`${"a".repeat(40)}‮`)).toBe("a".repeat(40));
  });
  it("blanks a sign-up name the rules refuse, for onboarding to ask", () => {
    expect(signUpName(" ‮Asha ")).toBe("Asha");
    expect(signUpName("a".repeat(41))).toBe("");
    expect(signUpName("")).toBe("");
  });
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

describe("placeholderSchema", () => {
  it("trims the name and lowercases the email", () =>
    expect(placeholderSchema.parse({ displayName: " Rahul ", email: "Rahul@Example.TEST" })).toEqual({
      displayName: "Rahul",
      email: "rahul@example.test",
    }));
  it("treats an empty or missing email as none", () => {
    expect(placeholderSchema.parse({ displayName: "Rahul", email: "" }).email).toBeUndefined();
    expect(placeholderSchema.parse({ displayName: "Rahul" }).email).toBeUndefined();
  });
  it("rejects a malformed email and a blank name", () => {
    expect(() => placeholderSchema.parse({ displayName: "Rahul", email: "rahul" })).toThrow();
    expect(() => placeholderSchema.parse({ displayName: "  " })).toThrow();
  });
});

describe("expenseInputSchema", () => {
  const valid = {
    groupId: "g1",
    description: " Dinner ",
    amount: "100000",
    category: "food",
    date: "2026-10-23",
    notes: "",
    payers: [{ memberId: "a", value: "100000" }],
    split: { method: "EQUAL", memberIds: ["a", "b"] },
  };
  const error = (input: object) => expenseInputSchema.safeParse({ ...valid, ...input }).error?.issues[0].message;

  it("parses money to bigint minor units, trims, and turns empty notes into null", () =>
    expect(expenseInputSchema.parse(valid)).toEqual({
      ...valid,
      description: "Dinner",
      amount: 100000n,
      notes: null,
      payers: [{ memberId: "a", value: 100000n }],
      split: { method: "EQUAL", memberIds: ["a", "b"], adjustments: [] },
    }));
  it("refuses a zero amount", () => expect(error({ amount: "0" })).toBe("Enter an amount above zero"));
  it("refuses more than 11 digits, and decimals (minor units only)", () => {
    expect(error({ amount: "123456789012" })).toBeDefined();
    expect(error({ amount: "1.5" })).toBeDefined();
    expect(expenseInputSchema.parse({ ...valid, amount: "99999999999", payers: [{ memberId: "a", value: "99999999999" }] }).amount).toBe(
      99_999_999_999n,
    );
  });
  it("refuses someone twice in one list", () => {
    expect(error({ split: { method: "EQUAL", memberIds: ["a", "a"] } })).toBe("Each person can only appear once");
    expect(error({ payers: [{ memberId: "a", value: "50000" }, { memberId: "a", value: "50000" }] })).toBe("Each person can only appear once");
    const item = { name: "Pizza", amount: "500", memberIds: ["a", "a"] };
    expect(error({ split: { method: "ITEMIZED", items: [item] } })).toBe("Each person can only appear once");
  });
  it("refuses an empty split and no payers", () => {
    expect(error({ split: { method: "EQUAL", memberIds: [] } })).toBeDefined();
    expect(error({ payers: [] })).toBe("Choose who paid");
  });
  it("refuses a percentage over 100", () =>
    expect(error({ split: { method: "PERCENT", basisPoints: [{ memberId: "a", value: "10001" }] } })).toBeDefined());
  it("makes negative shares, percents, amounts and zero-cost items unrepresentable", () => {
    const one = (value: string) => [{ memberId: "a", value }];
    expect(error({ split: { method: "EXACT", amounts: one("-5") } })).toBeDefined();
    expect(error({ split: { method: "PERCENT", basisPoints: one("-5") } })).toBeDefined();
    expect(error({ split: { method: "SHARES", shares: one("-1") } })).toBeDefined();
    expect(error({ split: { method: "SHARES", shares: one("1000") } })).toBeDefined();
    expect(error({ split: { method: "ITEMIZED", items: [{ name: "Tip", amount: "0", memberIds: ["a"] }] } })).toBe("Enter an amount above zero");
  });
  it("lets adjustments go below zero", () =>
    expect(expenseInputSchema.parse({ ...valid, split: { ...valid.split, adjustments: [{ memberId: "a", value: "-500" }] } }).split.adjustments).toEqual([
      { memberId: "a", value: -500n },
    ]));
  it("refuses an unknown category and an over-long description", () => {
    expect(error({ category: "bribes" })).toBeDefined();
    expect(error({ description: "x".repeat(101) })).toBe("Description must be 100 characters or fewer");
    expect(error({ description: "  " })).toBe("Add a description");
  });
  it("refuses impossible calendar dates", () => {
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
  });
});
