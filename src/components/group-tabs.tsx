import Link from "next/link";

// Only the built sections; balances and activity join as they arrive.
const TABS = [{ key: "expenses", label: "Expenses" }] as const;

/** The group page's sections, as links to `?tab=` so each has an address of its own. */
export function GroupTabs({ groupId, current }: { groupId: string; current: "expenses" | "balances" | "activity" }) {
  return (
    <nav aria-label="Group sections">
      <ul className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit">
        {TABS.map(({ key, label }) => (
          <li key={key} className="flex flex-1">
            <Link
              href={`/groups/${groupId}?tab=${key}`}
              aria-current={current === key ? "page" : undefined}
              className="flex h-10 flex-1 items-center justify-center rounded-lg px-5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm motion-reduce:transition-none dark:aria-[current=page]:bg-input/40"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
