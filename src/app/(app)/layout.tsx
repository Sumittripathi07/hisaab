import Link from "next/link";
import { UserAvatar } from "@/components/user-avatar";
import { requireOnboardedUser } from "@/server/session";

// Minimal shell until the real one (bottom nav / sidebar) lands with groups.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/dashboard" className="rounded-md text-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Hisaab<span className="text-primary">.</span>
          </Link>
          <Link href="/account" aria-label="Account" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <UserAvatar name={user.name} image={user.image} size="sm" />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
