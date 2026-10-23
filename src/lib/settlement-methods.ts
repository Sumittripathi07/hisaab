export type SettlementMethodKey = "CASH" | "BANK" | "UPI" | "OTHER";

/** How a payment was made, in the order the sheet offers them. */
export const SETTLEMENT_METHODS: { value: SettlementMethodKey; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank transfer" },
  { value: "UPI", label: "UPI" },
  { value: "OTHER", label: "Other" },
];

export const METHOD_LABEL = Object.fromEntries(SETTLEMENT_METHODS.map((m) => [m.value, m.label])) as Record<SettlementMethodKey, string>;
