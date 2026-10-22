import { describe, expect, it } from "vitest";
import { currencyForLocale, currencyOptions } from "./currency";

describe("currencyForLocale", () => {
  it("maps the locale's region to its currency", () => {
    expect(currencyForLocale("en-IN")).toBe("INR");
    expect(currencyForLocale("hi-IN")).toBe("INR");
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("de-DE")).toBe("EUR");
    expect(currencyForLocale("en-AE")).toBe("AED");
  });

  it("falls back to INR without a known region", () => {
    expect(currencyForLocale("en")).toBe("INR");
    expect(currencyForLocale("pt-BR")).toBe("INR");
    expect(currencyForLocale("not a locale")).toBe("INR");
  });
});

describe("currencyOptions", () => {
  it("lists common currencies first, labelled with their names, and each currency once", () => {
    const { common, rest } = currencyOptions();
    expect(common[0]).toEqual({ code: "INR", label: "INR — Indian Rupee" });
    expect(rest.some((o) => o.code === "INR")).toBe(false);
    expect(rest.some((o) => o.code === "BRL")).toBe(true);
  });
});
