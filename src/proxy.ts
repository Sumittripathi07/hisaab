import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Signed-out visitors to a protected page go to sign-in, remembering the full path (an invite link survives this way:
 * requireUser() alone would drop it). Only checks that a session cookie exists; pages still verify the session.
 */
export function proxy(request: NextRequest) {
  // Finds both the plain and the __Secure- (https) cookie name.
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackURL", pathname + search);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/dashboard/:path*", "/groups/:path*", "/account/:path*", "/onboarding", "/join/:path*", "/claim/:path*"],
};
