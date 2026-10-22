"use server";

import { z } from "zod";
import { groupInputSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { archiveGroup, createGroup, unarchiveGroup, updateGroup } from "@/server/groups";
import { revalidateGroup } from "@/server/revalidate";

/** Input for actions on an existing group: the group's id, plus the form fields when editing. */
const groupIdSchema = z.object({ groupId: z.string().min(1) });
const updateGroupSchema = groupInputSchema.extend(groupIdSchema.shape);

export const createGroupAction = defineAction(groupInputSchema, async (input, user) => {
  const group = await createGroup(user.id, input);
  revalidateGroup();
  return group;
});

export const updateGroupAction = defineAction(updateGroupSchema, async ({ groupId, ...input }, user) => {
  const group = await updateGroup(user.id, groupId, input);
  revalidateGroup();
  return group;
});

export const archiveGroupAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  await archiveGroup(user.id, groupId);
  revalidateGroup();
});

export const unarchiveGroupAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  await unarchiveGroup(user.id, groupId);
  revalidateGroup();
});
