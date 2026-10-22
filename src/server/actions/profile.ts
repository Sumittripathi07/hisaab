"use server";

import { revalidatePath } from "next/cache";
import { profileSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { completeOnboarding, updateProfile } from "@/server/profile";

export const completeOnboardingAction = defineAction(profileSchema, async (input, user) => {
  await completeOnboarding(user.id, input);
  revalidatePath("/", "layout");
});

export const updateProfileAction = defineAction(profileSchema, async (input, user) => {
  await updateProfile(user.id, input);
  revalidatePath("/", "layout");
});
