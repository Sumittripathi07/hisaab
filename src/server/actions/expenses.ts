"use server";

import { z } from "zod";
import { expenseInputSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { createExpense, deleteExpense, restoreExpense, updateExpense } from "@/server/expenses";
import { revalidateGroup } from "@/server/revalidate";

const expenseIdSchema = z.object({ expenseId: z.string().min(1) });
const updateSchema = expenseInputSchema.omit({ groupId: true }).extend({ ...expenseIdSchema.shape, version: z.number().int().positive() });

export const createExpenseAction = defineAction(expenseInputSchema, async (input, user) => {
  const created = await createExpense(user.id, input);
  revalidateGroup();
  return created;
});

/** A conflict comes back as `{ ok: false, code: "conflict" }`, for the form to offer a reload. */
export const updateExpenseAction = defineAction(updateSchema, async ({ expenseId, version, ...fields }, user) => {
  const saved = await updateExpense(user.id, expenseId, version, fields);
  revalidateGroup();
  return saved;
});

export const deleteExpenseAction = defineAction(expenseIdSchema, async ({ expenseId }, user) => {
  await deleteExpense(user.id, expenseId);
  revalidateGroup();
});

export const restoreExpenseAction = defineAction(expenseIdSchema, async ({ expenseId }, user) => {
  await restoreExpense(user.id, expenseId);
  revalidateGroup();
});
