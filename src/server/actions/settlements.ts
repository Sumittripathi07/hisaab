"use server";

import { z } from "zod";
import { settlementInputSchema, settlementUpdateSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { revalidateGroup } from "@/server/revalidate";
import { deleteSettlement, disputeSettlement, recordSettlement, restoreSettlement, updateSettlement } from "@/server/settlements";

const settlementIdSchema = z.object({ settlementId: z.string().min(1) });

export const recordSettlementAction = defineAction(settlementInputSchema, async (input, user) => {
  const created = await recordSettlement(user.id, input);
  revalidateGroup();
  return created;
});

export const updateSettlementAction = defineAction(settlementUpdateSchema, async ({ settlementId, ...fields }, user) => {
  await updateSettlement(user.id, settlementId, fields);
  revalidateGroup();
});

export const deleteSettlementAction = defineAction(settlementIdSchema, async ({ settlementId }, user) => {
  await deleteSettlement(user.id, settlementId);
  revalidateGroup();
});

export const restoreSettlementAction = defineAction(settlementIdSchema, async ({ settlementId }, user) => {
  await restoreSettlement(user.id, settlementId);
  revalidateGroup();
});

export const disputeSettlementAction = defineAction(settlementIdSchema, async ({ settlementId }, user) => {
  await disputeSettlement(user.id, settlementId);
  revalidateGroup();
});
