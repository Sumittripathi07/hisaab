"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, NAV_ITEMS } from "./nav-items";

/** Phones only: the app's sections along the bottom, above the home indicator. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4 px-2">
        {NAV_ITEMS.map(({ href, label, Icon }) => (
          <li key={href} className="flex">
            <Link
              href={href}
              aria-current={isCurrent(pathname, href) ? "page" : undefined}
              className="group flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium text-muted-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-[current=page]:font-semibold aria-[current=page]:text-primary"
            >
              <span className="flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 group-active:bg-muted group-aria-[current=page]:bg-primary/10 motion-reduce:transition-none">
                <Icon className="size-5" strokeWidth={2.25} aria-hidden />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
