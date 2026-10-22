import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { JoinCard, JoinError } from "@/components/join-card";
import { joinByInviteCodeAction } from "@/server/actions/members";
import { NotFoundError, UserError } from "@/server/errors";
import { getInvitePreview } from "@/server/members";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Join a group · Hisaab" };

/** "3 members: Asha, Ravi and 1 other". */
function membersLine(count: number, names: string[]) {
  const others = count - names.length;
  const list = others > 0 ? [...names, others === 1 ? "1 other" : `${others} others`] : names;
  return `${count === 1 ? "1 member" : `${count} members`}: ${new Intl.ListFormat("en-IN", { type: "conjunction" }).format(list)}`;
}

/** Where a group's invite link lands. Only shows the group: joining waits for the button, so opening a link never joins. */
export default async function JoinPage({ params }: PageProps<"/join/[inviteCode]">) {
  const user = await requireOnboardedUser(); // signed out or new: comes back here afterwards
  const { inviteCode } = await params;
  const preview = await getInvitePreview(user.id, inviteCode).catch((error: unknown) => {
    if (error instanceof UserError || error instanceof NotFoundError) return error;
    throw error;
  });
  if (preview instanceof Error) return <JoinError message={preview.message} email={user.email} />;
  if (preview.status === "member") redirect(`/groups/${preview.groupId}`);

  return (
    <JoinCard
      group={preview.group}
      kicker="You're invited to join"
      title={preview.group.name}
      detail={membersLine(preview.memberCount, preview.memberNames)}
      join={joinByInviteCodeAction.bind(null, { code: inviteCode })}
    />
  );
}
