import type { Metadata } from "next";
import { ActivityFeed } from "@/components/activity-feed";
import { PAGE_SIZE, parseLimit } from "@/lib/page-limit";
import { listMyActivity } from "@/server/activity";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Activity · Hisaab" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const user = await requireOnboardedUser();
  const limit = parseLimit((await searchParams).limit);
  const { items, hasMore } = await listMyActivity(user.id, limit);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Activity</h1>
      <ActivityFeed items={items} showGroup hasMore={hasMore} moreHref={`/activity?limit=${limit + PAGE_SIZE}`} />
    </div>
  );
}
