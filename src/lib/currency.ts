// Euro-area members (Bulgaria joined in 2026).
const EURO_AREA = "AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const BY_REGION: Record<string, string> = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  AE: "AED",
  SG: "SGD",
  AU: "AUD",
  CA: "CAD",
  JP: "JPY",
  TH: "THB",
  ...Object.fromEntries(EURO_AREA.map((region) => [region, "EUR"])),
};

/** The currency for a locale's region ("en-IN" → "INR"). India-first: no region, or one we don't map, gives INR. */
export function currencyForLocale(locale: string): string {
  try {
    return BY_REGION[new Intl.Locale(locale).region ?? ""] ?? "INR";
  } catch {
    return "INR"; // not a valid locale tag
  }
}

const COMMON = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "THB"];

export type CurrencyOption = { code: string; label: string };
export type CurrencyOptions = { common: CurrencyOption[]; rest: CurrencyOption[] };

/**
 * Every currency, labelled "INR — Indian Rupee": the common ones first, then the rest A–Z.
 * Build it on the server and pass it down, so server and browser can't disagree on the names.
 */
export function currencyOptions(): CurrencyOptions {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  const option = (code: string) => ({ code, label: `${code} — ${names.of(code)}` });
  return {
    common: COMMON.map(option),
    rest: Intl.supportedValuesOf("currency")
      .filter((code) => !COMMON.includes(code))
      .map(option),
  };
}
