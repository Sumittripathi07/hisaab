"use server";

import { revalidatePath } from "next/cache";
import { profileSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { completeOnboarding, updateProfile } from "@/server/profile";

// No revalidatePath here: it would re-render /onboarding inside this action's response, and that page redirects
// onboarded people away, which would skip the "You're all set" step. The client navigates on to a fresh page anyway.
export const completeOnboardingAction = defineAction(profileSchema, async (input, user) => {
  await completeOnboarding(user.id, input);
});

export const updateProfileAction = defineAction(profileSchema, async (input, user) => {
  await updateProfile(user.id, input);
  revalidatePath("/", "layout");
});
