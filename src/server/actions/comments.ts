"use server";

import { z } from "zod";
import { commentInputSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { addComment, deleteComment } from "@/server/comments";
import { revalidateGroup } from "@/server/revalidate";

export const addCommentAction = defineAction(commentInputSchema, async ({ target, body }, user) => {
  const created = await addComment(user.id, target, body);
  revalidateGroup();
  return created;
});

export const deleteCommentAction = defineAction(z.object({ commentId: z.string().min(1) }), async ({ commentId }, user) => {
  await deleteComment(user.id, commentId);
  revalidateGroup();
});
