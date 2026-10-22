import type { Metadata } from "next";
import { JoinCard, JoinError } from "@/components/join-card";
import { claimPlaceholderAction } from "@/server/actions/members";
import { NotFoundError, UserError } from "@/server/errors";
import { getClaimPreview } from "@/server/members";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Join a group · Hisaab" };

/**
 * Where a placeholder's claim link (from an invite email, or copied by a member) lands. Shows whose spot it is; claiming
 * waits for the button, so opening the link never spends it.
 */
export default async function ClaimPage({ params }: PageProps<"/claim/[token]">) {
  const user = await requireOnboardedUser(); // signed out or new: comes back here afterwards
  const { token } = await params;
  const preview = await getClaimPreview(user.id, token).catch((error: unknown) => {
    if (error instanceof UserError || error instanceof NotFoundError) return error;
    throw error;
  });
  if (preview instanceof Error) return <JoinError message={preview.message} email={user.email} />;

  return (
    <JoinCard
      group={preview.group}
      title={`Join ${preview.group.name} as ${preview.placeholderName}`}
      detail="Your friends added you to the group before you were on Hisaab. Join to take your spot."
      join={claimPlaceholderAction.bind(null, { token })}
    />
  );
}
