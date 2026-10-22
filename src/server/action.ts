import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, NotFoundError, UserError } from "@/server/errors";
import { requireUser, type SessionUser } from "@/server/session";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Wraps a server action: signs the caller in, validates `input` against `schema`, runs `handler`,
 * and turns thrown errors into `{ ok: false, error }` so the client never sees a stack trace.
 */
export function defineAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (input) => {
    try {
      const user = await requireUser();
      const parsed: z.output<S> = await schema.parseAsync(input);
      return { ok: true, data: await handler(parsed, user) };
    } catch (error) {
      unstable_rethrow(error); // redirect() and notFound() are thrown errors that Next must see
      if (error instanceof z.ZodError) return { ok: false, error: error.issues[0].message };
      if (error instanceof UserError || error instanceof NotFoundError) return { ok: false, error: error.message };
      if (error instanceof ForbiddenError) return { ok: false, error: "You don't have access to this group." };
      console.error(error);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
