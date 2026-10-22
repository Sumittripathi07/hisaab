import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { GROUP_TYPES, groupTint, type GroupType } from "@/lib/group-meta";
import { cn } from "@/lib/utils";
import type { GroupListItem } from "@/server/groups";

const members = (n: number) => (n === 1 ? "1 member" : `${n} members`);

export function GroupCard({ group }: { group: GroupListItem }) {
  const extra = group.memberCount - group.previewMembers.length;
  return (
    <Link
      href={`/groups/${group.id}`}
      className="flex h-full flex-col gap-4 rounded-2xl border bg-card p-4 text-card-foreground shadow-xs outline-none transition-[translate,scale,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl", groupTint(group.color).tile)}
        >
          {group.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold" title={group.name}>
            {group.name}
          </p>
          <p className="text-sm text-muted-foreground">{members(group.memberCount)}</p>
        </div>
        {/* DIRECT groups (Phase 4) never reach these lists. */}
        <Badge variant="secondary">{GROUP_TYPES[group.type as GroupType]?.label}</Badge>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex -space-x-1.5" aria-hidden>
          {group.previewMembers.map((m, i) => (
            <UserAvatar key={i} name={m.displayName} image={m.image} size="sm" className="ring-2 ring-card" />
          ))}
          {extra > 0 && (
            <span className="relative flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-card">
              +{extra}
            </span>
          )}
        </div>
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">{group.baseCurrency}</span>
      </div>
    </Link>
  );
}

/**
 * One column on a phone, up to three as the content area widens (it narrows beside the sidebar, hence a container query).
 * grid-cols-1 rather than the implicit column, which would stretch to fit a long name instead of truncating it.
 */
export function GroupGrid({ groups }: { groups: GroupListItem[] }) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
        {groups.map((group) => (
          <li key={group.id}>
            <GroupCard group={group} />
          </li>
        ))}
      </ul>
    </div>
  );
}
