import type { MinorString } from "@/lib/money/format";

/** Everything the group's feed can say. The payload of each kind is in `ActivityPayloads`. */
export type ActivityKind =
  | "expense.created" | "expense.updated" | "expense.deleted" | "expense.restored"
  | "settlement.created" | "settlement.updated" | "settlement.deleted" | "settlement.restored" | "settlement.disputed"
  | "comment.created" | "member.joined" | "member.added" | "member.left" | "member.removed";

/** What an expense looked like at that moment. `net` is paid − share per member id; zeros are left out. */
export type ExpenseSnapshot = { description: string; amount: MinorString; currency: string; net: Record<string, MinorString> };

/** One edited field, before and after, as display text. */
export type ExpenseChange = {
  field: "description" | "amount" | "date" | "category" | "notes" | "payers" | "split";
  before: string | null;
  after: string | null;
};

export type SettlementSnapshot = {
  fromMemberId: string;
  toMemberId: string;
  amount: MinorString;
  currency: string;
  method: "UPI" | "CASH" | "BANK" | "OTHER";
};

type MemberRef = { memberId: string; displayName: string };

export type ActivityPayloads = {
  "expense.created": ExpenseSnapshot;
  "expense.deleted": ExpenseSnapshot;
  "expense.restored": ExpenseSnapshot;
  "expense.updated": ExpenseSnapshot & { changes: ExpenseChange[] };
  "settlement.created": SettlementSnapshot;
  "settlement.updated": SettlementSnapshot;
  "settlement.deleted": SettlementSnapshot;
  "settlement.restored": SettlementSnapshot;
  "settlement.disputed": SettlementSnapshot;
  "comment.created": { targetKind: "expense" | "settlement"; targetId: string; targetLabel: string; excerpt: string };
  "member.joined": MemberRef;
  "member.added": MemberRef;
  "member.left": MemberRef;
  "member.removed": MemberRef;
};
