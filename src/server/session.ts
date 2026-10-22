import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { RETURN_TO_HEADER, safeCallback } from "@/lib/safe-redirect";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  defaultCurrency: string;
  upiId: string | null;
  timezone: string;
  onboardedAt: Date | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    defaultCurrency: user.defaultCurrency ?? "INR", // Better Auth types additional fields as optional; the columns are NOT NULL with these defaults
    upiId: user.upiId ?? null,
    timezone: user.timezone ?? "Asia/Kolkata",
    onboardedAt: user.onboardedAt ?? null,
  };
}

/** Where to come back to: `returnTo` if given, else the path the proxy forwarded. Only ever a same-site path, or null. */
async function returnPath(returnTo?: string): Promise<string | null> {
  const path = returnTo ?? (await headers()).get(RETURN_TO_HEADER);
  return safeCallback(path, "") || null;
}

const withCallback = (page: string, path: string | null) => (path ? `${page}?callbackURL=${encodeURIComponent(path)}` : page);

/** The signed-in person, or a redirect to sign-in that comes back to `returnTo` (default: the current page). */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(withCallback("/sign-in", await returnPath(returnTo)));
  return user;
}

/** Like requireUser, but sends people who haven't finished onboarding there first, remembering where they were going. */
export async function requireOnboardedUser(returnTo?: string): Promise<SessionUser> {
  const path = await returnPath(returnTo);
  const user = await requireUser(path ?? undefined);
  if (!user.onboardedAt) redirect(withCallback("/onboarding", path));
  return user;
}

/**
 * The person's unexpired sessions (their signed-in devices), most recently active first. The same rows
 * auth.api.listSessions returns, minus its rule that the caller signed in within the last day, which would
 * hide the list from almost everyone on 30-day sessions.
 */
export function listActiveSessions(userId: string) {
  return db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, userAgent: true, updatedAt: true },
  });
}
