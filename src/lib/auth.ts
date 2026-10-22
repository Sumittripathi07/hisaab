import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { magicLinkEmail } from "@/emails/magic-link";
import { db } from "@/lib/db";
import { EmailRateLimitError, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

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
  // Better Auth skips the origin and callback-URL checks whenever NODE_ENV is "test". Keep them on everywhere.
  advanced: { disableOriginCheck: false },
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
