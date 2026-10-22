import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

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

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Like requireUser, but sends people who haven't finished onboarding there first, remembering where they were going. */
export async function requireOnboardedUser(returnTo?: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.onboardedAt) {
    redirect(returnTo ? `/onboarding?callbackURL=${encodeURIComponent(returnTo)}` : "/onboarding");
  }
  return user;
}
