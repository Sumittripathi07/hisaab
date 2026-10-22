import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { ExpenseChange, ExpenseSnapshot } from "@/lib/activity";
import { CATEGORIES, normalise, type Category } from "@/lib/categories";
import { formatDay, fromDbDate, toDbDate, todayIn } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money/format";
import { checkPayers, splitExpense, type Part } from "@/lib/money/split";
import { isoDateSchema, type ExpenseInput, type splitSpecSchema } from "@/lib/validation";
import type { Expense, ExpensePayer, GroupMember, Prisma, SplitMethod } from "@/generated/prisma/client";
import { recordActivity } from "./activity";
import { requireMember, requireMemberFor } from "./authz";
import { ConflictError, NotFoundError, UserError } from "./errors";

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
  const result = splitExpense(fields.amount, split, currency, members.map((m) => m.id));
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

export type ExpenseFilters = { q?: string; memberId?: string; category?: Category; from?: string; to?: string };

export type ExpenseListItem = {
  id: string;
  description: string;
  category: Category;
  date: string;
  amount: bigint;
  currency: string;
  payerLabel: string;
  /** What the viewer paid minus their share: positive means they lent, negative means they owe. */
  myNet: bigint;
  commentCount: number;
};

const payerLabel = (payers: { memberId: string; member: { displayName: string } }[], me: string) => {
  const [only, ...others] = payers;
  if (!only || others.length) return `${payers.length} people paid`;
  return only.memberId === me ? "You paid" : `${only.member.displayName} paid`;
};

/** A date filter that isn't a real "YYYY-MM-DD" (a hand-edited URL) is ignored rather than failing the page. */
const day = (value?: string) => (value && isoDateSchema.safeParse(value).success ? toDbDate(value) : undefined);

export async function listExpenses(
  userId: string,
  groupId: string,
  filters: ExpenseFilters,
  limit = 50,
): Promise<{ items: ExpenseListItem[]; hasMore: boolean }> {
  const { member } = await requireMember(userId, groupId);
  const take = Math.min(500, Math.max(1, Math.trunc(limit) || 1));
  const q = filters.q?.trim();
  // strpos is a plain substring match (no LIKE), so %, _ and \ in the search mean themselves.
  const matches = q
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Expense"
        WHERE "groupId" = ${groupId} AND "deletedAt" IS NULL
          AND (strpos(lower(description), lower(${q})) > 0
               OR strpos(lower(coalesce(notes, '')), lower(${q})) > 0)`
    : null;
  const { memberId } = filters;
  const rows = await db.expense.findMany({
    where: {
      groupId,
      deletedAt: null,
      id: matches ? { in: matches.map((m) => m.id) } : undefined,
      category: filters.category,
      OR: memberId ? [{ payers: { some: { memberId } } }, { shares: { some: { memberId } } }] : undefined,
      date: { gte: day(filters.from), lte: day(filters.to) },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    include: {
      payers: { select: { memberId: true, amount: true, member: { select: { displayName: true } } } },
      shares: { where: { memberId: member.id }, select: { amount: true } },
      _count: { select: { comments: { where: { deletedAt: null } } } },
    },
  });
  const items = rows.slice(0, take).map((e) => ({
    id: e.id,
    description: e.description,
    category: e.category as Category,
    date: fromDbDate(e.date),
    amount: e.amount,
    currency: e.currency,
    payerLabel: payerLabel(e.payers, member.id),
    myNet: (e.payers.find((p) => p.memberId === member.id)?.amount ?? 0n) - (e.shares[0]?.amount ?? 0n),
    commentCount: e._count.comments,
  }));
  return { items, hasMore: rows.length > take };
}

type Person = { memberId: string; displayName: string; amount: bigint };

export type ExpenseDetail = {
  expense: {
    id: string;
    groupId: string;
    description: string;
    category: Category;
    notes: string | null;
    date: string;
    amount: bigint;
    currency: string;
    splitMethod: SplitMethod;
    version: number;
    createdAt: Date;
    /** Display name of the member who added it. */
    createdBy: string;
  };
  /** The split as entered, for prefilling an edit. */
  split: z.input<typeof splitSpecSchema>;
  payers: Person[];
  shares: Person[];
  canEdit: boolean;
};

export async function getExpense(userId: string, expenseId: string): Promise<ExpenseDetail> {
  const { member, group, row } = await requireMemberFor(userId, "expense", expenseId);
  if (row.deletedAt) throw new NotFoundError(DELETED);
  const people = { select: { memberId: true, amount: true, member: { select: { displayName: true } } } } as const;
  const inJoinOrder = [{ member: { createdAt: "asc" } }, { memberId: "asc" }] as const;
  const e = await db.expense.findUniqueOrThrow({
    where: { id: expenseId },
    include: {
      createdBy: { select: { displayName: true } },
      payers: { ...people, orderBy: [...inJoinOrder] },
      shares: { ...people, orderBy: [...inJoinOrder] },
    },
  });
  const named = (list: typeof e.payers): Person[] => list.map((p) => ({ memberId: p.memberId, displayName: p.member.displayName, amount: p.amount }));
  return {
    expense: {
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      category: e.category as Category,
      notes: e.notes,
      date: fromDbDate(e.date),
      amount: e.amount,
      currency: e.currency,
      splitMethod: e.splitMethod,
      version: e.version,
      createdAt: e.createdAt,
      createdBy: e.createdBy.displayName,
    },
    split: e.splitInput as z.input<typeof splitSpecSchema>,
    payers: named(e.payers),
    shares: named(e.shares),
    canEdit: canChange(member, row) && !group.archivedAt,
  };
}

export type FormMember = { id: string; displayName: string; image: string | null; isPlaceholder: boolean; active: boolean };

export type ExpenseFormData = {
  groupId: string;
  groupName: string;
  currency: string;
  today: string;
  /** The viewer's member id. */
  me: string;
  members: FormMember[];
  /** Past descriptions with the category the group gave them, newest first, for suggesting a category. */
  history: { description: string; category: string }[];
};

const HISTORY_SIZE = 200;
// ponytail: looks at the 1,000 newest expenses, so a group with more than that and few repeats offers fewer than 200.
const HISTORY_SCAN = 1000;

/** What the add/edit form needs. With `expenseId`, people who have left but are on that expense stay in the list. */
export async function getExpenseFormData(userId: string, groupId: string, expenseId?: string): Promise<ExpenseFormData> {
  const { member, group } = await requireMember(userId, groupId);
  const [user, members, past] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    db.groupMember.findMany({
      // Scoped to this group, so an expense id from another group adds nobody.
      where: {
        groupId,
        OR: [{ leftAt: null }, ...(expenseId ? [{ expensePayments: { some: { expenseId } } }, { expenseShares: { some: { expenseId } } }] : [])],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { user: { select: { image: true } } },
    }),
    db.expense.findMany({
      where: { groupId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_SCAN,
      select: { description: true, category: true },
    }),
  ]);
  const latest = new Map<string, { description: string; category: string }>();
  for (const entry of past) if (!latest.has(normalise(entry.description))) latest.set(normalise(entry.description), entry);
  return {
    groupId,
    groupName: group.name,
    currency: group.baseCurrency,
    today: todayIn(user.timezone),
    me: member.id,
    members: members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      image: m.user?.image ?? null,
      isPlaceholder: m.userId === null,
      active: m.leftAt === null,
    })),
    history: [...latest.values()].slice(0, HISTORY_SIZE),
  };
}
