import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { RETURN_TO_HEADER } from "@/lib/safe-redirect";

/**
 * Signed-out visitors to a protected page go to sign-in, remembering the full path, so an invite link survives sign-in.
 * This only checks that a session cookie exists. For a stale or revoked cookie, the page's requireUser() catches it,
 * and the path forwarded in RETURN_TO_HEADER lets it keep the callback too.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Finds both the plain and the __Secure- (https) cookie name.
  if (!getSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("callbackURL", pathname + search);
    return NextResponse.redirect(signIn);
  }
  const headers = new Headers(request.headers);
  headers.set(RETURN_TO_HEADER, pathname + search); // set, not append: overwrites anything the client sent
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/groups/:path*", "/account/:path*", "/onboarding", "/join/:path*", "/claim/:path*"],
};
