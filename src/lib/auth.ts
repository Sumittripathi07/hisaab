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

// Cloudflare's published ranges, https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6, fetched
// 2026-10-23. Workers' outbound requests leave from these. Update when Cloudflare announces a change.
const CLOUDFLARE_IPS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];
// Google's documented load balancer / health check ranges.
const GOOGLE_LB_IPS = ["130.211.0.0/22", "35.191.0.0/16"];

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
    // The path in production: browser → Cloudflare Worker (infra/cloudflare-worker) → Cloud Run. The Worker drops any
    // client-sent X-Forwarded-For and sets it to CF-Connecting-IP, the address Cloudflare saw. Google's front end then
    // appends the address the request reached it from, the Worker's Cloudflare egress IP, so the app sees
    // "client, cloudflare-egress": walking from the right skips Cloudflare and lands on the client.
    // That is only sound while the proxy gate is on (PROXY_SECRET, src/proxy.ts), so Cloudflare's ranges are trusted only
    // then. Without the gate, anyone could call run.app from a Worker of their own with a made-up left entry, minting a
    // fresh rate-limit key per request.
    // Gate off, a request through the Worker keys on its Cloudflare egress address instead: coarse, but not forgeable.
    // ASSUMPTION, to verify once the Worker is live (log getIP for a request from a known address): Google's front end
    // appends the connecting address as the right-most entry and adds no hop of its own after it.
    // Revisit if an external HTTPS load balancer is added: it appends its own IP, outside these trusted ranges, so every
    // request would key on the load balancer's address. Keep the list narrow: a broad range that also covers clients
    // would let a spoofed entry through.
    ipAddress: { trustedProxies: env.PROXY_SECRET ? [...CLOUDFLARE_IPS, ...GOOGLE_LB_IPS] : GOOGLE_LB_IPS },
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
