"use server";

import { z } from "zod";
import { placeholderSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import {
  addPlaceholder,
  claimPlaceholder,
  claimUrl,
  joinByInviteCode,
  leaveGroup,
  regenerateClaimToken,
  removeMember,
  rotateInviteCode,
  setMemberRole,
  transferOwnership,
} from "@/server/members";
import { revalidateGroup } from "@/server/revalidate";

const id = z.string().min(1);
const groupIdSchema = z.object({ groupId: id });
// Member actions still take the group's id as well as the member's (their callers send both); the service looks the
// group up from the member itself, so a wrong groupId here can't affect who is allowed to do what.
const memberSchema = z.object({ groupId: id, memberId: id });
const addPlaceholderSchema = placeholderSchema.extend(groupIdSchema.shape);
const roleSchema = memberSchema.extend({ role: z.enum(["ADMIN", "MEMBER"]) });

export const addPlaceholderAction = defineAction(addPlaceholderSchema, async ({ groupId, ...input }, user) => {
  try {
    return await addPlaceholder(user.id, groupId, input);
  } finally {
    revalidateGroup(); // also when the invite email failed to send: the person was still added
  }
});

export const joinByInviteCodeAction = defineAction(z.object({ code: id }), async ({ code }, user) => {
  const joined = await joinByInviteCode(user.id, code);
  revalidateGroup();
  return joined;
});

export const rotateInviteCodeAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  const code = await rotateInviteCode(user.id, groupId);
  revalidateGroup();
  return code;
});

export const claimPlaceholderAction = defineAction(z.object({ token: id }), async ({ token }, user) => {
  const claimed = await claimPlaceholder(user.id, token);
  revalidateGroup();
  return claimed;
});

/** Returns the new claim link in full, on the app's public origin, like the one in invite emails. */
export const regenerateClaimTokenAction = defineAction(memberSchema, async ({ memberId }, user) => {
  const token = await regenerateClaimToken(user.id, memberId);
  revalidateGroup();
  return claimUrl(token);
});

export const removeMemberAction = defineAction(memberSchema, async ({ memberId }, user) => {
  await removeMember(user.id, memberId);
  revalidateGroup();
});

export const setMemberRoleAction = defineAction(roleSchema, async ({ memberId, role }, user) => {
  await setMemberRole(user.id, memberId, role);
  revalidateGroup();
});

export const transferOwnershipAction = defineAction(memberSchema, async ({ memberId }, user) => {
  await transferOwnership(user.id, memberId);
  revalidateGroup();
});

export const leaveGroupAction = defineAction(groupIdSchema, async ({ groupId }, user) => {
  await leaveGroup(user.id, groupId);
  revalidateGroup();
});
