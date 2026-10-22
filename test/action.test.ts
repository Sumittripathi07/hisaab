import { notFound, redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { displayNameSchema } from "@/lib/validation";
import { defineAction } from "@/server/action";
import { ConflictError, ForbiddenError, NotFoundError, UserError } from "@/server/errors";
import type { SessionUser } from "@/server/session";

const fakeUser: SessionUser = {
  id: "u1",
  name: "Asha",
  email: "asha@example.test",
  image: null,
  defaultCurrency: "INR",
  upiId: null,
  timezone: "Asia/Kolkata",
  onboardedAt: new Date(),
};

vi.mock("@/server/session", () => ({ requireUser: async () => fakeUser }));

const empty = z.object({});
const run = (handler: () => Promise<unknown>) => defineAction(empty, handler)({});

afterEach(() => vi.restoreAllMocks());

describe("defineAction", () => {
  it("returns data on success", async () => expect(await run(async () => 7)).toEqual({ ok: true, data: 7 }));

  it("passes the parsed input and the signed-in user to the handler", async () => {
    const result = await defineAction(z.object({ name: displayNameSchema }), async (input, user) => `${input.name}/${user.id}`)({
      name: " Priya ",
    });
    expect(result).toEqual({ ok: true, data: "Priya/u1" });
  });

  it("maps UserError to its message", async () =>
    expect(
      await run(async () => {
        throw new UserError("Nope");
      }),
    ).toEqual({ ok: false, error: "Nope" }));

  it("maps ConflictError to its message with a conflict code", async () =>
    expect(
      await run(async () => {
        throw new ConflictError("Ravi edited this just now — reload?");
      }),
    ).toEqual({ ok: false, error: "Ravi edited this just now — reload?", code: "conflict" }));

  it("maps NotFoundError to its message", async () =>
    expect(
      await run(async () => {
        throw new NotFoundError();
      }),
    ).toEqual({ ok: false, error: "Not found." }));

  it("maps ForbiddenError to a generic message", async () =>
    expect(
      await run(async () => {
        throw new ForbiddenError();
      }),
    ).toEqual({ ok: false, error: "You don't have access to this group." }));

  it("returns the first validation issue", async () => {
    const handler = vi.fn(async () => 1);
    const result = await defineAction(z.object({ name: displayNameSchema }), handler)({ name: " " });
    expect(result).toEqual({ ok: false, error: "Enter a name" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("hides unexpected errors and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await run(async () => {
      throw new Error("db password is hunter2");
    });
    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    expect(log).toHaveBeenCalledOnce();
  });

  describe("before onboarding", () => {
    beforeEach(() => void (fakeUser.onboardedAt = null));
    afterEach(() => void (fakeUser.onboardedAt = new Date()));

    it("sends the person to onboarding without running the handler", async () => {
      const handler = vi.fn(async () => 1);
      await expect(defineAction(empty, handler)({})).rejects.toMatchObject({ digest: expect.stringContaining(";/onboarding;") });
      expect(handler).not.toHaveBeenCalled();
    });

    it("runs an action that is part of onboarding", async () =>
      expect(await defineAction(empty, async () => 1, { beforeOnboarding: true })({})).toEqual({ ok: true, data: 1 }));
  });

  it("re-throws redirect and notFound untouched", async () => {
    await expect(run(async () => redirect("/somewhere"))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    await expect(run(async () => notFound())).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK") });
  });
});
