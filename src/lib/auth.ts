import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { magicLinkEmail } from "@/emails/magic-link";
import { db } from "@/lib/db";
import { EmailRateLimitError, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { signUpName } from "@/lib/validation";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  user: {
    // `input: false` keeps clients from setting these when they sign up; our own code writes them.
    additionalFields: {
      defaultCurrency: { type: "string", required: false, defaultValue: "INR", input: false },
      upiId: { type: "string", required: false, input: false },
      timezone: { type: "string", required: false, defaultValue: "Asia/Kolkata", input: false },
      onboardedAt: { type: "date", required: false, input: false },
    },
  },
  // Better Auth's built-in profile endpoint takes any name and any image URL (its body is an open record), which would
  // skip displayNameSchema and reach co-members' screens and invite emails. After sign-up, profiles change only through
  // our actions. Sign-up itself sets the name (the magic-link body's `name`, or Google's profile); the hook below checks it.
  disabledPaths: ["/update-user"],
  // Better Auth writes a name only when it creates the user: we leave Google's overrideUserInfoOnSignIn and
  // accountLinking.updateUserInfoOnLink off, so a later sign-in never replaces it.
  databaseHooks: {
    user: { create: { before: async (user) => ({ data: { ...user, name: signUpName(user.name) } }) } },
  },
  // OAuth failures that happen before Better Auth knows the sign-in's own error URL (a lost or forged state) go to
  // sign-in, which shows a friendly banner, instead of Better Auth's raw error page.
  onAPIError: { errorURL: "/sign-in" },
  advanced: {
    // Better Auth skips the origin and callback-URL checks whenever NODE_ENV is "test". Keep them on everywhere.
    disableOriginCheck: false,
    // Per-IP rate limiting and session IP tracking. With no trustedProxies, Better Auth refuses any multi-value
    // X-Forwarded-For and every request lands in one shared "no-trusted-ip" bucket. With them, it walks the header from
    // the right, skips these hops, and takes the first other address. Never the left-most, which clients can spoof.
    // ASSUMPTION, to verify after the first deploy (log getIP for a request from a known address): on run.app, Google's
    // front end appends the real client IP as the right-most entry and adds no hop of its own after it.
    // Revisit if an external HTTPS load balancer is added: it appends its own IP, outside these trusted ranges, so every
    // request would key on the load balancer's address. These are Google's documented load balancer / health check
    // ranges. Keep them narrow: a broad range that also covers clients would let a spoofed entry through.
    ipAddress: { trustedProxies: ["130.211.0.0/22", "35.191.0.0/16"] },
  },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database" },
  // The same email via magic link and via Google is one user.
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      async sendMagicLink({ email, url }) {
        try {
          await sendEmail({ to: email, kind: "magic_link", ...magicLinkEmail(url) });
        } catch (error) {
          // Surface the email rate limit as a 429 so the sign-in page can say so.
          if (error instanceof EmailRateLimitError) {
            throw APIError.fromStatus("TOO_MANY_REQUESTS", {
              message: "Too many sign-in links requested. Try again in an hour.",
              code: "EMAIL_RATE_LIMITED",
            });
          }
          throw error;
        }
      },
    }),
    nextCookies(), // must stay last
  ],
});
