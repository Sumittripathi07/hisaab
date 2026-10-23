"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { NETWORK_ERROR } from "@/components/profile-fields";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { CommentView } from "@/lib/comment-view";
import type { ActionResult } from "@/server/action";
import { addCommentAction, deleteCommentAction } from "@/server/actions/comments";
import type { CommentTarget } from "@/server/comments";

type Props = {
  /** The group the target is in. The actions find it from the target, so nothing reads this yet. */
  groupId: string;
  target: CommentTarget;
  comments: CommentView[];
  /** False in an archived group, where the thread can be read but not added to. */
  canComment: boolean;
};

const settle = (action: () => Promise<ActionResult<unknown>>) => action().catch(() => ({ ok: false as const, error: NETWORK_ERROR }));

/** The comments on an expense or a payment, oldest first, with a box to add one. */
export function CommentThread({ target, comments, canComment }: Props) {
  const router = useRouter();
  const busy = useRef(false);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  // Pending until the page has the new comment in it, not just until the server has it.
  const [refreshing, refresh] = useTransition();

  async function post() {
    if (busy.current || !body.trim()) return;
    busy.current = true; // a ref, so a double tap in the same moment sees it
    setPosting(true);
    setError(undefined);
    const result = await settle(() => addCommentAction({ target, body }));
    busy.current = false;
    setPosting(false);
    if (!result.ok) return setError(result.error);
    setBody("");
    refresh(() => router.refresh());
  }

  async function remove(commentId: string) {
    const result = await settle(() => deleteCommentAction({ commentId }));
    if (!result.ok) return void toast.error(result.error);
    refresh(() => router.refresh());
  }

  const pending = posting || refreshing;

  return (
    <div className="space-y-4">
      {comments.length > 0 ? (
        <ul aria-label="Comments" className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <UserAvatar name={c.avatarName} image={c.image} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.when}</span>
                </p>
                <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{c.body}</p>
              </div>
              {c.canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1.5 -mr-2 size-11 shrink-0 rounded-xl text-muted-foreground"
                  aria-label="Delete comment"
                  title="Delete comment"
                  onClick={() => void remove(c.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{canComment ? "No comments yet." : "No comments."}</p>
      )}

      {canComment && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
          className="space-y-2"
        >
          <textarea
            aria-label="Add a comment"
            placeholder="Add a comment"
            rows={2}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            // Enter makes a new line; Ctrl or ⌘ with it posts.
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
            className="field-sizing-content min-h-20 w-full resize-none rounded-xl border border-input bg-transparent px-3.5 py-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {/* Always in the page, so screen readers announce what appears in it. */}
          <div role="status" aria-live="polite">
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-xl text-base sm:w-auto sm:px-6" disabled={pending || !body.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            Post
          </Button>
        </form>
      )}
    </div>
  );
}
