import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listActiveSessions, requireOnboardedUser, requireUser } from "@/server/session";
import { resetDb } from "./db";
import { createUser } from "./factories";

// The request: the path the proxy forwarded, and who Better Auth says is signed in.
const request = vi.hoisted(() => ({ path: null as string | null, user: null as Record<string, unknown> | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(request.path ? { "x-hisaab-path": request.path } : {}) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => (request.user ? { user: request.user } : null) } } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

beforeEach(() => {
  request.path = null;
  request.user = null;
});

describe("requireUser", () => {
  it("sends a signed-out person to sign-in, remembering the path the proxy saw", async () => {
    request.path = "/join/abc?ref=wa";
    await expect(requireUser()).rejects.toThrow("redirect /sign-in?callbackURL=%2Fjoin%2Fabc%3Fref%3Dwa");
  });

  it("prefers an explicit returnTo over the forwarded path", async () => {
    request.path = "/dashboard";
    await expect(requireUser("/claim/xyz")).rejects.toThrow("redirect /sign-in?callbackURL=%2Fclaim%2Fxyz");
  });

  it("drops a forwarded path that isn't a same-site path", async () => {
    request.path = "//evil.example/steal";
    await expect(requireUser()).rejects.toThrow(/^redirect \/sign-in$/);
    request.path = null;
    await expect(requireUser()).rejects.toThrow(/^redirect \/sign-in$/);
  });

  it("returns the signed-in person", async () => {
    request.user = { id: "u1", name: "Asha", email: "asha@example.test", onboardedAt: null };
    await expect(requireUser()).resolves.toMatchObject({ id: "u1", onboardedAt: null });
  });
});

describe("requireOnboardedUser", () => {
  it("sends a signed-out person to sign-in with the forwarded path", async () => {
    request.path = "/account";
    await expect(requireOnboardedUser()).rejects.toThrow("redirect /sign-in?callbackURL=%2Faccount");
  });

  it("sends someone mid-onboarding to onboarding with the forwarded path", async () => {
    request.path = "/dashboard?new=1";
    request.user = { id: "u1", name: "", email: "asha@example.test", onboardedAt: null };
    await expect(requireOnboardedUser()).rejects.toThrow("redirect /onboarding?callbackURL=%2Fdashboard%3Fnew%3D1");
  });

  it("lets an onboarded person through", async () => {
    request.path = "/account";
    request.user = { id: "u1", name: "Asha", email: "asha@example.test", onboardedAt: new Date() };
    await expect(requireOnboardedUser()).resolves.toMatchObject({ id: "u1" });
  });
});

describe("listActiveSessions", () => {
  beforeEach(resetDb);

  const session = (userId: string, id: string, expiresInMs: number, updatedAt: string) =>
    db.session.create({
      data: { id, userId, token: `token-${id}`, expiresAt: new Date(Date.now() + expiresInMs), updatedAt: new Date(updatedAt) },
    });

  it("lists the person's unexpired sessions, most recently active first, however old they are", async () => {
    const [me, other] = [await createUser(), await createUser()];
    await session(me.id, "old-phone", 60_000, "2026-01-01T00:00:00Z");
    await session(me.id, "laptop", 60_000, "2026-03-01T00:00:00Z");
    await session(me.id, "expired", -60_000, "2026-04-01T00:00:00Z");
    await session(other.id, "someone-else", 60_000, "2026-04-01T00:00:00Z");

    expect((await listActiveSessions(me.id)).map((s) => s.id)).toEqual(["laptop", "old-phone"]);
  });
});
