import type { ExpenseFormValues } from "@/lib/validation";

type Split = ExpenseFormValues["split"];

/**
 * What the form starts from when copying an expense: dated `today`, and without anyone who has since left (`active`:
 * the people still in the group, in group order), since a new expense can't include them. With no payer left, `me`
 * pays it all; an equal split left with nobody is everyone still here. Anything else that no longer adds up is left
 * for the form's live checks to point out.
 */
export function copyOf(source: ExpenseFormValues, { active, me, today }: { active: string[]; me: string; today: string }): ExpenseFormValues {
  const here = new Set(active);
  const keep = <T extends { memberId: string }>(list: T[]) => list.filter((p) => here.has(p.memberId));
  const payers = keep(source.payers);
  const adjustments = source.split.adjustments && keep(source.split.adjustments);

  let split: Split;
  switch (source.split.method) {
    case "EQUAL": {
      const memberIds = source.split.memberIds.filter((id) => here.has(id));
      split = { ...source.split, memberIds: memberIds.length ? memberIds : active, adjustments };
      break;
    }
    case "EXACT":
      split = { ...source.split, amounts: keep(source.split.amounts), adjustments };
      break;
    case "PERCENT":
      split = { ...source.split, basisPoints: keep(source.split.basisPoints), adjustments };
      break;
    case "SHARES":
      split = { ...source.split, shares: keep(source.split.shares), adjustments };
      break;
    case "ITEMIZED":
      split = { ...source.split, items: source.split.items.map((item) => ({ ...item, memberIds: item.memberIds.filter((id) => here.has(id)) })), adjustments };
      break;
  }
  return { ...source, date: today, payers: payers.length ? payers : [{ memberId: me, value: source.amount }], split };
}
