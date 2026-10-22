import { db } from "@/lib/db";
import type { ProfileInput } from "@/lib/validation";

/**
 * Saves the profile, and the name on every group membership too, in one transaction: groups show a member's
 * displayName, and the account page promises friends see the new name there.
 */
function saveProfile(userId: string, data: ProfileInput & { onboardedAt?: Date }) {
  return db.$transaction([
    db.user.update({ where: { id: userId }, data }),
    db.groupMember.updateMany({ where: { userId }, data: { displayName: data.name } }),
  ]);
}

export async function completeOnboarding(userId: string, input: ProfileInput): Promise<void> {
  await saveProfile(userId, { ...input, onboardedAt: new Date() });
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<void> {
  await saveProfile(userId, input);
}
