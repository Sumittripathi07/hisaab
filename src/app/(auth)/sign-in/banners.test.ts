import { describe, expect, it } from "vitest";
import { bannerFor, magicLinkFailure } from "./banners";

describe("bannerFor (the ?error= Better Auth sends people back with)", () => {
  it("says nothing without an error", () => expect(bannerFor(undefined)).toBeNull());

  it.each(["INVALID_TOKEN", "EXPIRED_TOKEN"])("asks for a new link after a used or expired one (%s)", (code) =>
    expect(bannerFor(code)).toBe("That sign-in link has expired or was already used. Send yourself a new one below."),
  );

  it.each(["failed_to_create_user", "user_not_found", "failed_to_create_session", "new_user_signup_disabled"])(
    "doesn't blame Google when a good magic link failed on our side (%s)",
    (code) => expect(bannerFor(code)).toBe("Sign-in didn't work. Send yourself a new link below, or continue with Google."),
  );

  it("says Google was cancelled when the person backed out there", () =>
    expect(bannerFor("access_denied")).toBe("Google sign-in was cancelled. Try again, or email yourself a sign-in link below."));

  it.each(["state_not_found", "state_mismatch", "unable_to_link_account", "email_not_found", "internal_server_error", "<b>x</b>"])(
    "gives anything else (%s) one generic Google message, never the code itself",
    (code) => expect(bannerFor(code)).toBe("Google sign-in didn't work. Please try again, or use an email link."),
  );
});

describe("magicLinkFailure", () => {
  it("blames our hourly email limit only when that's what answered", () =>
    expect(magicLinkFailure({ status: 429, code: "EMAIL_RATE_LIMITED" })).toBe(
      "Too many links requested. Try again in an hour, or continue with Google.",
    ));

  it("asks for a minute's wait when Better Auth's per-IP limiter answered", () =>
    expect(magicLinkFailure({ status: 429 })).toBe("Too many attempts. Please wait a minute and try again."));

  it("falls back to a generic message", () =>
    expect(magicLinkFailure({ status: 500 })).toBe("Something went wrong. Check your connection and try again."));
});
