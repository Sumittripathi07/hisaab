import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDb } from "./db";
import { clearOutbox, lastEmailTo, readOutbox } from "./outbox";

beforeEach(async () => {
  await resetDb();
  await clearOutbox();
});

/** Asks for a magic link and returns the verify URL from the email that was "sent". */
async function requestLink(email: string, body: { callbackURL?: string; newUserCallbackURL?: string; errorCallbackURL?: string } = {}) {
  await auth.api.signInMagicLink({ body: { email, callbackURL: "/dashboard", ...body }, headers: new Headers() });
  const m = await lastEmailTo(email);
  expect(m.subject).toBe("Your Hisaab sign-in link");
  return new URL(m.text.match(/https?:\/\/\S+/)![0]);
}

const verify = (link: URL) =>
  auth.api.magicLinkVerify({ query: { token: link.searchParams.get("token")! }, headers: new Headers(), asResponse: true });

describe("magic link", () => {
  it("emails a magic link that signs a new user in", async () => {
    const link = await requestLink("asha@example.test");
    const res = await verify(link);
    expect(res.headers.get("set-cookie")).toMatch(/session_token/);
    expect(await db.user.count({ where: { email: "asha@example.test" } })).toBe(1);
  });

  it("does not sign in with a used token", async () => {
    const link = await requestLink("asha@example.test");
    expect((await verify(link)).headers.get("set-cookie")).toMatch(/session_token/);

    const again = await verify(link);
    expect(again.headers.get("set-cookie") ?? "").not.toMatch(/session_token/);
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toContain("error=");
    expect(await db.session.count()).toBe(1);
  });

  it("does not sign in with an expired token", async () => {
    const link = await requestLink("asha@example.test");
    await db.verification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(link);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token/);
    expect(res.headers.get("location")).toContain("error=");
    expect(await db.user.count()).toBe(0);
  });

  it("expires after 10 minutes", async () => {
    await requestLink("asha@example.test");
    const { expiresAt } = await db.verification.findFirstOrThrow();
    const seconds = (expiresAt.getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(590);
    expect(seconds).toBeLessThanOrEqual(600);
  });

  it("stores the email lowercased and treats the same address in any case as one user", async () => {
    await verify(await requestLink("Asha@Example.TEST"));
    await verify(await requestLink("asha@example.test"));
    const users = await db.user.findMany();
    expect(users.map((u) => u.email)).toEqual(["asha@example.test"]);
    expect(await db.session.count()).toBe(2);
  });

  it("gives a new user the India-first defaults and no onboarding stamp", async () => {
    await verify(await requestLink("asha@example.test"));
    const user = await db.user.findFirstOrThrow();
    expect(user).toMatchObject({ defaultCurrency: "INR", timezone: "Asia/Kolkata", upiId: null, onboardedAt: null });
  });

  it("carries the new-user, error and callback URLs through the link", async () => {
    const link = await requestLink("asha@example.test", {
      callbackURL: "/join/abc",
      newUserCallbackURL: "/onboarding?callbackURL=%2Fjoin%2Fabc",
      errorCallbackURL: "/sign-in?callbackURL=%2Fjoin%2Fabc",
    });
    expect(link.searchParams.get("callbackURL")).toBe("/join/abc");
    expect(link.searchParams.get("newUserCallbackURL")).toBe("/onboarding?callbackURL=%2Fjoin%2Fabc");
    expect(link.searchParams.get("errorCallbackURL")).toBe("/sign-in?callbackURL=%2Fjoin%2Fabc");
    // A first sign-in lands on onboarding; a returning one lands on the callback.
    const first = await auth.api.magicLinkVerify({ query: Object.fromEntries(link.searchParams) as { token: string }, headers: new Headers(), asResponse: true });
    expect(first.headers.get("location")).toContain("/onboarding");
    const second = await requestLink("asha@example.test", { callbackURL: "/join/abc", newUserCallbackURL: "/onboarding" });
    const returning = await auth.api.magicLinkVerify({ query: Object.fromEntries(second.searchParams) as { token: string }, headers: new Headers(), asResponse: true });
    expect(returning.headers.get("location")).toContain("/join/abc");
  });

  it("answers 429 once the 6th link in an hour is requested for one address", async () => {
    for (let i = 0; i < 5; i++) await requestLink("asha@example.test");
    await expect(
      auth.api.signInMagicLink({ body: { email: "asha@example.test", callbackURL: "/dashboard" }, headers: new Headers() }),
    ).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS", statusCode: 429 });
  });
});

describe("over HTTP (the route handler)", () => {
  const origin = "http://localhost:3000";
  const post = (body: object, headers: Record<string, string> = {}) =>
    auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, ...headers },
        body: JSON.stringify(body),
      }),
    );
  const emailsTo = async (email: string) => (await readOutbox()).filter((m) => m.to === email);

  it("accepts same-site callback URLs, including ones with a query string", async () => {
    const res = await post({
      email: "asha@example.test",
      callbackURL: "/join/abc?x=1",
      newUserCallbackURL: "/onboarding?callbackURL=%2Fjoin%2Fabc%3Fx%3D1",
      errorCallbackURL: "/sign-in?callbackURL=%2Fjoin%2Fabc%3Fx%3D1",
    });
    expect(res.status).toBe(200);
    expect(await emailsTo("asha@example.test")).toHaveLength(1);
  });

  it.each(["https://evil.com/steal", "//evil.com", "/\\evil.com"])("refuses %s as a callback URL and sends nothing", async (callbackURL) => {
    expect((await post({ email: "asha@example.test", callbackURL })).status).toBe(403);
    expect((await post({ email: "asha@example.test", callbackURL: "/dashboard", newUserCallbackURL: callbackURL })).status).toBe(403);
    expect((await post({ email: "asha@example.test", callbackURL: "/dashboard", errorCallbackURL: callbackURL })).status).toBe(403);
    expect(await emailsTo("asha@example.test")).toHaveLength(0);
  });

  it("refuses a request from another origin", async () => {
    expect((await post({ email: "asha@example.test", callbackURL: "/dashboard" }, { origin: "https://evil.com" })).status).toBe(403);
    expect(await emailsTo("asha@example.test")).toHaveLength(0);
  });

  it("will not redirect a verify link to another site, and leaves the token unused", async () => {
    const link = await requestLink("asha@example.test");
    link.searchParams.set("callbackURL", "https://evil.com");
    const res = await auth.handler(new Request(link, { headers: { origin } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token/);
    link.searchParams.set("callbackURL", "/dashboard");
    expect((await auth.handler(new Request(link))).headers.get("set-cookie")).toMatch(/session_token/);
  });

  it("answers 429 over HTTP once the email limit is hit", async () => {
    for (let i = 0; i < 5; i++) await requestLink("asha@example.test");
    const res = await post({ email: "asha@example.test", callbackURL: "/dashboard" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "EMAIL_RATE_LIMITED" });
  });

  it("has no /update-user, so a signed-in person can't set a name or image that skips our validation", async () => {
    const signedIn = await verify(await requestLink("asha@example.test"));
    const cookie = signedIn.headers.get("set-cookie")!.match(/better-auth\.session_token=[^;]+/)![0];
    const headers = { "content-type": "application/json", origin, cookie };
    // The cookie is a live session, so a refusal below is the closed path, not a missing sign-in.
    const session = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers }));
    expect(await session.json()).toMatchObject({ user: { email: "asha@example.test" } });

    for (const path of ["/api/auth/update-user", "/api/auth/update-user/"]) {
      const res = await auth.handler(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "x".repeat(500), image: "https://tracker.example/pixel.gif" }),
        }),
      );
      expect(res.status).toBe(404);
    }
    expect(await db.user.findFirstOrThrow({ where: { email: "asha@example.test" } })).toMatchObject({ name: "", image: null });
  });
});

describe("Google sign-in failures", () => {
  const origin = "http://localhost:3000";

  it("sends a callback it can't match to a sign-in attempt back to /sign-in, not Better Auth's error page", async () => {
    const res = await auth.handler(new Request(`${origin}/api/auth/callback/google?state=forged&code=x`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/sign-in\?error=state/);
  });

  it("forwards Better Auth's own error page to /sign-in", async () => {
    const res = await auth.handler(new Request(`${origin}/api/auth/error?error=access_denied`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in?error=access_denied");
  });
});
