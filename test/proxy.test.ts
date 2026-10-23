// Next's matcher helper reads AsyncLocalStorage from globalThis at import, as Next's own server sets it up.
import "next/dist/server/node-environment-baseline";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

const env = vi.hoisted(() => ({ PROXY_SECRET: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env }));

const SECRET = "f".repeat(64);
const SESSION = "better-auth.session_token=abc.def";

const call = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
/** What the app itself receives as a request header after the proxy, or null when the proxy dropped it. */
const forwarded = (res: Response, name: string) =>
  res.headers.get("x-middleware-override-headers")?.split(",").includes(name) ? res.headers.get(`x-middleware-request-${name}`) : null;
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  env.PROXY_SECRET = undefined;
});

describe("proxy gate", () => {
  it.each([undefined, ""])("is off when PROXY_SECRET is %j", async (secret) => {
    env.PROXY_SECRET = secret;
    expect(passedThrough(call("/api/health"))).toBe(true);
    expect(passedThrough(call("/sign-in", { "x-hisaab-proxy-secret": "anything" }))).toBe(true);
  });

  describe("with PROXY_SECRET set", () => {
    beforeEach(() => {
      env.PROXY_SECRET = SECRET;
    });

    it.each(["/api/health", "/api/auth/sign-in/magic-link", "/api/auth/callback/google", "/sign-in", "/", "/dashboard", "/groups/g1"])(
      "refuses %s without the header",
      async (path) => {
        const res = call(path, { cookie: SESSION });
        expect(res.status).toBe(403);
        expect(await res.text()).toBe("Forbidden");
        expect(passedThrough(res)).toBe(false);
      },
    );

    it.each(["wrong", SECRET.slice(1), `${SECRET}x`, SECRET.toUpperCase(), ""])("refuses a wrong secret (%#)", (secret) => {
      expect(call("/api/health", { "x-hisaab-proxy-secret": secret }).status).toBe(403);
    });

    it("lets the right secret through, and keeps it from the app", () => {
      const res = call("/api/auth/get-session", { "x-hisaab-proxy-secret": SECRET, "x-forwarded-for": "203.0.113.7" });
      expect(passedThrough(res)).toBe(true);
      expect(forwarded(res, "x-hisaab-proxy-secret")).toBeNull();
      expect(forwarded(res, "x-forwarded-for")).toBe("203.0.113.7");
    });

    it("still sends a signed-out visitor to sign-in once the secret checks out", () => {
      const res = call("/join/abc?ref=wa", { "x-hisaab-proxy-secret": SECRET });
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(
        "/sign-in?callbackURL=%2Fjoin%2Fabc%3Fref%3Dwa",
      );
    });
  });
});

describe("signed-out redirect and forwarded path (unchanged)", () => {
  it("sends a signed-out visitor to sign-in, remembering the full path", () => {
    const res = call("/join/abc?ref=wa");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/sign-in?callbackURL=%2Fjoin%2Fabc%3Fref%3Dwa");
  });

  it("forwards the path to a signed-in visitor, overwriting a client-sent one", () => {
    const res = call("/groups/g1?tab=balances", { cookie: SESSION, "x-hisaab-path": "//evil.example" });
    expect(passedThrough(res)).toBe(true);
    expect(forwarded(res, "x-hisaab-path")).toBe("/groups/g1?tab=balances");
  });

  it.each(["/sign-in", "/api/auth/ok", "/activity", "/"])("leaves %s alone for a signed-out visitor", (path) => {
    const res = call(path, { "x-hisaab-path": "/kept" });
    expect(passedThrough(res)).toBe(true);
    expect(forwarded(res, "x-hisaab-path")).toBe("/kept");
  });

  // The paths the proxy matched before it also gated every route: the redirect must cover exactly those.
  const before = ["/dashboard/:path*", "/groups/:path*", "/account/:path*", "/onboarding", "/join/:path*", "/claim/:path*"];
  it.each([
    "/dashboard", "/dashboard/x/y", "/dashboardx", "/groups", "/groups/g1/expenses/e1", "/account", "/onboarding",
    "/onboarding/x", "/onboardingx", "/join", "/join/abc", "/claim/t", "/activity", "/sign-in", "/", "/DASHBOARD",
  ])("redirects %s exactly when the old matcher would have", (path) => {
    const oldMatch = unstable_doesMiddlewareMatch({ config: { matcher: before }, url: path });
    expect(call(path).status === 307).toBe(oldMatch);
  });

  // Next's router (not its test helper) also tries the decoded path against the matcher.
  it("treats a percent-encoded app path as the app path, as Next's router did", () => {
    expect(call("/%64ashboard").status).toBe(307);
  });
});

describe("matcher", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each(["/", "/sign-in", "/dashboard", "/api/health", "/api/auth/ok", "/api/auth/callback/google", "/api/auth/sign-in/magic-link", "/x.png", "/_next/image", "/_next/image?url=%2Fa.png&w=64&q=75", "/_next/staticx"])(
    "runs on %s",
    (url) => expect(runs(url)).toBe(true),
  );

  it.each(["/_next/static/chunks/app.js", "/_next/static/media/font.woff2", "/favicon.ico"])("skips %s", (url) =>
    expect(runs(url)).toBe(false),
  );
});
