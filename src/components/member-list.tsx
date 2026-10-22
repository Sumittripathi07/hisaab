"use client";

import { Crown, Link2, LoaderCircle, MoreHorizontal, RefreshCw, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/group-actions";
import { copyLink } from "@/components/invite-sheet";
import { NETWORK_ERROR } from "@/components/profile-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import type { ActionResult } from "@/server/action";
import type { getGroupDetail } from "@/server/groups";
import {
  regenerateClaimTokenAction,
  removeMemberAction,
  setMemberRoleAction,
  transferOwnershipAction,
} from "@/server/actions/members";

/** A member as the group page loads it, plus the link a placeholder claims their spot with. */
export type Member = Awaited<ReturnType<typeof getGroupDetail>>["members"][number] & { claimUrl: string | null };
type Role = Member["role"];

type Props = {
  groupId: string;
  members: Member[];
  me: { id: string; role: Role };
  /** Nothing can change in an archived group, so it offers nothing to do. */
  archived: boolean;
  /** Settings: a menu on each row with whatever the viewer may do to that person. */
  manage?: boolean;
};

type Confirm = { kind: "remove" | "transfer"; member: Member };

/** Who's in the group: owner, admins, then everyone else, with people who haven't joined yet marked. */
export function MemberList({ groupId, members, me, archived, manage = false }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  // Kept after closing, so the dialog's words don't change while it animates away.
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const removed = useRef(false);

  /** What the viewer may do to `m`, mirroring the server's rules (which still decide). */
  function allowed(m: Member) {
    const isOwner = me.role === "OWNER";
    const joinedOther = !m.isPlaceholder && m.role !== "OWNER";
    return {
      copy: !!m.claimUrl,
      newLink: m.isPlaceholder,
      role: isOwner && joinedOther,
      transfer: isOwner && joinedOther,
      // Admins can remove members; only the owner can remove an admin. Nobody removes the owner or themselves here.
      remove: m.id !== me.id && m.role !== "OWNER" && (m.role === "MEMBER" || isOwner),
    };
  }

  /** Runs a menu action with a spinner on that row's button (not disabled, which would drop its focus), then says how it went. */
  async function run<T>(m: Member, action: () => Promise<ActionResult<T>>, done?: string) {
    setBusy(m.id);
    const result = await action().catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setBusy(null);
    if (!result.ok) toast.error(result.error);
    else if (done) toast.success(done);
    return result;
  }

  async function newLink(m: Member) {
    const result = await run(m, () => regenerateClaimTokenAction({ groupId, memberId: m.id }));
    if (!result.ok) return;
    const url = new URL(`/claim/${result.data}`, location.origin).href;
    // Copying needs a fresh tap (the wait for the server can use up the menu click's), hence the toast's button.
    toast.success(`New invite link for ${m.displayName}`, {
      description: "The old link no longer works.",
      action: { label: "Copy", onClick: () => copyLink(url) },
    });
  }

  function ask(kind: Confirm["kind"], member: Member) {
    setConfirm({ kind, member });
    setConfirmOpen(true);
  }

  const target = confirm?.member;

  return (
    <>
      <ul ref={listRef} tabIndex={-1} aria-label="Members" className="divide-y rounded-2xl border bg-card outline-none">
        {members.map((m) => {
          const isMe = m.id === me.id;
          const can = allowed(m);
          const hasMenu = manage && !archived && Object.values(can).some(Boolean);
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar name={m.displayName} image={m.image} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-1.5">
                  <span id={`member-${m.id}`} className="truncate font-medium">
                    {m.displayName}
                  </span>
                  {isMe && <span className="shrink-0 text-sm text-muted-foreground">(you)</span>}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  {m.role === "OWNER" && <Badge className="bg-primary/10 text-primary">Owner</Badge>}
                  {m.role === "ADMIN" && <Badge variant="secondary">Admin</Badge>}
                  {m.isPlaceholder && (
                    <Badge variant="outline" className="border-dashed text-muted-foreground">
                      Not joined yet
                    </Badge>
                  )}
                  {m.isPlaceholder && m.email && <span className="min-w-0 truncate text-xs text-muted-foreground">{m.email}</span>}
                </div>
              </div>
              {!manage && !archived && m.claimUrl && (
                <Button
                  variant="outline"
                  className="h-9 shrink-0 rounded-lg px-2.5"
                  onClick={() => copyLink(m.claimUrl!)}
                  aria-describedby={`member-${m.id}`}
                >
                  <Link2 aria-hidden />
                  <span className="sr-only sm:not-sr-only">Copy invite link</span>
                </Button>
              )}
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    ref={(el: HTMLButtonElement | null) => {
                      if (el) triggers.current.set(m.id, el);
                      else triggers.current.delete(m.id);
                    }}
                    aria-busy={busy === m.id}
                    render={<Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-full" />}
                    aria-label={`Actions for ${m.displayName}`}
                  >
                    {busy === m.id ? <LoaderCircle className="animate-spin" aria-hidden /> : <MoreHorizontal className="size-5" aria-hidden />}
                  </DropdownMenuTrigger>
                  {/* Roomier rows than the default: these are tapped on phones. */}
                  <DropdownMenuContent align="end" className="w-auto min-w-52 *:data-[slot=dropdown-menu-item]:py-2">
                    {can.copy && (
                      <DropdownMenuItem onClick={() => copyLink(m.claimUrl!)}>
                        <Link2 aria-hidden />
                        Copy invite link
                      </DropdownMenuItem>
                    )}
                    {can.newLink && (
                      <DropdownMenuItem onClick={() => newLink(m)}>
                        <RefreshCw aria-hidden />
                        New claim link
                      </DropdownMenuItem>
                    )}
                    {can.role &&
                      (m.role === "ADMIN" ? (
                        <DropdownMenuItem
                          onClick={() =>
                            run(m, () => setMemberRoleAction({ groupId, memberId: m.id, role: "MEMBER" }), `${m.displayName} is no longer an admin`)
                          }
                        >
                          <ShieldOff aria-hidden />
                          Remove admin
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => run(m, () => setMemberRoleAction({ groupId, memberId: m.id, role: "ADMIN" }), `${m.displayName} is now an admin`)}
                        >
                          <ShieldCheck aria-hidden />
                          Make admin
                        </DropdownMenuItem>
                      ))}
                    {can.transfer && (
                      <DropdownMenuItem onClick={() => ask("transfer", m)}>
                        <Crown aria-hidden />
                        Transfer ownership
                      </DropdownMenuItem>
                    )}
                    {can.remove && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => ask("remove", m)}>
                          <UserMinus aria-hidden />
                          Remove from group
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>

      {/* One dialog for the list, so it outlives the row it removes. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirm?.kind === "transfer" ? `Make ${target?.displayName} the owner?` : `Remove ${target?.displayName}?`}
        description={
          confirm?.kind === "transfer"
            ? "You'll become an admin. Only the owner can change roles, remove admins and hand the group over."
            : target?.isPlaceholder
              ? "Their invite link will stop working."
              : "They'll lose access to the group. They can come back if someone shares the invite link with them."
        }
        confirmLabel={confirm?.kind === "transfer" ? "Make owner" : "Remove"}
        destructive={confirm?.kind !== "transfer"}
        onConfirm={async () => {
          if (!target) return { ok: true, data: null };
          removed.current = false;
          const transfer = confirm?.kind === "transfer";
          const result = await (transfer
            ? transferOwnershipAction({ groupId, memberId: target.id })
            : removeMemberAction({ groupId, memberId: target.id }));
          if (result.ok) {
            removed.current = !transfer;
            toast.success(transfer ? `${target.displayName} is now the owner` : `${target.displayName} was removed`);
          }
          return result;
        }}
        // Back to the row's menu button, unless the row (or its menu) is gone: then the list, where Base UI focuses the
        // first button in it (the next person's menu), or the list itself if there's none.
        finalFocus={() => {
          const trigger = target && triggers.current.get(target.id);
          return !removed.current && trigger?.isConnected ? trigger : listRef.current;
        }}
      />
    </>
  );
}
