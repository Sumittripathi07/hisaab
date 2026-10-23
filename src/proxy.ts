import { createHash, timingSafeEqual } from "node:crypto";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { RETURN_TO_HEADER } from "@/lib/safe-redirect";

/** Sent by the Cloudflare Worker (infra/cloudflare-worker) on every request it forwards. */
const PROXY_SECRET_HEADER = "x-hisaab-proxy-secret";

// The pages that need a session: exactly what this proxy's matcher covered before it also gated every route.
const APP_PATH = /^\/(?:(?:dashboard|groups|account|join|claim)(?:\/.*)?|onboarding\/?)$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest();
// Comparing digests keeps the lengths equal, so timingSafeEqual never throws and the secret's length doesn't leak.
const secretMatches = (sent: string | null, secret: string) => sent !== null && timingSafeEqual(sha256(sent), sha256(secret));

/** Next's router tried both the raw and the decoded path against the old matcher; so does this. */
function isAppPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {}
  return APP_PATH.test(pathname) || APP_PATH.test(decoded);
}

/**
 * 1. Proxy gate. With PROXY_SECRET set (production), every request must carry it, which only the Cloudflare Worker
 *    can add: the raw run.app URL answers 403, so nothing reaches the app (or Better Auth) without going through the
 *    Worker, which also sets the client IP rate limits rely on. Unset (local dev, tests, e2e), the gate is off.
 * 2. Signed-out visitors to a protected page go to sign-in, remembering the full path, so an invite link survives
 *    sign-in. This only checks that a session cookie exists. For a stale or revoked cookie, the page's requireUser()
 *    catches it, and the path forwarded in RETURN_TO_HEADER lets it keep the callback too.
 */
export function proxy(request: NextRequest) {
  if (env.PROXY_SECRET && !secretMatches(request.headers.get(PROXY_SECRET_HEADER), env.PROXY_SECRET)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const headers = new Headers(request.headers);
  headers.delete(PROXY_SECRET_HEADER); // the app never needs it, so it can't end up in a log or an error report
  const { pathname, search } = request.nextUrl;
  if (!isAppPath(pathname)) return NextResponse.next({ request: { headers } });
  // Finds both the plain and the __Secure- (https) cookie name.
  if (!getSessionCookie(request)) {
    // Absolute on Next's internal host, but Next turns a same-host Location into a relative one before sending it
    // (router-utils/resolve-routes.js), so behind the Worker the browser stays on the public host.
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("callbackURL", pathname + search);
    return NextResponse.redirect(signIn);
  }
  headers.set(RETURN_TO_HEADER, pathname + search); // set, not append: overwrites anything the client sent
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except build assets and the favicon. The trailing `/` and `$` keep the exclusions exact, so a path that
  // merely starts with one of them is still gated. /_next/image is gated too: the app doesn't use next/image, and the
  // optimiser's own fetch of a local image carries no headers, so it would get a 403 from the gate either way.
  matcher: ["/((?!_next/static/|favicon\\.ico$).*)"],
};
