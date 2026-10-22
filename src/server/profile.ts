import { db } from "@/lib/db";
import type { ProfileInput } from "@/lib/validation";

export async function completeOnboarding(userId: string, input: ProfileInput): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { ...input, onboardedAt: new Date() } });
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<void> {
  await db.user.update({ where: { id: userId }, data: input });
}
