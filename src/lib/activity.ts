import { formatMoney, type MinorString } from "@/lib/money/format";

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

/**
 * A feed row as one viewer reads it. `names` has every member of the group, people who left included, since payloads
 * point at member ids; `currency` is the group's.
 */
export type ActivityView = { [K in ActivityKind]: { kind: K; payload: ActivityPayloads[K] } }[ActivityKind] & {
  actorMemberId: string;
  viewerMemberId: string;
  currency: string;
  names: Record<string, string>;
};

export type ActivityText = {
  title: string;
  /** A second line: what an edit changed, who recorded a payment, a comment's start. */
  detail: string | null;
  /** What it means for the viewer's balance, when they're in the expense. */
  money: { text: string; tone: "owe" | "owed" } | null;
};

/** The expense or payment a row is about, if any. A comment row's own entity is the comment, so it points at its target. */
export function linkTarget(a: ActivityView & { entityId: string }): { kind: "expense" | "settlement"; id: string } | null {
  if (a.kind === "comment.created") return { kind: a.payload.targetKind, id: a.payload.targetId };
  if (a.kind.startsWith("expense.")) return { kind: "expense", id: a.entityId };
  if (a.kind.startsWith("settlement.")) return { kind: "settlement", id: a.entityId };
  return null;
}

const EXPENSE_VERB = { "expense.created": "added", "expense.updated": "edited", "expense.deleted": "deleted", "expense.restored": "restored" } as const;
const PAYMENT_VERB = { "settlement.updated": "edited", "settlement.deleted": "deleted", "settlement.restored": "restored" } as const;

function describeChange({ field, before, after }: ExpenseChange): string {
  if (field === "description") return `renamed from “${before}”`;
  if (field === "payers") return "who paid";
  if (field === "split") return "the split";
  return before === null || after === null ? field : `${field} ${before} → ${after}`;
}

/** The sentence a feed or history shows for one activity row. Pure, so client components can use it too. */
export function describeActivity(a: ActivityView): ActivityText {
  // "You" only opens a sentence; anywhere else it's "you".
  const who = (memberId: string, opening = false) => (memberId === a.viewerMemberId ? (opening ? "You" : "you") : (a.names[memberId] ?? "Someone"));
  const amount = (minor: MinorString) => formatMoney(BigInt(minor), a.currency);
  const actor = who(a.actorMemberId, true);
  const plain = (title: string): ActivityText => ({ title, detail: null, money: null });

  switch (a.kind) {
    case "expense.created":
    case "expense.updated":
    case "expense.deleted":
    case "expense.restored": {
      const { description, net } = a.payload;
      const mine = a.kind === "expense.deleted" ? 0n : BigInt(net[a.viewerMemberId] ?? 0);
      let money: ActivityText["money"] = null;
      if (mine < 0n) money = { text: `you owe ${formatMoney(-mine, a.currency)}`, tone: "owe" };
      if (mine > 0n) money = { text: `you get back ${formatMoney(mine, a.currency)}`, tone: "owed" };
      return {
        title: `${actor} ${EXPENSE_VERB[a.kind]} “${description}”`,
        detail: (a.kind === "expense.updated" && a.payload.changes.map(describeChange).join(" · ")) || null,
        money,
      };
    }
    case "settlement.created": {
      const { fromMemberId: from, toMemberId: to } = a.payload;
      return {
        title: `${who(from, true)} paid ${who(to)} ${amount(a.payload.amount)}`,
        detail: a.actorMemberId === from ? null : `Recorded by ${who(a.actorMemberId)}`,
        money: null,
      };
    }
    case "settlement.disputed": {
      const { fromMemberId: from, toMemberId: to } = a.payload;
      return plain(`${who(to, true)} didn't receive ${amount(a.payload.amount)} from ${who(from)}`);
    }
    case "settlement.updated":
    case "settlement.deleted":
    case "settlement.restored":
      return plain(`${actor} ${PAYMENT_VERB[a.kind]} a payment from ${who(a.payload.fromMemberId)} to ${who(a.payload.toMemberId)}`);
    case "comment.created":
      return { title: `${actor} commented on “${a.payload.targetLabel}”`, detail: a.payload.excerpt || null, money: null };
    case "member.joined":
      return plain(`${actor} joined the group`);
    case "member.left":
      return plain(`${actor} left the group`);
    case "member.added":
      return plain(`${actor} added ${a.payload.displayName}`);
    case "member.removed":
      return plain(`${actor} removed ${a.payload.displayName}`);
  }
}
