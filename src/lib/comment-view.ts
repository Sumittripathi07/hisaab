import { formatAgo } from "@/lib/dates";
import type { CommentItem } from "@/server/comments";

/** A comment as the thread shows it: plain text only, so a client component can take it (no Date, no clock). */
export type CommentView = {
  id: string;
  body: string;
  when: string;
  /** "You" for the viewer's own. */
  name: string;
  /** For the avatar: the viewer's real name, so their colour doesn't change with who is looking. */
  avatarName: string;
  image: string | null;
  canDelete: boolean;
};

export function commentViews(items: CommentItem[], viewerMemberId: string, now = new Date()): CommentView[] {
  return items.map((c) => ({
    id: c.id,
    body: c.body,
    when: formatAgo(c.createdAt, now),
    name: c.author.memberId === viewerMemberId ? "You" : c.author.displayName,
    avatarName: c.author.displayName,
    image: c.author.image,
    canDelete: c.canDelete,
  }));
}
