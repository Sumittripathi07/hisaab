"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreateGroupButton } from "@/components/create-group-sheet";
import { UserAvatar } from "@/components/user-avatar";
import { isCurrent, NAV_ITEMS } from "./nav-items";

const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** From 768px up: brand, "New group", the sections, and who's signed in. */
export function Sidebar({ user }: { user: { name: string; email: string; image: string | null } }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar p-3 text-sidebar-foreground md:flex">
      <Link href="/dashboard" className={`w-fit rounded-lg px-3 py-2 text-xl font-semibold tracking-tight ${focusRing}`}>
        Hisaab<span className="text-primary">.</span>
      </Link>
      <CreateGroupButton className="mt-4 h-10 rounded-xl text-sm shadow-sm shadow-primary/20">
        <Plus aria-hidden />
        New group
      </CreateGroupButton>
      <nav aria-label="Main" className="mt-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent(pathname, href) ? "page" : undefined}
                className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary motion-reduce:transition-none ${focusRing}`}
              >
                <Icon className="size-4.5" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Link
        href="/account"
        className={`mt-auto flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-sidebar-accent motion-reduce:transition-none ${focusRing}`}
      >
        <UserAvatar name={user.name} image={user.image} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
      </Link>
    </aside>
  );
}
