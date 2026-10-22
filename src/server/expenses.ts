import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { ExpenseChange, ExpenseSnapshot } from "@/lib/activity";
import { CATEGORIES, type Category } from "@/lib/categories";
import { formatDay, fromDbDate, toDbDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money/format";
import { checkPayers, splitExpense, type Part } from "@/lib/money/split";
import type { ExpenseInput, splitSpecSchema } from "@/lib/validation";
import type { Expense, ExpensePayer, GroupMember, Prisma } from "@/generated/prisma/client";
import { recordActivity } from "./activity";
import { requireMember, requireMemberFor } from "./authz";
import { ConflictError, UserError } from "./errors";

type ExpenseFields = Omit<ExpenseInput, "groupId">;
type Split = ExpenseInput["split"];

const DELETED = "This expense was deleted.";

/** The person who added it, or an admin or the owner. */
const canChange = (member: GroupMember, expense: Expense) =>
  member.id === expense.createdByMemberId || member.role === "ADMIN" || member.role === "OWNER";

async function requireEditor(userId: string, expenseId: string) {
  const found = await requireMemberFor(userId, "expense", expenseId, { write: true });
  if (!canChange(found.member, found.row)) throw new UserError("Only the person who added this expense or an admin can change it.");
  return found;
}

function memberIdsIn({ payers, split }: ExpenseFields): string[] {
  const ids = [...payers, ...split.adjustments].map((p) => p.memberId);
  switch (split.method) {
    case "EQUAL":
      return [...ids, ...split.memberIds];
    case "EXACT":
      return [...ids, ...split.amounts.map((p) => p.memberId)];
    case "PERCENT":
      return [...ids, ...split.basisPoints.map((p) => p.memberId)];
    case "SHARES":
      return [...ids, ...split.shares.map((p) => p.memberId)];
    case "ITEMIZED":
      return [...ids, ...split.items.flatMap((item) => item.memberIds)];
  }
}

/** Every member list in group order, so a leftover paisa goes to the earliest member whatever order the client sent. */
function inGroupOrder(split: Split, rank: Map<string, number>): Split {
  const ids = (list: string[]) => list.toSorted((a, b) => rank.get(a)! - rank.get(b)!);
  const parts = (list: Part[]) => list.toSorted((a, b) => rank.get(a.memberId)! - rank.get(b.memberId)!);
  const adjustments = parts(split.adjustments);
  switch (split.method) {
    case "EQUAL":
      return { ...split, memberIds: ids(split.memberIds), adjustments };
    case "EXACT":
      return { ...split, amounts: parts(split.amounts), adjustments };
    case "PERCENT":
      return { ...split, basisPoints: parts(split.basisPoints), adjustments };
    case "SHARES":
      return { ...split, shares: parts(split.shares), adjustments };
    case "ITEMIZED":
      return { ...split, items: split.items.map((item) => ({ ...item, memberIds: ids(item.memberIds) })), adjustments };
  }
}

/**
 * Checks an expense against the group and works out the shares. Everyone it names must be an active member, or (on an
 * edit) already on this expense; the payers must cover the amount; the split must add up.
 */
async function splitFor(groupId: string, fields: ExpenseFields, currency: string, alreadyOn: string[] = []) {
  const members = await db.groupMember.findMany({
    where: { groupId, OR: [{ leftAt: null }, { id: { in: alreadyOn } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const rank = new Map(members.map((m, i) => [m.id, i]));
  if (!memberIdsIn(fields).every((id) => rank.has(id))) {
    throw new UserError("Everyone in the expense must be a current member of the group.");
  }
  const split = inGroupOrder(fields.split, rank);
  const payersError = checkPayers(fields.amount, fields.payers, currency);
  if (payersError) throw new UserError(payersError);
  const result = splitExpense(fields.amount, split, currency);
  if (!result.ok) throw new UserError(result.error);
  return { split, shares: result.shares };
}

/** The split as the form sends it (bigints as decimal strings), for `splitInput`. */
const toSplitInput = (split: Split): z.input<typeof splitSpecSchema> =>
  JSON.parse(JSON.stringify(split, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

/** Phase 2 is single-currency: everything is in the group's currency, so the base amount is the amount. */
const columns = (fields: ExpenseFields, split: Split, currency: string) => ({
  description: fields.description,
  category: fields.category,
  notes: fields.notes,
  date: toDbDate(fields.date),
  currency,
  amount: fields.amount,
  baseAmount: fields.amount,
  splitMethod: split.method,
  splitInput: toSplitInput(split),
});

const rows = (parts: Part[]) => parts.map(({ memberId, value }) => ({ memberId, amount: value, baseAmount: value }));
const asParts = (list: { memberId: string; amount: bigint }[]): Part[] => list.map(({ memberId, amount }) => ({ memberId, value: amount }));

function snapshot(expense: { description: string; amount: bigint }, currency: string, payers: Part[], shares: Part[]): ExpenseSnapshot {
  const net = new Map<string, bigint>();
  for (const { memberId, value } of payers) net.set(memberId, (net.get(memberId) ?? 0n) + value);
  for (const { memberId, value } of shares) net.set(memberId, (net.get(memberId) ?? 0n) - value);
  return {
    description: expense.description,
    amount: expense.amount.toString(),
    currency,
    net: Object.fromEntries([...net].filter(([, value]) => value !== 0n).map(([memberId, value]) => [memberId, value.toString()])),
  };
}

/** What an edit changes, as people read it. Notes, payers and split only say that they changed. */
function changesBetween(
  current: Expense & { payers: ExpensePayer[] },
  fields: ExpenseFields,
  split: Split,
  currency: string,
): ExpenseChange[] {
  const label = (category: string) => CATEGORIES[category as Category]?.label ?? category;
  const payersKey = (parts: Part[]) => parts.map((p) => `${p.memberId}:${p.value}`).sort().join();
  const date = fromDbDate(current.date);
  const fieldsAndValues: [ExpenseChange["field"], changed: boolean, before: string | null, after: string | null][] = [
    ["description", current.description !== fields.description, current.description, fields.description],
    ["amount", current.amount !== fields.amount, formatMoney(current.amount, current.currency), formatMoney(fields.amount, currency)],
    ["date", date !== fields.date, formatDay(date), formatDay(fields.date)],
    ["category", current.category !== fields.category, label(current.category), label(fields.category)],
    ["notes", current.notes !== fields.notes, null, null],
    ["payers", payersKey(asParts(current.payers)) !== payersKey(fields.payers), null, null],
    ["split", !isDeepStrictEqual(current.splitInput, toSplitInput(split)), null, null],
  ];
  return fieldsAndValues.filter(([, changed]) => changed).map(([field, , before, after]) => ({ field, before, after }));
}

/** Why a save against `version` matched nothing: the expense was deleted, or someone saved first. */
async function staleSaveError(tx: Prisma.TransactionClient, expenseId: string): Promise<UserError> {
  const { deletedAt } = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { deletedAt: true } });
  if (deletedAt) return new UserError(DELETED);
  const latest = await tx.activity.findFirst({
    where: { entityId: expenseId, kind: { startsWith: "expense." } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { actor: { select: { displayName: true } } },
  });
  return new ConflictError(`${latest?.actor.displayName ?? "Someone"} edited this just now — reload?`);
}

export async function createExpense(userId: string, input: ExpenseInput): Promise<{ id: string }> {
  const { groupId, ...fields } = input;
  const { member, group } = await requireMember(userId, groupId, { write: true });
  const currency = group.baseCurrency;
  const { split, shares } = await splitFor(groupId, fields, currency);
  return db.$transaction(async (tx) => {
    const { id } = await tx.expense.create({
      data: {
        groupId,
        ...columns(fields, split, currency),
        createdByMemberId: member.id,
        payers: { create: rows(fields.payers) },
        shares: { create: rows(shares) },
      },
      select: { id: true },
    });
    await recordActivity(tx, {
      groupId,
      actorMemberId: member.id,
      kind: "expense.created",
      entityId: id,
      payload: snapshot(fields, currency, fields.payers, shares),
    });
    return { id };
  });
}

/**
 * Saves an edit made to `version` of the expense. If anyone saved (or deleted it) since, nothing is written and the
 * person is told who, so neither edit is silently lost. A save that changes nothing writes nothing.
 */
export async function updateExpense(
  userId: string,
  expenseId: string,
  version: number,
  fields: ExpenseFields,
): Promise<{ version: number }> {
  const { member, group } = await requireEditor(userId, expenseId);
  const current = await db.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { payers: true, shares: true } });
  if (current.deletedAt) throw new UserError(DELETED);
  const currency = group.baseCurrency;
  // Someone who has left stays on the expenses they were part of.
  const alreadyOn = [...current.payers, ...current.shares].map((row) => row.memberId);
  const { split, shares } = await splitFor(current.groupId, fields, currency, alreadyOn);
  const changes = changesBetween(current, fields, split, currency);
  if (!changes.length) return { version: current.version };

  await db.$transaction(async (tx) => {
    const { count } = await tx.expense.updateMany({
      where: { id: expenseId, version, deletedAt: null },
      data: { ...columns(fields, split, currency), version: { increment: 1 } },
    });
    if (count === 0) throw await staleSaveError(tx, expenseId);
    await tx.expense.update({
      where: { id: expenseId },
      data: { payers: { deleteMany: {}, create: rows(fields.payers) }, shares: { deleteMany: {}, create: rows(shares) } },
    });
    await recordActivity(tx, {
      groupId: current.groupId,
      actorMemberId: member.id,
      kind: "expense.updated",
      entityId: expenseId,
      payload: { ...snapshot(fields, currency, fields.payers, shares), changes },
    });
  });
  return { version: version + 1 };
}

/** Conditional on the state it changes, so repeating it (a double tap) is a no-op and logs nothing. */
async function setDeleted(userId: string, expenseId: string, deleted: boolean): Promise<void> {
  const { member, row } = await requireEditor(userId, expenseId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.expense.updateMany({
      where: { id: expenseId, deletedAt: deleted ? null : { not: null } },
      data: { deletedAt: deleted ? new Date() : null, version: { increment: 1 } },
    });
    if (count === 0) return;
    const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { payers: true, shares: true } });
    await recordActivity(tx, {
      groupId: row.groupId,
      actorMemberId: member.id,
      kind: deleted ? "expense.deleted" : "expense.restored",
      entityId: expenseId,
      payload: snapshot(expense, expense.currency, asParts(expense.payers), asParts(expense.shares)),
    });
  });
}

export const deleteExpense = (userId: string, expenseId: string): Promise<void> => setDeleted(userId, expenseId, true);
export const restoreExpense = (userId: string, expenseId: string): Promise<void> => setDeleted(userId, expenseId, false);
