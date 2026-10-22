import { revalidatePath } from "next/cache";

/**
 * After a write in a group: the lists that show it, and every page under /groups/[groupId]. Next 16 takes a `type` only
 * with a route pattern, so the pattern (not the group's own path) is what refreshes each group page and its sub-pages.
 */
export function revalidateGroup(): void {
  revalidatePath("/dashboard");
  revalidatePath("/groups");
  revalidatePath("/activity");
  revalidatePath("/groups/[groupId]", "layout");
}
