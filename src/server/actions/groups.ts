"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { groupInputSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { archiveGroup, createGroup, unarchiveGroup, updateGroup } from "@/server/groups";

/** Input for actions on an existing group: the group's id, plus the form fields when editing. */
const groupIdSchema = z.object({ groupId: z.string().min(1) });
const updateGroupSchema = groupInputSchema.extend(groupIdSchema.shape);

/** The dashboard lists the group; its own page shows it. */
function refresh(groupId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/groups");
  if (groupId) revalidatePath(`/groups/${groupId}`);
}

export const createGroupAction = defineAction(groupInputSchema, async (input, user) => {
  const group = await createGroup(user.id, input);
  refresh();
  return group;
});

export const updateGroupAction = defineAction(updateGroupSchema, async ({ groupId, ...input }, user) => {
  const group = await updateGroup(user.id, groupId, input);
  refresh(groupId);
  return group;
});

export const archiveGroupAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  await archiveGroup(user.id, groupId);
  refresh(groupId);
});

export const unarchiveGroupAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  await unarchiveGroup(user.id, groupId);
  refresh(groupId);
});
