import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ConflictError, ForbiddenError, NotFoundError, UserError } from "@/server/errors";
import { requireUser, type SessionUser } from "@/server/session";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: "conflict" };

/**
 * Wraps a server action: signs the caller in, validates `input` against `schema`, runs `handler`,
 * and turns thrown errors into `{ ok: false, error }` so the client never sees a stack trace.
 *
 * Someone who hasn't finished onboarding is sent there, like every page but onboarding does, unless the action is part
 * of it (`beforeOnboarding`). Until then their name is whatever sign-up gave, maybe blank, and joining a group would
 * copy it onto their membership.
 */
export function defineAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
  { beforeOnboarding = false } = {},
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (input) => {
    try {
      const user = await requireUser();
      if (!user.onboardedAt && !beforeOnboarding) redirect("/onboarding");
      const parsed: z.output<S> = await schema.parseAsync(input);
      return { ok: true, data: await handler(parsed, user) };
    } catch (error) {
      unstable_rethrow(error); // redirect() and notFound() are thrown errors that Next must see
      if (error instanceof z.ZodError) return { ok: false, error: error.issues[0].message };
      if (error instanceof ConflictError) return { ok: false, error: error.message, code: "conflict" };
      if (error instanceof UserError || error instanceof NotFoundError) return { ok: false, error: error.message };
      if (error instanceof ForbiddenError) return { ok: false, error: "You don't have access to this group." };
      console.error(error);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
