const EXPIRED = "That sign-in link has expired or was already used. Send yourself a new one below.";
const GOOGLE_CANCELLED = "Google sign-in was cancelled. Try again, or email yourself a sign-in link below.";
const GOOGLE_FAILED = "Google sign-in didn't work. Please try again, or use an email link.";
const LINK_FAILED = "Sign-in didn't work. Send yourself a new link below, or continue with Google.";
const EMAIL_LIMITED = "Too many links requested. Try again in an hour, or continue with Google.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a minute and try again.";
export const FAILED = "Something went wrong. Check your connection and try again.";

// What a used or expired magic link comes back with. Every other code is from Google sign-in (the callback, or
// Better Auth's error page via onAPIError.errorURL), except the rare server-side failures of a good magic link.
const MAGIC_LINK_ERRORS = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN"]);
const MAGIC_LINK_FAILURES = new Set(["failed_to_create_user", "user_not_found", "failed_to_create_session", "new_user_signup_disabled"]);

/** The banner for an `error` query param Better Auth sent us back with. Never shows the code itself. */
export function bannerFor(error: string | undefined): string | null {
  if (!error) return null;
  if (MAGIC_LINK_ERRORS.has(error)) return EXPIRED;
  if (MAGIC_LINK_FAILURES.has(error)) return LINK_FAILED;
  return error === "access_denied" ? GOOGLE_CANCELLED : GOOGLE_FAILED;
}

/** Why asking for a magic link failed: our hourly email limit, Better Auth's per-IP limiter, or anything else. */
export function magicLinkFailure(error: { status: number; code?: string }): string {
  if (error.code === "EMAIL_RATE_LIMITED") return EMAIL_LIMITED;
  return error.status === 429 ? TOO_MANY_ATTEMPTS : FAILED;
}
